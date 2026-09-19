"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { IntakeEditablePatch } from "@/lib/runtime/daily-intake";
import type { HostedIntakeItem } from "@/lib/runtime/intake-repository";
import type { SourceFreshness } from "@/lib/runtime/source-freshness-repository";
import { fetchHostedWithSessionRefresh } from "@/lib/runtime/browser-runtime";

export type IntakeViewMode = "PENDING" | "DEFERRED" | "AWARENESS" | "HISTORY";
export type IntakeScope = ProductWorkspaceId | "all";

const PERSONAL_INTAKE_ENDPOINT = "/api/hosted/intake?workspaceId=personal";
const INDELITECH_INTAKE_ENDPOINT = "/api/hosted/intake?workspaceId=indelitech";

function intakeEndpoint(workspaceId: ProductWorkspaceId): string {
  return workspaceId === "personal" ? PERSONAL_INTAKE_ENDPOINT : INDELITECH_INTAKE_ENDPOINT;
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchHostedWithSessionRefresh(fetch, url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(responseError(payload, "Intake request failed."));
  return payload as T;
}

function urlForMode(workspaceId: ProductWorkspaceId, viewMode: IntakeViewMode): string {
  const base = intakeEndpoint(workspaceId);
  if (viewMode === "PENDING") return `${base}&status=PENDING`;
  if (viewMode === "DEFERRED") return `${base}&status=DEFERRED`;
  if (viewMode === "AWARENESS") return `${base}&status=PENDING&type=AWARENESS`;
  return base;
}

function filterMode(items: HostedIntakeItem[], viewMode: IntakeViewMode): HostedIntakeItem[] {
  if (viewMode === "PENDING") return items.filter((item) => item.intakeType !== "AWARENESS");
  if (viewMode === "AWARENESS") return items.filter((item) => item.intakeType === "AWARENESS");
  if (viewMode === "HISTORY") {
    return items.filter((item) => item.status === "APPROVED" || item.status === "DISMISSED" || item.status === "ARCHIVED");
  }
  return items;
}

function actionableTime(item: HostedIntakeItem): number | null {
  if (item.followUpAt) {
    const parsed = Date.parse(item.followUpAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (item.dueDate) {
    const parsed = Date.parse(`${item.dueDate}T00:00:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sortItems(items: HostedIntakeItem[], viewMode: IntakeViewMode): HostedIntakeItem[] {
  return [...items].sort((left, right) => {
    if (viewMode === "HISTORY") {
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.intakeId.localeCompare(left.intakeId);
    }
    const leftAction = actionableTime(left);
    const rightAction = actionableTime(right);
    if (leftAction !== null || rightAction !== null) {
      if (leftAction === null) return 1;
      if (rightAction === null) return -1;
      if (leftAction !== rightAction) return leftAction - rightAction;
    }
    return Date.parse(right.sourceTimestamp) - Date.parse(left.sourceTimestamp) || right.intakeId.localeCompare(left.intakeId);
  });
}

function authorizedScope(scope: IntakeScope, authorizedWorkspaceIds: readonly ProductWorkspaceId[]): ProductWorkspaceId[] {
  if (scope === "all") {
    return (["personal", "indelitech"] as const).filter((workspaceId) => authorizedWorkspaceIds.includes(workspaceId));
  }
  return authorizedWorkspaceIds.includes(scope) ? [scope] : [];
}

type BulkResult = Readonly<{ intakeId: string; ok: boolean; error?: string }>;
type BulkResponse = Readonly<{ results: BulkResult[] }>;

function assertBulkResults(payload: BulkResponse, verb: string): void {
  const failed = payload.results.filter((result) => !result.ok);
  if (failed.length) throw new Error(`${failed.length} Intake item${failed.length === 1 ? "" : "s"} could not be ${verb}. Successful items were kept.`);
}

export function useIntake({ scope, viewMode, authorizedWorkspaceIds, enabled }: {
  scope: IntakeScope;
  viewMode: IntakeViewMode;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  enabled: boolean;
}) {
  const [items, setItems] = useState<HostedIntakeItem[]>([]);
  const [sources, setSources] = useState<SourceFreshness[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [freshnessError, setFreshnessError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [nonce, setNonce] = useState(0);

  const workspaceIds = useMemo(() => authorizedScope(scope, authorizedWorkspaceIds), [authorizedWorkspaceIds, scope]);
  const active = enabled && workspaceIds.length > 0;
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !workspaceIds.length) return;

    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError("");
      setFreshnessError("");
      try {
        const responses = await Promise.all(workspaceIds.map((workspaceId) =>
          requestJson<{ items: HostedIntakeItem[] }>(urlForMode(workspaceId, viewMode), { signal: controller.signal }),
        ));
        if (controller.signal.aborted) return;
        setItems(sortItems(filterMode(responses.flatMap((response) => response.items), viewMode), viewMode));
        try {
          const freshnessResponses = await Promise.all(workspaceIds.map((workspaceId) =>
            requestJson<{ sources: SourceFreshness[] }>(
              `/api/hosted/intake/status?workspaceId=${encodeURIComponent(workspaceId)}`,
              { signal: controller.signal },
            ),
          ));
          if (!controller.signal.aborted) setSources(freshnessResponses.flatMap((response) => response.sources));
        } catch (caught) {
          if (!controller.signal.aborted) {
            setSources([]);
            setFreshnessError(caught instanceof Error ? caught.message : "Source freshness could not be loaded.");
          }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setItems([]);
          setLoadError(caught instanceof Error ? caught.message : "Intake could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, nonce, viewMode, workspaceIds]);

  const runMutation = useCallback(async (successMessage: string, operation: () => Promise<void>): Promise<boolean> => {
    setActionPending(true);
    setMutationError("");
    setActionMessage("");
    try {
      await operation();
      setActionMessage(successMessage);
      return true;
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : "Intake could not be updated.");
      return false;
    } finally {
      setActionPending(false);
      setNonce((value) => value + 1);
    }
  }, []);

  const approve = useCallback((item: HostedIntakeItem) => runMutation("Intake item approved.", async () => {
    await requestJson(intakeEndpoint(item.workspaceKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVE", intakeIds: [item.intakeId] }) });
  }), [runMutation]);

  const editAndApprove = useCallback((item: HostedIntakeItem, patch: IntakeEditablePatch) => runMutation("Changes saved and Intake item approved.", async () => {
    const edited = await requestJson<{ item: HostedIntakeItem }>(intakeEndpoint(item.workspaceKey), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: item.intakeId, action: "EDIT", patch }) });
    await requestJson(intakeEndpoint(edited.item.workspaceKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVE", intakeIds: [edited.item.intakeId] }) });
  }), [runMutation]);

  const defer = useCallback((item: HostedIntakeItem, until: string) => runMutation("Intake item deferred.", async () => {
    await requestJson(intakeEndpoint(item.workspaceKey), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: item.intakeId, action: "DEFER", until }) });
  }), [runMutation]);

  const dismiss = useCallback((item: HostedIntakeItem) => runMutation("Intake item dismissed.", async () => {
    await requestJson(intakeEndpoint(item.workspaceKey), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: item.intakeId, action: "DISMISS" }) });
  }), [runMutation]);

  const archive = useCallback((item: HostedIntakeItem) => runMutation("Awareness item archived.", async () => {
    await requestJson(intakeEndpoint(item.workspaceKey), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: item.intakeId, action: "ARCHIVE" }) });
  }), [runMutation]);

  const bulkApprove = useCallback((selected: readonly HostedIntakeItem[]) => runMutation("Selected Intake items approved.", async () => {
    const groups = (["personal", "indelitech"] as const).map((workspaceId) => [workspaceId, selected.filter((item) => item.workspaceKey === workspaceId)] as const).filter(([, group]) => group.length > 0);
    for (const [workspaceId, group] of groups) {
      const payload = await requestJson<BulkResponse>(intakeEndpoint(workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVE_BULK", intakeIds: group.map((item) => item.intakeId) }) });
      assertBulkResults(payload, "approved");
    }
  }), [runMutation]);

  const bulkDismiss = useCallback((selected: readonly HostedIntakeItem[]) => runMutation("Selected Intake items dismissed.", async () => {
    const groups = (["personal", "indelitech"] as const).map((workspaceId) => [workspaceId, selected.filter((item) => item.workspaceKey === workspaceId)] as const).filter(([, group]) => group.length > 0);
    for (const [workspaceId, group] of groups) {
      const payload = await requestJson<BulkResponse>(intakeEndpoint(workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "DISMISS_BULK", intakeIds: group.map((item) => item.intakeId) }) });
      assertBulkResults(payload, "dismissed");
    }
  }), [runMutation]);

  return {
    items: active ? items : [],
    sources: active ? sources : [],
    loading: active ? loading : false,
    error: !enabled ? "" : workspaceIds.length ? mutationError || loadError : "This workspace is not authorized for the current session.",
    freshnessError: active ? freshnessError : "",
    actionPending,
    actionMessage,
    refresh,
    approve,
    editAndApprove,
    defer,
    dismiss,
    archive,
    bulkApprove,
    bulkDismiss,
  };
}

"use client";

import { useEffect, useState } from "react";
import {
  billProjectionWorkspaceIds,
  projectOpenBillOccurrences,
  type BillWorkspaceSummary,
  type ProjectedBillOccurrence,
} from "@/lib/bill-projections";
import {
  browserRuntimeMode,
  loadHostedApplicationSession,
} from "@/lib/runtime/browser-runtime";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";

type BillsResponse = Readonly<{
  bills: HostedBill[];
  occurrences: HostedBillOccurrence[];
}>;

type ProjectedBillsState = Readonly<{
  workspaceId: ProductWorkspaceId | null;
  occurrences: ProjectedBillOccurrence[];
  loading: boolean;
  error: string;
}>;

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export function useProjectedBills(workspaceId: ProductWorkspaceId): Omit<ProjectedBillsState, "workspaceId"> {
  const [state, setState] = useState<ProjectedBillsState>({ workspaceId: null, occurrences: [], loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      if (browserRuntimeMode(window.location.hostname) !== "hosted") {
        if (!cancelled) setState({ workspaceId, occurrences: [], loading: false, error: "" });
        return;
      }

      if (!cancelled) setState({ workspaceId, occurrences: [], loading: true, error: "" });
      try {
        const session = await loadHostedApplicationSession(fetch);
        const authorizedWorkspaceIds = session.workspaces.map(({ workspaceId: id }) => id);
        const targetWorkspaceIds = billProjectionWorkspaceIds(workspaceId, authorizedWorkspaceIds);
        const summaries: BillWorkspaceSummary[] = await Promise.all(targetWorkspaceIds.map(async (targetWorkspaceId) => {
          const response = await fetch(`/api/hosted/bills?workspaceId=${encodeURIComponent(targetWorkspaceId)}&includeArchived=false`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(responseError(payload, `Bills for ${targetWorkspaceId} could not be loaded.`));
          const summary = payload as BillsResponse;
          return {
            workspaceId: targetWorkspaceId,
            bills: Array.isArray(summary.bills) ? summary.bills : [],
            occurrences: Array.isArray(summary.occurrences) ? summary.occurrences : [],
          };
        }));
        if (!cancelled) setState({ workspaceId, occurrences: projectOpenBillOccurrences(summaries), loading: false, error: "" });
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          workspaceId,
          occurrences: [],
          loading: false,
          error: caught instanceof Error ? caught.message : "Bills could not be loaded.",
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId]);

  if (state.workspaceId !== workspaceId) {
    return { occurrences: [], loading: true, error: "" };
  }
  return { occurrences: state.occurrences, loading: state.loading, error: state.error };
}

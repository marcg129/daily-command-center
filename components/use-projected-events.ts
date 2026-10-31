"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarOverrideScope } from "@/lib/runtime/calendar-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";

export type ProjectedEventScope = ProductWorkspaceId | "all";
export const UPCOMING_EVENT_HORIZON_DAYS = 45;

const PERSONAL_EVENTS_ENDPOINT = "/api/hosted/events?workspaceId=personal";
const INDELITECH_EVENTS_ENDPOINT = "/api/hosted/events?workspaceId=indelitech";

function productDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(date: string, amount: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

export function upcomingEventRange(now = new Date()) {
  const fromDate = productDate(now);
  return { fromDate, throughDate: addDays(fromDate, UPCOMING_EVENT_HORIZON_DAYS - 1) };
}

function endpoint(workspaceId: ProductWorkspaceId, fromDate: string, throughDate: string): string {
  const base = workspaceId === "personal" ? PERSONAL_EVENTS_ENDPOINT : INDELITECH_EVENTS_ENDPOINT;
  return `${base}&fromDate=${encodeURIComponent(fromDate)}&throughDate=${encodeURIComponent(throughDate)}`;
}

function authorizedScope(scope: ProjectedEventScope, authorizedWorkspaceIds: readonly ProductWorkspaceId[]) {
  if (scope === "all") {
    return (["personal", "indelitech"] as const).filter((workspaceId) => authorizedWorkspaceIds.includes(workspaceId));
  }
  return authorizedWorkspaceIds.includes(scope) ? [scope] : [];
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return payload && typeof payload.error === "string" ? payload.error : "Calendar events could not be loaded.";
}

export function useProjectedEvents({
  scope,
  authorizedWorkspaceIds,
  enabled,
}: {
  scope: ProjectedEventScope;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  enabled: boolean;
}) {
  const range = useMemo(() => upcomingEventRange(), []);
  const workspaceIds = useMemo(
    () => authorizedScope(scope, authorizedWorkspaceIds),
    [authorizedWorkspaceIds, scope],
  );
  const [events, setEvents] = useState<ProjectedCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const active = enabled && workspaceIds.length > 0;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const responses = await Promise.all(workspaceIds.map(async (workspaceId) => {
          const response = await fetch(endpoint(workspaceId, range.fromDate, range.throughDate), {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(await responseError(response));
          return await response.json() as { events: ProjectedCalendarEvent[] };
        }));
        if (controller.signal.aborted) return;
        const merged = responses.flatMap((response) => response.events).toSorted((left, right) =>
          left.startAt.localeCompare(right.startAt) ||
          left.sourceKey.localeCompare(right.sourceKey) ||
          left.googleEventId.localeCompare(right.googleEventId),
        );
        setEvents(merged);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setEvents([]);
          setLoadError(caught instanceof Error ? caught.message : "Calendar events could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [active, nonce, range.fromDate, range.throughDate, workspaceIds]);

  const setWorkspaceOverride = useCallback(async (
    event: ProjectedCalendarEvent,
    workspaceId: ProductWorkspaceId,
    overrideScope: CalendarOverrideScope,
  ) => {
    setMutationPending(true);
    setMutationError("");
    try {
      const response = await fetch("/api/hosted/events", {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKey: event.sourceKey,
          eventId: event.googleEventId,
          scope: overrideScope,
          workspaceId,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNonce((value) => value + 1);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Event workspace could not be updated.";
      setMutationError(message);
      throw caught;
    } finally {
      setMutationPending(false);
    }
  }, []);

  return {
    events: active ? events : [],
    loading: active ? loading : false,
    error: !enabled ? "" : workspaceIds.length ? mutationError || loadError : "This event workspace is not authorized.",
    mutationPending,
    range,
    refresh,
    setWorkspaceOverride,
  };
}

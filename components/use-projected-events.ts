"use client";

import { useEffect, useState } from "react";
import { billProjectionToday } from "@/lib/bill-projections";
import {
  browserRuntimeMode,
  loadHostedApplicationSession,
} from "@/lib/runtime/browser-runtime";
import type { CalendarOverrideScope } from "@/lib/runtime/calendar-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";

export type ProjectedEventScope = ProductWorkspaceId | "all";

type EventsResponse = Readonly<{
  events?: ProjectedCalendarEvent[];
  error?: string;
}>;

type ProjectedEventsState = Readonly<{
  scope: ProjectedEventScope | null;
  events: ProjectedCalendarEvent[];
  authorizedWorkspaceIds: ProductWorkspaceId[];
  loading: boolean;
  error: string;
}>;

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function uniqueEvents(events: readonly ProjectedCalendarEvent[]): ProjectedCalendarEvent[] {
  const byIdentity = new Map<string, ProjectedCalendarEvent>();
  for (const event of events) byIdentity.set(`${event.sourceKey}:${event.googleEventId}`, event);
  return Array.from(byIdentity.values()).toSorted((left, right) =>
    left.startAt.localeCompare(right.startAt) ||
    left.sourceKey.localeCompare(right.sourceKey) ||
    left.googleEventId.localeCompare(right.googleEventId));
}

export function useProjectedEvents(scope: ProjectedEventScope) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [mutationError, setMutationError] = useState("");
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [state, setState] = useState<ProjectedEventsState>({
    scope: null,
    events: [],
    authorizedWorkspaceIds: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      if (browserRuntimeMode(window.location.hostname) !== "hosted") {
        if (!cancelled) setState({ scope, events: [], authorizedWorkspaceIds: [], loading: false, error: "" });
        return;
      }

      if (!cancelled) setState((previous) => ({ ...previous, scope, events: [], loading: true, error: "" }));
      try {
        const session = await loadHostedApplicationSession(fetch);
        const authorizedWorkspaceIds = session.workspaces.map(({ workspaceId }) => workspaceId);
        const targetWorkspaceIds: ProductWorkspaceId[] = scope === "all"
          ? (["personal", "indelitech"] as const).filter((workspaceId) => authorizedWorkspaceIds.includes(workspaceId))
          : authorizedWorkspaceIds.includes(scope) ? [scope] : [];

        if (targetWorkspaceIds.length === 0) {
          if (!cancelled) setState({ scope, events: [], authorizedWorkspaceIds, loading: false, error: "This Calendar scope is not authorized for the current session." });
          return;
        }

        const fromDate = billProjectionToday();
        // Inclusive 45-day window: today plus 44 calendar days.
        const throughDate = addCalendarDays(fromDate, 44);
        const batches = await Promise.all(targetWorkspaceIds.map(async (workspaceId) => {
          const response = await fetch(`/api/hosted/events?workspaceId=${encodeURIComponent(workspaceId)}&fromDate=${encodeURIComponent(fromDate)}&throughDate=${encodeURIComponent(throughDate)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const payload = await response.json() as EventsResponse;
          if (!response.ok) throw new Error(responseError(payload, `Events for ${workspaceId} could not be loaded.`));
          return Array.isArray(payload.events) ? payload.events : [];
        }));

        if (!cancelled) setState({
          scope,
          events: uniqueEvents(batches.flat()),
          authorizedWorkspaceIds,
          loading: false,
          error: "",
        });
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        setState((previous) => ({
          ...previous,
          scope,
          events: [],
          loading: false,
          error: caught instanceof Error ? caught.message : "Calendar events could not be loaded.",
        }));
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshToken, scope]);

  const updateWorkspace = async (
    event: ProjectedCalendarEvent,
    workspaceId: ProductWorkspaceId,
    overrideScope: CalendarOverrideScope,
    clear = false,
  ): Promise<boolean> => {
    if (!state.authorizedWorkspaceIds.includes(workspaceId)) {
      setMutationError("That destination workspace is not authorized for the current session.");
      return false;
    }
    setMutationError("");
    setUpdatingEventId(event.eventProjectionId);
    try {
      const response = await fetch("/api/hosted/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sourceKey: event.sourceKey,
          eventId: event.googleEventId,
          scope: overrideScope,
          workspaceId,
          clear,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Event workspace could not be updated."));
      setRefreshToken((value) => value + 1);
      return true;
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : "Event workspace could not be updated.");
      return false;
    } finally {
      setUpdatingEventId(null);
    }
  };

  const visible = state.scope === scope;
  return {
    events: visible ? state.events : [],
    authorizedWorkspaceIds: visible ? state.authorizedWorkspaceIds : [],
    loading: visible ? state.loading : true,
    error: mutationError || (visible ? state.error : ""),
    updatingEventId,
    refresh: () => setRefreshToken((value) => value + 1),
    updateWorkspace,
  };
}

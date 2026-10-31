"use client";

import { useState } from "react";
import { CalendarDays, ExternalLink, Link2, Repeat2 } from "lucide-react";
import type { CalendarOverrideScope } from "@/lib/runtime/calendar-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import type { TaskItem } from "@/lib/types";

const SOURCE_LABELS: Record<ProjectedCalendarEvent["sourceKey"], string> = {
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
};

function eventTime(event: ProjectedCalendarEvent): string {
  if (event.allDay) return "All day";
  const date = new Date(event.startAt);
  if (Number.isNaN(date.getTime())) return event.startAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function CalendarEventItem({
  event,
  compact = false,
  authorizedWorkspaceIds,
  onOpenTask,
  onOverride,
}: {
  event: ProjectedCalendarEvent;
  compact?: boolean;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  onOpenTask: (taskId: TaskItem["id"]) => void;
  onOverride: (event: ProjectedCalendarEvent, workspaceId: ProductWorkspaceId, scope: CalendarOverrideScope) => Promise<void>;
}) {
  const defaultScope: CalendarOverrideScope = event.seriesId ? "SERIES" : "OCCURRENCE";
  const [scope, setScope] = useState<CalendarOverrideScope>(defaultScope);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<ProductWorkspaceId>(event.resolvedWorkspaceId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const approvedTasks = event.relatedIntake.filter((item) => item.approvedTargetKind === "TASK" && item.approvedTargetId);

  const applyOverride = async () => {
    setPending(true);
    setError("");
    try {
      await onOverride(event, targetWorkspaceId, scope);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Event workspace could not be updated.");
    } finally {
      setPending(false);
    }
  };

  return <div
    className="calendar-item calendar-event-item"
    style={{ borderLeftColor: "var(--teal)", cursor: "default" }}
    aria-label={`${event.title}, ${SOURCE_LABELS[event.sourceKey]}, ${eventTime(event)}`}
  >
    <CalendarDays size={compact ? 11 : 14} aria-hidden="true" />
    <span>{event.title}</span>
    {!compact && <small>
      {SOURCE_LABELS[event.sourceKey]} · {eventTime(event)}
      {event.seriesId ? " · Recurring" : ""}
      {event.location ? ` · ${event.location}` : ""}
      {event.resolvedWorkspaceId === "indelitech" ? " · Indelitech" : " · Personal"}
    </small>}
    {!compact && <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", marginTop: 4 }}>
      {event.seriesId && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9 }}><Repeat2 size={11} /> Series</span>}
      {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9 }}>
        <ExternalLink size={11} /> Open source
      </a>}
      {event.relatedIntake.map((item) => <span key={item.intakeId} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9 }}>
        <Link2 size={11} /> Intake: {item.intakeType} · {item.status}
      </span>)}
      {approvedTasks.map((item) => <button
        type="button"
        key={`task:${item.intakeId}`}
        onClick={() => item.approvedTargetId && onOpenTask(item.approvedTargetId)}
        style={{ fontSize: 9 }}
      >Open Task</button>)}
    </div>}
    {!compact && authorizedWorkspaceIds.length > 1 && <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", marginTop: 5 }}>
      <label style={{ fontSize: 9 }}>
        Workspace{" "}
        <select value={targetWorkspaceId} onChange={(change) => setTargetWorkspaceId(change.target.value as ProductWorkspaceId)} disabled={pending}>
          {authorizedWorkspaceIds.includes("personal") && <option value="personal">Personal</option>}
          {authorizedWorkspaceIds.includes("indelitech") && <option value="indelitech">Indelitech</option>}
        </select>
      </label>
      <label style={{ fontSize: 9 }}>
        Apply to{" "}
        <select value={scope} onChange={(change) => setScope(change.target.value as CalendarOverrideScope)} disabled={pending}>
          {event.seriesId && <option value="SERIES">Entire series</option>}
          {event.occurrenceKey && <option value="OCCURRENCE">This occurrence only</option>}
        </select>
      </label>
      <button type="button" onClick={() => void applyOverride()} disabled={pending}>
        {pending ? "Saving…" : "Save workspace"}
      </button>
      {error && <span role="alert" style={{ fontSize: 9 }}>{error}</span>}
    </div>}
  </div>;
}

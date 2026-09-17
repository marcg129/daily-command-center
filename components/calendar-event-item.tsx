"use client";

import { useState } from "react";
import { CalendarDays, ExternalLink, Link2, MapPin } from "lucide-react";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import type { CalendarOverrideScope } from "@/lib/runtime/calendar-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { TaskItem } from "@/lib/types";

const SOURCE_LABEL = {
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
} as const;

function eventTime(event: ProjectedCalendarEvent): string {
  if (event.allDay) return "All day";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(event.startAt))} – ${formatter.format(new Date(event.endAt))}`;
}

function workspaceLabel(workspaceId: ProductWorkspaceId): string {
  return workspaceId === "indelitech" ? "Indelitech" : "Personal";
}

type Props = Readonly<{
  event: ProjectedCalendarEvent;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  compact?: boolean;
  updating?: boolean;
  onOpenTask: (taskId: TaskItem["id"]) => void;
  onOpenIntake: () => void;
  onOverride: (
    event: ProjectedCalendarEvent,
    workspaceId: ProductWorkspaceId,
    scope: CalendarOverrideScope,
    clear?: boolean,
  ) => Promise<boolean>;
}>;

export function CalendarEventItem({
  event,
  authorizedWorkspaceIds,
  compact = false,
  updating = false,
  onOpenTask,
  onOpenIntake,
  onOverride,
}: Props) {
  const [scope, setScope] = useState<CalendarOverrideScope>(event.seriesId ? "SERIES" : "OCCURRENCE");
  const canOverride = Boolean(event.seriesId || event.occurrenceKey);
  const sourceLabel = SOURCE_LABEL[event.sourceKey];
  const recurringLabel = event.seriesId ? "Recurring series" : "Single event";

  if (compact) {
    return <div
      className="calendar-item calendar-event-item"
      style={{ borderLeftColor: "var(--coral)" }}
      title={`${event.title} · ${sourceLabel} · ${eventTime(event)}`}
    >
      <CalendarDays size={11} aria-hidden="true" />
      <span>{event.title}</span>
    </div>;
  }

  return <article className="calendar-item calendar-event-item" style={{ borderLeftColor: "var(--coral)" }}>
    <CalendarDays size={14} aria-hidden="true" />
    <div style={{ minWidth: 0, display: "grid", gap: 7, width: "100%" }}>
      <div>
        <strong>{event.title}</strong>
        <small style={{ display: "block" }}>
          {sourceLabel} · {eventTime(event)} · {recurringLabel} · {workspaceLabel(event.resolvedWorkspaceId)}
        </small>
      </div>

      {event.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9 }}><MapPin size={12} aria-hidden="true" />{event.location}</span>}

      {event.relatedIntake.length > 0 && <div aria-label="Related Intake" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {event.relatedIntake.map((relatedIntake) => relatedIntake.approvedTargetKind === "TASK" && relatedIntake.approvedTargetId
          ? <button key={relatedIntake.intakeId} type="button" className="text-button" onClick={() => onOpenTask(relatedIntake.approvedTargetId as TaskItem["id"])}><Link2 size={12} aria-hidden="true" /> Open approved Task</button>
          : <button key={relatedIntake.intakeId} type="button" className="text-button" onClick={onOpenIntake}><Link2 size={12} aria-hidden="true" /> Review Intake · {relatedIntake.intakeType}</button>)}
      </div>}

      {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-button"><ExternalLink size={12} aria-hidden="true" /> Open in Google Calendar</a>}

      {canOverride && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8 }}>
        <label style={{ display: "grid", gap: 3, fontSize: 8 }}>
          Apply workspace correction to
          <select value={scope} onChange={(change) => setScope(change.target.value as CalendarOverrideScope)} disabled={updating}>
            {event.seriesId && <option value="SERIES">Whole series</option>}
            {event.occurrenceKey && <option value="OCCURRENCE">This occurrence only</option>}
          </select>
        </label>
        {authorizedWorkspaceIds.includes("personal") && <button type="button" className="text-button" disabled={updating || event.resolvedWorkspaceId === "personal"} onClick={() => void onOverride(event, "personal", scope)}>Personal</button>}
        {authorizedWorkspaceIds.includes("indelitech") && <button type="button" className="text-button" disabled={updating || event.resolvedWorkspaceId === "indelitech"} onClick={() => void onOverride(event, "indelitech", scope)}>Indelitech</button>}
        <button type="button" className="text-button" disabled={updating} onClick={() => void onOverride(event, event.resolvedWorkspaceId, scope, true)}>Use automatic classification</button>
      </div>}
    </div>
  </article>;
}

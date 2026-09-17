"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { billProjectionToday } from "@/lib/bill-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { projectedCalendarEventDate } from "@/lib/task-calendar";
import { useProjectedEvents } from "./use-projected-events";
import styles from "./today-events.module.css";

const SOURCE_LABEL = {
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
} as const;

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function eventTime(event: ProjectedCalendarEvent): string {
  if (event.allDay) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startAt));
}

function compareEvents(left: ProjectedCalendarEvent, right: ProjectedCalendarEvent): number {
  const byDate = projectedCalendarEventDate(left).localeCompare(projectedCalendarEventDate(right));
  if (byDate !== 0) return byDate;
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  return left.startAt.localeCompare(right.startAt) || left.sourceKey.localeCompare(right.sourceKey) || left.googleEventId.localeCompare(right.googleEventId);
}

function EventRow({ event }: { event: ProjectedCalendarEvent }) {
  const workspaceLabel = event.resolvedWorkspaceId === "indelitech" ? "Indelitech" : "Personal";
  return <article className={styles.eventRow}>
    <div className={styles.eventIcon}><Clock3 size={14} aria-hidden="true" /></div>
    <div>
      <strong>{event.title}</strong>
      <span>{SOURCE_LABEL[event.sourceKey]} · {eventTime(event)} · {workspaceLabel}</span>
      {event.location && <small>{event.location}</small>}
    </div>
  </article>;
}

export function TodayEvents({
  workspaceId,
  enabled,
  onOpenCalendar,
}: {
  workspaceId: ProductWorkspaceId;
  enabled: boolean;
  onOpenCalendar: () => void;
}) {
  const projectedEvents = useProjectedEvents("all");
  const today = billProjectionToday();
  const through = addCalendarDays(today, 7);
  const visibleEvents = projectedEvents.events.filter((event) => workspaceId === "personal" || event.resolvedWorkspaceId === "indelitech");
  const todaysEvents = visibleEvents
    .filter((event) => projectedCalendarEventDate(event) === today)
    .toSorted(compareEvents);
  const upcomingEvents = visibleEvents
    .filter((event) => {
      const date = projectedCalendarEventDate(event);
      return date > today && date <= through;
    })
    .toSorted(compareEvents)
    .slice(0, 5);

  if (!enabled) return null;

  return <section className={styles.panel} aria-label={`${workspaceId === "personal" ? "Personal + Indelitech" : "Indelitech"} Today events`}>
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Calendar</p>
        <h2>Today&apos;s Events</h2>
      </div>
      <button type="button" className={styles.openButton} onClick={onOpenCalendar}>
        <CalendarDays size={14} aria-hidden="true" /> Open Calendar
      </button>
    </div>

    {projectedEvents.loading ? <p className={styles.status}>Checking projected events…</p>
      : todaysEvents.length ? <div className={styles.eventList}>{todaysEvents.map((event) => <EventRow key={event.eventProjectionId} event={event} />)}</div>
        : <p className={styles.status}>No projected Google Calendar events today.</p>}

    <div className={styles.upcoming}>
      <div className={styles.upcomingHeading}><strong>Next 7 days</strong><span>{upcomingEvents.length ? `${upcomingEvents.length} shown` : "Nothing scheduled"}</span></div>
      {upcomingEvents.length > 0 && <div className={styles.compactList}>{upcomingEvents.map((event) => <div key={event.eventProjectionId} className={styles.compactRow}><time dateTime={projectedCalendarEventDate(event)}>{projectedCalendarEventDate(event).slice(5)}</time><span>{event.title}</span><small>{event.resolvedWorkspaceId === "indelitech" ? "Indelitech" : "Personal"}</small></div>)}</div>}
    </div>

    {projectedEvents.error && <p className={styles.warning} role="status">Calendar source warning: {projectedEvents.error}</p>}
  </section>;
}

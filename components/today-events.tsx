"use client";

import { CalendarDays, CircleAlert, Clock3 } from "lucide-react";
import { billProjectionToday } from "@/lib/bill-projections";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { calendarEventEntries } from "@/lib/task-calendar";
import { useProjectedEvents } from "@/components/use-projected-events";
import styles from "./today-events.module.css";

const SOURCE_LABELS = {
  primary_calendar: "Primary Calendar",
  family_calendar: "Family Calendar",
} as const;

function addDays(date: string, amount: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function eventTime(startAt: string, allDay: boolean): string {
  if (allDay) return "All day";
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return startAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PRODUCT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function TodayEvents({
  workspaceId,
  authorizedWorkspaceIds,
  enabled,
  onOpenCalendar,
}: {
  workspaceId: ProductWorkspaceId;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  enabled: boolean;
  onOpenCalendar: () => void;
}) {
  const canShowAll = authorizedWorkspaceIds.includes("personal") && authorizedWorkspaceIds.includes("indelitech");
  const scope = workspaceId === "personal" && canShowAll ? "all" : workspaceId;
  const projected = useProjectedEvents({ scope, authorizedWorkspaceIds, enabled });
  const today = billProjectionToday();
  const throughDate = addDays(today, 7);
  const eventEntries = calendarEventEntries(projected.events);
  const todayEntries = eventEntries.filter((entry) => entry.date === today);
  const nextSevenDays = eventEntries
    .filter((entry) => entry.date > today && entry.date <= throughDate)
    .slice(0, 5);

  if (!enabled) return null;

  const eventRow = (entry: (typeof eventEntries)[number], showDate = false) => {
    const event = entry.event;
    const workspaceLabel = event.resolvedWorkspaceId === "indelitech" ? "Indelitech" : "Personal";
    return <div className={styles.event} key={entry.id}>
      <Clock3 size={14} aria-hidden="true" />
      <span>
        <b>{event.title}</b>
        <small>
          {showDate ? `${dateLabel(entry.date)} · ` : ""}
          {eventTime(event.startAt, event.allDay)} · {SOURCE_LABELS[event.sourceKey]} · {workspaceLabel}
        </small>
      </span>
    </div>;
  };

  return <section className={styles.panel} aria-label={`${workspaceId === "personal" ? "Personal and Indelitech" : "Indelitech"} event summary`}>
    <div className={styles.header}>
      <div>
        <p className="eyebrow">Today&apos;s Events</p>
        <h2>Calendar at a glance</h2>
      </div>
      <button type="button" onClick={onOpenCalendar}><CalendarDays size={14} /> Open Calendar</button>
    </div>

    {projected.error && <div className={styles.warning} role="alert"><CircleAlert size={15} /> {projected.error}</div>}
    {projected.loading ? <p className={styles.empty}>Checking projected events…</p> : <>
      <div className={styles.section}>
        <div className={styles.sectionHeading}><b>Today</b><span>{todayEntries.length}</span></div>
        {todayEntries.length ? todayEntries.map((entry) => eventRow(entry)) : <p className={styles.empty}>No projected events today.</p>}
      </div>
      <div className={styles.section}>
        <div className={styles.sectionHeading}><b>Next 7 days</b><span>{nextSevenDays.length}</span></div>
        {nextSevenDays.length ? nextSevenDays.map((entry) => eventRow(entry, true)) : <p className={styles.empty}>No additional projected events in the next 7 days.</p>}
      </div>
    </>}
    <p className={styles.note}>Google events stay separate from Tasks. Personal Today includes authorized Indelitech events and labels their workspace explicitly.</p>
  </section>;
}

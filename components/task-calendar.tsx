"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, ListTodo, RefreshCw, WalletCards } from "lucide-react";
import { billAmountPresentation } from "@/lib/bill-ui";
import {
  billOccurrenceIsOverdue,
  billProjectionToday,
  type ProjectedBillOccurrence,
} from "@/lib/bill-projections";
import type { CalendarOverrideScope } from "@/lib/runtime/calendar-projections";
import type { ProjectedCalendarEvent } from "@/lib/runtime/calendar-projection-repository";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import {
  calendarEventEntries,
  monthCalendarDays,
  shiftCalendarMonth,
  taskCalendarEntries,
  type CalendarEventEntry,
  type TaskCalendarEntry,
} from "@/lib/task-calendar";
import type { TaskItem } from "@/lib/types";
import { CalendarEventItem } from "@/components/calendar-event-item";
import { useProjectedBills } from "@/components/use-projected-bills";
import { useProjectedEvents, type ProjectedEventScope } from "@/components/use-projected-events";

const KIND_LABEL = { DUE: "Due", REMINDER: "Reminder", FOLLOW_UP: "Follow-up" } as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CalendarProjection =
  | Readonly<{ source: "TASK"; id: string; date: string; taskEntry: TaskCalendarEntry }>
  | Readonly<{ source: "BILL"; id: string; date: string; billEntry: ProjectedBillOccurrence }>
  | Readonly<{ source: "EVENT"; id: string; date: string; eventEntry: CalendarEventEntry }>;

function productToday() {
  return billProjectionToday();
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

function dateLabel(date: string, style: "full" | "short" = "full") {
  return new Intl.DateTimeFormat("en-US", style === "full"
    ? { dateStyle: "full", timeZone: "UTC" }
    : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" },
  ).format(new Date(`${date}T12:00:00Z`));
}

function entryTime(entry: TaskCalendarEntry) {
  if (!entry.timestamp) return "All day";
  return new Intl.DateTimeFormat("en-US", { timeZone: PRODUCT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(entry.timestamp));
}

const SOURCE_RANK: Record<CalendarProjection["source"], number> = { EVENT: 0, BILL: 1, TASK: 2 };

function compareCalendarProjection(left: CalendarProjection, right: CalendarProjection) {
  const byDate = left.date.localeCompare(right.date);
  if (byDate !== 0) return byDate;
  if (left.source === "EVENT" && right.source === "EVENT") {
    return left.eventEntry.event.startAt.localeCompare(right.eventEntry.event.startAt) ||
      left.eventEntry.event.eventProjectionId.localeCompare(right.eventEntry.event.eventProjectionId);
  }
  if (left.source === right.source) return 0;
  return SOURCE_RANK[left.source] - SOURCE_RANK[right.source];
}

function CalendarItem({
  entry,
  onOpenTask,
  onOpenBill,
  onOverrideEvent,
  authorizedWorkspaceIds,
  compact = false,
}: {
  entry: CalendarProjection;
  onOpenTask: (taskId: TaskItem["id"]) => void;
  onOpenBill: (workspaceId: ProductWorkspaceId) => void;
  onOverrideEvent: (event: ProjectedCalendarEvent, workspaceId: ProductWorkspaceId, scope: CalendarOverrideScope) => Promise<void>;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  compact?: boolean;
}) {
  if (entry.source === "EVENT") {
    return <CalendarEventItem
      event={entry.eventEntry.event}
      compact={compact}
      authorizedWorkspaceIds={authorizedWorkspaceIds}
      onOpenTask={onOpenTask}
      onOverride={onOverrideEvent}
    />;
  }

  if (entry.source === "BILL") {
    const projected = entry.billEntry;
    const amount = billAmountPresentation(projected.bill, projected.occurrence);
    const overdue = billOccurrenceIsOverdue(projected);
    const workspaceLabel = projected.workspaceId === "indelitech" ? " · Indelitech" : "";
    return <button
      type="button"
      className={`calendar-item ${overdue ? "is-overdue" : ""}`}
      style={{ borderLeftColor: "var(--teal)" }}
      onClick={() => onOpenBill(projected.workspaceId)}
      aria-label={`${projected.bill.name}, bill due ${projected.occurrence.dueDate}, ${amount.label}${overdue ? ", overdue" : ""}${workspaceLabel}`}
      title={`${projected.bill.name} · Bill · ${amount.label}`}
    >
      <WalletCards size={compact ? 11 : 14} aria-hidden="true" />
      <span>{projected.bill.name}</span>
      {!compact && <small>Bill · {amount.label}{projected.bill.autopay ? " · AutoPay expected" : ""}{workspaceLabel}</small>}
    </button>;
  }

  const task = entry.taskEntry;
  const Icon = task.kind === "DUE" ? ListTodo : task.kind === "REMINDER" ? Bell : Clock3;
  return <button
    type="button"
    className={`calendar-item priority-${task.priority.toLowerCase()} ${task.overdue ? "is-overdue" : ""}`}
    onClick={() => onOpenTask(task.taskId)}
    aria-label={`${task.task.title}, ${KIND_LABEL[task.kind]} ${task.date}${task.overdue ? ", overdue" : ""}`}
    title={`${task.task.title} · ${KIND_LABEL[task.kind]} · ${entryTime(task)}`}
  >
    <Icon size={compact ? 11 : 14} aria-hidden="true" />
    <span>{task.task.title}</span>
    {!compact && <small>{KIND_LABEL[task.kind]} · {entryTime(task)}{task.task.primaryWorkspaceId === "indelitech" ? " · Indelitech" : ""}</small>}
  </button>;
}

export function TaskCalendar({
  tasks,
  workspaceId,
  onOpenTask,
  authorizedWorkspaceIds,
  eventsEnabled,
}: {
  tasks: TaskItem[];
  workspaceId: ProductWorkspaceId;
  onOpenTask: (taskId: TaskItem["id"]) => void;
  authorizedWorkspaceIds: readonly ProductWorkspaceId[];
  eventsEnabled: boolean;
}) {
  const router = useRouter();
  const today = productToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<"month" | "agenda" | "upcoming">("month");
  const [selectedDate, setSelectedDate] = useState<string>();
  const [upcomingScopeChoice, setUpcomingScopeChoice] = useState<ProjectedEventScope | "workspace">("workspace");
  const canShowAll = authorizedWorkspaceIds.includes("personal") && authorizedWorkspaceIds.includes("indelitech");
  const upcomingScope: ProjectedEventScope = upcomingScopeChoice === "workspace" ? workspaceId : upcomingScopeChoice;
  const eventScope: ProjectedEventScope = view === "upcoming"
    ? upcomingScope
    : workspaceId === "personal" && canShowAll ? "all" : workspaceId;

  const projectedBills = useProjectedBills(workspaceId);
  const projectedEvents = useProjectedEvents({ scope: eventScope, authorizedWorkspaceIds, enabled: eventsEnabled });
  const taskEntries = useMemo(() => taskCalendarEntries(tasks, workspaceId), [tasks, workspaceId]);
  const eventEntries = useMemo(() => calendarEventEntries(projectedEvents.events), [projectedEvents.events]);
  const entries = useMemo<CalendarProjection[]>(() => [
    ...taskEntries.map((entry) => ({ source: "TASK" as const, id: `task:${entry.id}`, date: entry.date, taskEntry: entry })),
    ...projectedBills.occurrences.map((entry) => ({ source: "BILL" as const, id: `bill:${entry.workspaceId}:${entry.occurrence.occurrenceId}`, date: entry.occurrence.dueDate, billEntry: entry })),
    ...eventEntries.map((entry) => ({ source: "EVENT" as const, id: entry.id, date: entry.date, eventEntry: entry })),
  ].toSorted(compareCalendarProjection), [eventEntries, projectedBills.occurrences, taskEntries]);
  const days = useMemo(() => monthCalendarDays(month), [month]);
  const byDate = useMemo(() => Map.groupBy(entries, (entry) => entry.date), [entries]);
  const agenda = entries;
  const selectedEntries = selectedDate ? byDate.get(selectedDate) || [] : [];
  const upcomingEntries = eventEntries.filter((entry) =>
    upcomingScope === "all" || entry.event.resolvedWorkspaceId === upcomingScope
  );
  const openBill = (targetWorkspaceId: ProductWorkspaceId) => router.push(`/bills?workspaceId=${encodeURIComponent(targetWorkspaceId)}`);
  const moveMonth = (amount: number) => { setMonth((value) => shiftCalendarMonth(value, amount)); setSelectedDate(undefined); };
  const onMonthKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.key !== "PageUp" && event.key !== "PageDown")) return;
    event.preventDefault();
    moveMonth(event.key === "PageUp" ? -1 : 1);
  };
  const renderItem = (entry: CalendarProjection, compact = false) => <CalendarItem
    key={entry.id}
    entry={entry}
    onOpenTask={onOpenTask}
    onOpenBill={openBill}
    onOverrideEvent={projectedEvents.setWorkspaceOverride}
    authorizedWorkspaceIds={authorizedWorkspaceIds}
    compact={compact}
  />;

  return <div className="view calendar-view">
    <div className="page-heading">
      <div><p className="eyebrow">{workspaceId === "personal" ? "Personal + Indelitech" : "Indelitech"} · Calendar</p><h1>Calendar</h1><p>{workspaceId === "personal" ? "One view of your visible task commitments, bill obligations, and projected Google Calendar events." : "Indelitech task deadlines, bill obligations, and classified Google Calendar events only."}</p></div>
      <div className="segmented" role="group" aria-label="Calendar view">
        <button className={view === "month" ? "active" : ""} aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        <button className={view === "agenda" ? "active" : ""} aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>Agenda</button>
        <button className={view === "upcoming" ? "active" : ""} aria-pressed={view === "upcoming"} onClick={() => setView("upcoming")}>Upcoming</button>
      </div>
    </div>

    {view === "month" && <section className="calendar-panel" aria-label={monthLabel(month)} aria-describedby="calendar-keyboard-help" tabIndex={0} onKeyDown={onMonthKeyDown}>
      <p id="calendar-keyboard-help" className="sr-only">Use Page Up and Page Down to move between months. Select a date to show all task, bill, and event entries for that day.</p>
      <div className="calendar-toolbar"><button aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><h2 aria-live="polite">{monthLabel(month)}</h2><button aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button><button className="calendar-today" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); }}>Today</button></div>
      <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{days.map((date) => { const dayEntries = byDate.get(date) || []; return <section key={date} className={`calendar-day ${date.slice(0, 7) !== month ? "outside-month" : ""} ${date === today ? "is-today" : ""} ${date === selectedDate ? "is-selected" : ""}`} aria-label={dateLabel(date)}><button type="button" className="calendar-date" aria-pressed={date === selectedDate} aria-label={`Show ${dayEntries.length || "no"} calendar ${dayEntries.length === 1 ? "entry" : "entries"} for ${dateLabel(date)}`} onClick={() => setSelectedDate(date)}><time dateTime={date}>{Number(date.slice(-2))}</time></button><div>{dayEntries.slice(0, 3).map((entry) => renderItem(entry, true))}{dayEntries.length > 3 && <button type="button" className="calendar-more" onClick={() => setSelectedDate(date)} aria-label={`Show ${dayEntries.length - 3} more entries for ${dateLabel(date)}`}>+{dayEntries.length - 3} more</button>}</div></section>; })}</div>
      {selectedDate && <div className="calendar-day-detail" aria-live="polite"><div><p className="eyebrow">Selected day</p><h3>{dateLabel(selectedDate)}</h3><span>{selectedEntries.length} {selectedEntries.length === 1 ? "entry" : "entries"}</span></div><div>{selectedEntries.length ? selectedEntries.map((entry) => renderItem(entry)) : <p>No task due dates, reminders, follow-ups, bill obligations, or Google events on this day.</p>}</div></div>}
    </section>}

    {view === "agenda" && <section className="agenda-panel" aria-label="Task, bill, and event calendar agenda">
      {agenda.length ? Array.from(Map.groupBy(agenda, (entry) => entry.date)).map(([date, dateEntries]) => <div className="agenda-day" key={date}><div><time dateTime={date}>{dateLabel(date, "short")}</time><span>{date === today ? "Today" : ""}</span></div><div>{dateEntries.map((entry) => renderItem(entry))}</div></div>) : <div className="calendar-empty"><CalendarDays size={28} /><h2>No scheduled calendar dates</h2><p>Add a task date, bill occurrence, or projected Google event and it will appear here.</p></div>}
    </section>}

    {view === "upcoming" && <section className="agenda-panel" aria-label="Upcoming Google Calendar events">
      <div className="toolbar" style={{ paddingTop: 18 }}>
        <div><p className="eyebrow">Next 45 days</p><h2>Upcoming Events</h2></div>
        <div className="segmented" role="group" aria-label="Upcoming event workspace">
          {authorizedWorkspaceIds.includes("personal") && <button className={upcomingScope === "personal" ? "active" : ""} onClick={() => setUpcomingScopeChoice("personal")}>Personal</button>}
          {authorizedWorkspaceIds.includes("indelitech") && <button className={upcomingScope === "indelitech" ? "active" : ""} onClick={() => setUpcomingScopeChoice("indelitech")}>Indelitech</button>}
          {canShowAll && <button className={upcomingScope === "all" ? "active" : ""} onClick={() => setUpcomingScopeChoice("all")}>All</button>}
          <button onClick={projectedEvents.refresh} aria-label="Refresh upcoming events"><RefreshCw size={13} /></button>
        </div>
      </div>
      {projectedEvents.loading ? <div className="calendar-empty"><RefreshCw size={26} /><h2>Refreshing events</h2><p>Reading the current 45-day projection.</p></div> :
        upcomingEntries.length ? Array.from(Map.groupBy(upcomingEntries, (entry) => entry.date)).map(([date, dateEntries]) => <div className="agenda-day" key={date}><div><time dateTime={date}>{dateLabel(date, "short")}</time><span>{date === today ? "Today" : ""}</span></div><div>{dateEntries.map((entry) => <CalendarEventItem key={entry.id} event={entry.event} authorizedWorkspaceIds={authorizedWorkspaceIds} onOpenTask={onOpenTask} onOverride={projectedEvents.setWorkspaceOverride} />)}</div></div>) :
        <div className="calendar-empty"><CalendarDays size={28} /><h2>No upcoming Google events</h2><p>{eventsEnabled ? "No projected Primary or Family Calendar events are in this workspace window." : "Hosted Google Calendar projection is not enabled in local mode."}</p></div>}
    </section>}

    {projectedBills.error && <p className="calendar-source-note"><WalletCards size={14} /> Bills could not be included right now: {projectedBills.error}</p>}
    {projectedEvents.error && <p className="calendar-source-note"><CalendarDays size={14} /> Google events could not be included right now: {projectedEvents.error}</p>}
    <p className="calendar-source-note"><CalendarDays size={14} /> Tasks and bills remain canonical records. Google events are read-only projections; workspace corrections stay inside DCC and do not modify Google Calendar.</p>
  </div>;
}

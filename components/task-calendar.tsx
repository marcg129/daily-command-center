"use client";

import { useMemo, useState } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, ListTodo } from "lucide-react";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { monthCalendarDays, shiftCalendarMonth, taskCalendarEntries, type TaskCalendarEntry } from "@/lib/task-calendar";
import type { TaskItem } from "@/lib/types";

const KIND_LABEL = { DUE: "Due", REMINDER: "Reminder", FOLLOW_UP: "Follow-up" } as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function productToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PRODUCT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

function entryTime(entry: TaskCalendarEntry) {
  if (!entry.timestamp) return "All day";
  return new Intl.DateTimeFormat("en-US", { timeZone: PRODUCT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(entry.timestamp));
}

function CalendarItem({ entry, onOpen, compact = false }: { entry: TaskCalendarEntry; onOpen: (taskId: TaskItem["id"]) => void; compact?: boolean }) {
  const Icon = entry.kind === "DUE" ? ListTodo : entry.kind === "REMINDER" ? Bell : Clock3;
  return <button
    type="button"
    className={`calendar-item priority-${entry.priority.toLowerCase()} ${entry.overdue ? "is-overdue" : ""}`}
    onClick={() => onOpen(entry.taskId)}
    aria-label={`${entry.task.title}, ${KIND_LABEL[entry.kind]} ${entry.date}${entry.overdue ? ", overdue" : ""}`}
    title={`${entry.task.title} · ${KIND_LABEL[entry.kind]} · ${entryTime(entry)}`}
  >
    <Icon size={compact ? 11 : 14} aria-hidden="true" />
    <span>{entry.task.title}</span>
    {!compact && <small>{KIND_LABEL[entry.kind]} · {entryTime(entry)}{entry.task.primaryWorkspaceId === "indelitech" ? " · Indelitech" : ""}</small>}
  </button>;
}

export function TaskCalendar({ tasks, workspaceId, onOpenTask }: { tasks: TaskItem[]; workspaceId: ProductWorkspaceId; onOpenTask: (taskId: TaskItem["id"]) => void }) {
  const today = productToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<"month" | "agenda">("month");
  const entries = useMemo(() => taskCalendarEntries(tasks, workspaceId), [tasks, workspaceId]);
  const days = useMemo(() => monthCalendarDays(month), [month]);
  const byDate = useMemo(() => Map.groupBy(entries, (entry) => entry.date), [entries]);
  const agenda = entries;
  return <div className="view calendar-view">
    <div className="page-heading">
      <div><p className="eyebrow">{workspaceId === "personal" ? "Personal + Indelitech" : "Indelitech"} · Task calendar</p><h1>Calendar</h1><p>{workspaceId === "personal" ? "One view of your personal and visible Indelitech task commitments." : "Indelitech task deadlines, reminders, and follow-ups only."}</p></div>
      <div className="segmented" role="group" aria-label="Calendar view"><button className={view === "month" ? "active" : ""} aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button><button className={view === "agenda" ? "active" : ""} aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>Agenda</button></div>
    </div>
    {view === "month" ? <section className="calendar-panel" aria-label={monthLabel(month)}>
      <div className="calendar-toolbar"><button aria-label="Previous month" onClick={() => setMonth((value) => shiftCalendarMonth(value, -1))}><ChevronLeft size={17} /></button><h2>{monthLabel(month)}</h2><button aria-label="Next month" onClick={() => setMonth((value) => shiftCalendarMonth(value, 1))}><ChevronRight size={17} /></button><button className="calendar-today" onClick={() => setMonth(today.slice(0, 7))}>Today</button></div>
      <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{days.map((date) => <section key={date} className={`calendar-day ${date.slice(0, 7) !== month ? "outside-month" : ""} ${date === today ? "is-today" : ""}`} aria-label={new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}><time dateTime={date}>{Number(date.slice(-2))}</time><div>{(byDate.get(date) || []).slice(0, 3).map((entry) => <CalendarItem key={entry.id} entry={entry} onOpen={onOpenTask} compact />)}{(byDate.get(date)?.length || 0) > 3 && <small className="calendar-more">+{byDate.get(date)!.length - 3} more</small>}</div></section>)}</div>
    </section> : <section className="agenda-panel" aria-label="Task calendar agenda">
      {agenda.length ? Array.from(Map.groupBy(agenda, (entry) => entry.date)).map(([date, dateEntries]) => <div className="agenda-day" key={date}><div><time dateTime={date}>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</time><span>{date === today ? "Today" : ""}</span></div><div>{dateEntries.map((entry) => <CalendarItem key={entry.id} entry={entry} onOpen={onOpenTask} />)}</div></div>) : <div className="calendar-empty"><CalendarDays size={28} /><h2>No scheduled task dates</h2><p>Add a due date, reminder, or follow-up to an open task and it will appear here.</p></div>}
    </section>}
    <p className="calendar-source-note"><CalendarDays size={14} /> Derived from canonical tasks. Calendar items do not create separate records.</p>
  </div>;
}

import type { ProductWorkspaceId } from "./runtime/context";
import { PRODUCT_TIME_ZONE } from "./product-time";
import { normalizeTaskPriority, taskIsActive, taskIsOverdue, visibleTaskItems } from "./tasks";
import type { TaskItem } from "./types";

export type TaskCalendarEntryKind = "DUE" | "REMINDER" | "FOLLOW_UP";

export type TaskCalendarEntry = {
  id: string;
  taskId: TaskItem["id"];
  task: TaskItem;
  kind: TaskCalendarEntryKind;
  date: string;
  timestamp?: string;
  overdue: boolean;
  priority: "LOW" | "MEDIUM" | "HIGH";
};

function productDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dueDate(task: TaskItem, now: Date) {
  if (task.due === "Today") return productDate(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return task.due;
  if (/^\d{4}-\d{2}-\d{2}T/.test(task.due) && Number.isFinite(Date.parse(task.due))) {
    return productDate(new Date(task.due));
  }
}

function timedEntry(task: TaskItem, kind: "REMINDER" | "FOLLOW_UP", timestamp?: string): TaskCalendarEntry | undefined {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return;
  return {
    id: `${typeof task.id}:${String(task.id)}:${kind}`,
    taskId: task.id,
    task,
    kind,
    date: productDate(new Date(timestamp)),
    timestamp,
    overdue: false,
    priority: normalizeTaskPriority(task.priority),
  };
}

export function taskCalendarEntries(tasks: TaskItem[], workspaceId: ProductWorkspaceId, now = new Date()) {
  const entries = visibleTaskItems(tasks, workspaceId).filter(taskIsActive).flatMap((task) => {
    const values: TaskCalendarEntry[] = [];
    const date = dueDate(task, now);
    if (date) values.push({
      id: `${typeof task.id}:${String(task.id)}:DUE`, taskId: task.id, task, kind: "DUE", date,
      timestamp: /^\d{4}-\d{2}-\d{2}T/.test(task.due) ? task.due : undefined,
      overdue: taskIsOverdue(task, now), priority: normalizeTaskPriority(task.priority),
    });
    const reminder = timedEntry(task, "REMINDER", task.remindAt);
    const followUp = timedEntry(task, "FOLLOW_UP", task.followUpAt);
    if (reminder) values.push({ ...reminder, overdue: Date.parse(reminder.timestamp!) < now.getTime() });
    if (followUp) values.push({ ...followUp, overdue: Date.parse(followUp.timestamp!) < now.getTime() });
    return values;
  });
  const kindRank: Record<TaskCalendarEntryKind, number> = { FOLLOW_UP: 0, REMINDER: 1, DUE: 2 };
  return entries.toSorted((a, b) => a.date.localeCompare(b.date) ||
    (a.timestamp || `${a.date}T23:59:59`).localeCompare(b.timestamp || `${b.date}T23:59:59`) ||
    kindRank[a.kind] - kindRank[b.kind] || String(a.taskId).localeCompare(String(b.taskId)));
}

export function taskCalendarEntriesForToday(tasks: TaskItem[], workspaceId: ProductWorkspaceId, now = new Date()) {
  const today = productDate(now);
  return taskCalendarEntries(tasks, workspaceId, now).filter((entry) => entry.date === today);
}

export function monthCalendarDays(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must use YYYY-MM.");
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1, 12));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

export function shiftCalendarMonth(month: string, amount: number) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + amount, 1, 12));
  return date.toISOString().slice(0, 7);
}

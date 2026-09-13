import { PRODUCT_TIME_ZONE } from "@/lib/product-time";
import { taskIsOverdue } from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function productDateValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: PRODUCT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function taskDueProductDate(task: TaskItem) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return task.due;
  const time = Date.parse(task.due);
  if (!Number.isFinite(time)) return null;
  return productDateValue(new Date(time));
}

/** Calendar-day age in the product timezone. Same-day timestamp misses return 0. */
export function taskOverdueAgeDays(task: TaskItem, now = new Date()): number | null {
  if (!taskIsOverdue(task, now)) return null;
  const dueDate = taskDueProductDate(task);
  if (!dueDate) return 0;
  return Math.max(0, calendarDay(productDateValue(now)) - calendarDay(dueDate));
}

export function taskOverdueBadgeLabel(task: TaskItem, now = new Date()): string | null {
  const days = taskOverdueAgeDays(task, now);
  if (days === null) return null;
  if (days === 0) return "OVERDUE · TODAY";
  return `OVERDUE · ${days} ${days === 1 ? "DAY" : "DAYS"}`;
}

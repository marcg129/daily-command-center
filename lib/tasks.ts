import type { TaskItem } from "./types";
import {
  isProductWorkspaceId,
  PERSONAL_WORKSPACE_ID,
  taskVisibleInWorkspace,
  type ProductWorkspaceId,
} from "./runtime/context";
import { effectivePriorityRank, isTaskOverdue, taskHorizonGroup, type HorizonGroup } from "./runtime/hosted-tasks";

const RECURRENCES = new Set(["One-time", "Daily", "Weekly", "Monthly"]);
const RECURRING_RECURRENCES = new Set(["Daily", "Weekly", "Monthly"]);
const RAPID_COMPLETION_GUARD_MS = 750;
export const PRODUCT_TIME_ZONE = "America/New_York";
export const VISIBLE_HORIZON_GROUPS: readonly HorizonGroup[] = [
  "OVERDUE", "TODAY", "NEXT_7_DAYS", "DAYS_8_14", "DAYS_15_30", "DAYS_31_45",
];

export function normalizeTaskPriority(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
  if (typeof value !== "string") return "MEDIUM";
  return ({ low: "LOW", normal: "MEDIUM", medium: "MEDIUM", high: "HIGH" } as const)[value.toLowerCase() as "low" | "normal" | "medium" | "high"] ?? "MEDIUM";
}

export function visibleTaskItems(tasks: TaskItem[], workspaceId: ProductWorkspaceId) {
  return tasks.filter((task) => taskVisibleInWorkspace(task.primaryWorkspaceId ?? PERSONAL_WORKSPACE_ID, workspaceId));
}

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

function hostedShape(task: TaskItem, now: Date) {
  return {
    dueAt: task.due === "Today"
      ? productDateValue(now)
      : /^\d{4}-\d{2}-\d{2}$/.test(task.due) ? task.due : null,
    dueIsDateOnly: true,
    status: task.done ? "DONE" as const : "OPEN" as const,
    priority: normalizeTaskPriority(task.priority),
  };
}

export function taskIsOverdue(task: TaskItem, now = new Date()) {
  return isTaskOverdue(hostedShape(task, now), now, PRODUCT_TIME_ZONE);
}

export function sortTaskAttention(tasks: TaskItem[], now = new Date()) {
  return tasks.filter((task) => !task.done).toSorted((a, b) => {
    const rank = effectivePriorityRank(hostedShape(b, now), now, PRODUCT_TIME_ZONE) - effectivePriorityRank(hostedShape(a, now), now, PRODUCT_TIME_ZONE);
    return rank || (a.due || "9999").localeCompare(b.due || "9999") ||
      (a.createdAt || "").localeCompare(b.createdAt || "") || String(a.id).localeCompare(String(b.id));
  });
}

export function taskHorizon(tasks: TaskItem[], now = new Date()) {
  const groups = new Map<HorizonGroup, TaskItem[]>(VISIBLE_HORIZON_GROUPS.map((group) => [group, []]));
  for (const task of sortTaskAttention(tasks, now)) {
    const group = taskHorizonGroup(hostedShape(task, now), now, PRODUCT_TIME_ZONE);
    if (group !== "LATER_OR_UNSCHEDULED") groups.get(group)!.push(task);
  }
  return groups;
}

export function createTaskItem(input: Pick<TaskItem, "title" | "due" | "priority"> & Partial<Pick<TaskItem, "description" | "recurrence">>, workspaceId: ProductWorkspaceId, id: TaskItem["id"] = crypto.randomUUID(), now = new Date()): TaskItem {
  return { id, title: input.title.trim(), description: input.description?.trim() || "No additional details.", due: input.due,
    recurrence: input.recurrence || "One-time", priority: normalizeTaskPriority(input.priority), primaryWorkspaceId: workspaceId,
    done: false, createdAt: now.toISOString() };
}

function dateValue(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromTaskValue(value: string, fallbackValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateFromTaskValue(fallbackValue, fallbackValue);
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addRecurrence(date: Date, recurrence: string, anchorDay?: number) {
  const next = new Date(date);
  if (recurrence === "Daily") next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === "Weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === "Monthly") {
    const desiredDay = anchorDay || next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const finalDay = new Date(Date.UTC(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      0,
      12,
    )).getUTCDate();
    next.setUTCDate(Math.min(desiredDay, finalDay));
  }
  return next;
}

export function nextRecurringDue(
  value: string,
  recurrence: string,
  now = new Date(),
  anchorDay?: number,
) {
  const todayValue = productDateValue(now);
  if (!RECURRING_RECURRENCES.has(recurrence)) return todayValue;
  let next = dateFromTaskValue(value, todayValue);
  const today = dateFromTaskValue(todayValue, todayValue);
  const recurrenceAnchor =
    recurrence === "Monthly" && Number.isInteger(anchorDay) && anchorDay! >= 1 && anchorDay! <= 31
      ? anchorDay
      : next.getUTCDate();
  do {
    next = addRecurrence(next, recurrence, recurrenceAnchor);
  } while (next <= today);
  return dateValue(next);
}

export function completeTaskItems(
  tasks: TaskItem[],
  taskId: TaskItem["id"],
  options: {
    now?: Date;
    occurrenceId?: TaskItem["id"];
    expectedDue?: string;
  } = {},
) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (
    !task ||
    task.done ||
    (options.expectedDue !== undefined && task.due !== options.expectedDue)
  ) return tasks;
  const now = options.now || new Date();
  const recentlyCompleted = tasks.some((candidate) => {
    if (!candidate.done || candidate.seriesId !== task.id || !candidate.completedAt)
      return false;
    const elapsed = now.getTime() - Date.parse(candidate.completedAt);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RAPID_COMPLETION_GUARD_MS;
  });
  if (recentlyCompleted) return tasks;
  const completedAt = now.toISOString();
  if (!RECURRING_RECURRENCES.has(task.recurrence)) {
    return tasks.map((candidate) =>
      candidate.id === taskId ? { ...candidate, done: true, completedAt } : candidate,
    );
  }
  const occurrence: TaskItem = {
    ...task,
    id: options.occurrenceId || crypto.randomUUID(),
    done: true,
    completedAt,
    seriesId: task.id,
  };
  const recurrenceAnchorDay =
    task.recurrence === "Monthly"
      ? task.recurrenceAnchorDay || dateFromTaskValue(task.due, productDateValue(now)).getUTCDate()
      : undefined;
  const advanced = tasks.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          due: nextRecurringDue(
            candidate.due,
            candidate.recurrence,
            now,
            recurrenceAnchorDay,
          ),
          done: false,
          completedAt: undefined,
          recurrenceAnchorDay,
        }
      : candidate,
  );
  return [occurrence, ...advanced];
}

export function recurringTaskRequiresDue(recurrence: string) {
  return RECURRING_RECURRENCES.has(recurrence);
}

function taskIdentity(task: Pick<TaskItem, "id">) {
  return `${typeof task.id}:${String(task.id)}`;
}

export function preserveRecurringCompletionHistory(
  existing: TaskItem[],
  incoming: TaskItem[],
) {
  const immutable = new Map(
    existing
      .filter((task) => task.done && task.seriesId !== undefined)
      .map((task) => [taskIdentity(task), task]),
  );
  const retained = new Set<string>();
  const merged = incoming.map((task) => {
    const key = taskIdentity(task);
    const prior = immutable.get(key);
    if (!prior) return task;
    retained.add(key);
    return prior;
  });
  for (const [key, task] of immutable) {
    if (!retained.has(key)) merged.push(task);
  }
  return merged;
}

function cleanId(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? value
    : crypto.randomUUID();
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function cleanTaskItems(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) throw new Error("Tasks must be a list.");
  if (value.length > 10_000) throw new Error("The task list is too large.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<TaskItem>;
    const title = cleanText(candidate.title).trim();
    if (!title) return [];
    const recurrence = cleanText(candidate.recurrence, "One-time");
    return [{
      id: cleanId(candidate.id),
      title,
      description: cleanText(
        candidate.description,
        "No additional details.",
      ),
      due: cleanText(candidate.due, "Today"),
      recurrence: RECURRENCES.has(recurrence) ? recurrence : "One-time",
      priority: normalizeTaskPriority(candidate.priority),
      primaryWorkspaceId: isProductWorkspaceId(candidate.primaryWorkspaceId)
        ? candidate.primaryWorkspaceId
        : PERSONAL_WORKSPACE_ID,
      done: candidate.done === true,
      createdAt: cleanText(candidate.createdAt) || undefined,
      completedAt: cleanText(candidate.completedAt) || undefined,
      seriesId:
        typeof candidate.seriesId === "string" ||
        typeof candidate.seriesId === "number"
          ? candidate.seriesId
          : undefined,
      recurrenceAnchorDay:
        typeof candidate.recurrenceAnchorDay === "number" &&
        Number.isInteger(candidate.recurrenceAnchorDay) &&
        candidate.recurrenceAnchorDay >= 1 &&
        candidate.recurrenceAnchorDay <= 31
          ? candidate.recurrenceAnchorDay
          : undefined,
    }];
  });
}

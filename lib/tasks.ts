import type { TaskItem } from "./types";
import {
  isProductWorkspaceId,
  PERSONAL_WORKSPACE_ID,
  taskVisibleInWorkspace,
  type ProductWorkspaceId,
} from "./runtime/context";
import { isTaskOverdue, TASK_STATUSES, TASK_TYPES, taskHorizonGroup, type HorizonGroup, type TaskStatus, type TaskType } from "./runtime/hosted-tasks";
import { PRODUCT_TIME_ZONE } from "./product-time";

const RECURRENCES = new Set(["One-time", "Daily", "Weekly", "Monthly"]);
const RECURRING_RECURRENCES = new Set(["Daily", "Weekly", "Monthly"]);
const RAPID_COMPLETION_GUARD_MS = 750;
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
    status: task.status ?? (task.done ? "DONE" as const : "OPEN" as const),
    priority: normalizeTaskPriority(task.priority),
  };
}

export function taskIsOverdue(task: TaskItem, now = new Date()) {
  return isTaskOverdue(hostedShape(task, now), now, PRODUCT_TIME_ZONE);
}

export function taskIsActive(task: TaskItem) {
  const status = task.status ?? (task.done ? "DONE" : "OPEN");
  return status === "OPEN" || status === "WAITING";
}

export function taskBaseType(task: Pick<TaskItem, "recurrence" | "due">): TaskType {
  if (RECURRING_RECURRENCES.has(task.recurrence)) return "RECURRING";
  return task.due ? "DEADLINE" : "ONE_TIME";
}

export function sortTaskAttention(tasks: TaskItem[], now = new Date()) {
  return tasks.filter((task) => attentionClass(task, now) > 0).toSorted((a, b) => {
    const aClass = attentionClass(a, now); const bClass = attentionClass(b, now);
    const rank = bClass - aClass;
    return rank || attentionTime(a, aClass).localeCompare(attentionTime(b, bClass)) ||
      (a.createdAt || "").localeCompare(b.createdAt || "") || String(a.id).localeCompare(String(b.id));
  });
}

function parsedAt(value?: string) { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : undefined; }
function attentionClass(task: TaskItem, now: Date) {
  const status = task.status ?? (task.done ? "DONE" : "OPEN");
  if (status === "DONE" || status === "CANCELLED") return 0;
  if (status === "WAITING") return (parsedAt(task.followUpAt) ?? Infinity) <= now.getTime() ? 5 : 0;
  if (taskIsOverdue(task, now)) return 6;
  if ((parsedAt(task.remindAt) ?? Infinity) <= now.getTime()) return 4;
  return { HIGH: 3, MEDIUM: 2, LOW: 1 }[normalizeTaskPriority(task.priority)];
}
function attentionTime(task: TaskItem, attention: number) {
  if (attention === 5) return task.followUpAt || "9999";
  if (attention === 4) return task.remindAt || "9999";
  return task.due || "9999";
}

export function taskAttentionLabel(task: TaskItem, now = new Date()) {
  if (taskIsOverdue(task, now)) return "Overdue";
  if ((task.status ?? (task.done ? "DONE" : "OPEN")) === "WAITING" && (parsedAt(task.followUpAt) ?? Infinity) <= now.getTime()) return "Follow-up due";
  if ((parsedAt(task.remindAt) ?? Infinity) <= now.getTime()) return "Reminder due";
  return task.due || "No due date";
}

export function taskHorizon(tasks: TaskItem[], now = new Date()) {
  const groups = new Map<HorizonGroup, TaskItem[]>(VISIBLE_HORIZON_GROUPS.map((group) => [group, []]));
  const dueDriven = tasks.filter(taskIsActive).toSorted((a, b) => {
    const aDue = hostedShape(a, now).dueAt || "9999";
    const bDue = hostedShape(b, now).dueAt || "9999";
    return aDue.localeCompare(bDue) ||
      (a.createdAt || "").localeCompare(b.createdAt || "") || String(a.id).localeCompare(String(b.id));
  });
  for (const task of dueDriven) {
    const group = taskHorizonGroup(hostedShape(task, now), now, PRODUCT_TIME_ZONE);
    if (group !== "LATER_OR_UNSCHEDULED") groups.get(group)!.push(task);
  }
  return groups;
}

export function createTaskItem(input: Pick<TaskItem, "title" | "due" | "priority"> & Partial<Pick<TaskItem, "description" | "recurrence">>, workspaceId: ProductWorkspaceId, id: TaskItem["id"] = crypto.randomUUID(), now = new Date()): TaskItem {
  return { id, title: input.title.trim(), description: input.description?.trim() || "No additional details.", due: input.due,
    recurrence: input.recurrence || "One-time", priority: normalizeTaskPriority(input.priority), primaryWorkspaceId: workspaceId,
    done: false, status: "OPEN", type: input.recurrence && input.recurrence !== "One-time" ? "RECURRING" : input.due ? "DEADLINE" : "ONE_TIME", createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function updateTaskItem(tasks: TaskItem[], taskId: TaskItem["id"], patch: Partial<TaskItem>, now = new Date()) {
  return tasks.map((task) => task.id === taskId ? { ...task, ...patch, updatedAt: now.toISOString() } : task);
}
export function setTaskReminder(tasks: TaskItem[], taskId: TaskItem["id"], remindAt: string, now = new Date()) {
  if (!Number.isFinite(Date.parse(remindAt))) throw new Error("Reminder must be an ISO timestamp.");
  return updateTaskItem(tasks, taskId, { remindAt: new Date(remindAt).toISOString() }, now);
}
export function markTaskWaiting(tasks: TaskItem[], taskId: TaskItem["id"], person: string, followUpAt: string, now = new Date()) {
  if (!person.trim() || !Number.isFinite(Date.parse(followUpAt))) throw new Error("Waiting requires a person and follow-up time.");
  return updateTaskItem(tasks, taskId, { status: "WAITING", type: "WAITING", done: false, person: person.trim(), followUpAt: new Date(followUpAt).toISOString() }, now);
}
export function resumeTask(tasks: TaskItem[], taskId: TaskItem["id"], now = new Date()) {
  return tasks.map((task) => task.id === taskId ? {
    ...task,
    status: "OPEN",
    type: taskBaseType(task),
    followUpAt: undefined,
    updatedAt: now.toISOString(),
  } : task); // Keep person as useful context.
}
export function cancelTask(tasks: TaskItem[], taskId: TaskItem["id"], now = new Date()) {
  return updateTaskItem(tasks, taskId, { status: "CANCELLED", done: false }, now);
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
): TaskItem[] {
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
      candidate.id === taskId ? { ...candidate, done: true, status: "DONE" as const, completedAt, updatedAt: completedAt } : candidate,
    );
  }
  const occurrence: TaskItem = {
    ...task,
    id: options.occurrenceId || crypto.randomUUID(),
    done: true,
    status: "DONE",
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
          status: "OPEN" as const,
          type: taskBaseType(candidate),
          completedAt: undefined,
          remindAt: undefined,
          followUpAt: undefined,
          recurrenceAnchorDay,
          updatedAt: completedAt,
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
    const due = cleanText(candidate.due, "Today");
    const status: TaskStatus = TASK_STATUSES.includes(candidate.status as TaskStatus) ? candidate.status as TaskStatus : candidate.done === true ? "DONE" : "OPEN";
    const type: TaskType = TASK_TYPES.includes(candidate.type as TaskType) ? candidate.type as TaskType : recurrence !== "One-time" ? "RECURRING" : due ? "DEADLINE" : "ONE_TIME";
    const cleanIso = (input: unknown) => typeof input === "string" && Number.isFinite(Date.parse(input)) ? new Date(input).toISOString() : undefined;
    return [{
      id: cleanId(candidate.id),
      title,
      description: cleanText(
        candidate.description,
        "No additional details.",
      ),
      due,
      recurrence: RECURRENCES.has(recurrence) ? recurrence : "One-time",
      priority: normalizeTaskPriority(candidate.priority),
      primaryWorkspaceId: isProductWorkspaceId(candidate.primaryWorkspaceId)
        ? candidate.primaryWorkspaceId
        : PERSONAL_WORKSPACE_ID,
      done: status === "DONE",
      status,
      type,
      remindAt: cleanIso(candidate.remindAt),
      followUpAt: cleanIso(candidate.followUpAt),
      person: cleanText(candidate.person).trim() || undefined,
      category: cleanText(candidate.category).trim() || undefined,
      project: cleanText(candidate.project).trim() || undefined,
      estimatedDuration: ["5m", "15m", "30m", "1h", "2h+", "Project"].includes(cleanText(candidate.estimatedDuration))
        ? candidate.estimatedDuration
        : undefined,
      dependency: cleanText(candidate.dependency).trim() || undefined,
      source: cleanText(candidate.source).trim() || undefined,
      sourceContext: cleanText(candidate.sourceContext).trim() || undefined,
      updatedAt: cleanIso(candidate.updatedAt),
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

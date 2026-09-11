import type { ProductWorkspaceId } from "@/lib/runtime/context";

export const TASK_TYPES = ["ONE_TIME", "DEADLINE", "FOLLOW_UP", "WAITING", "RECURRING", "BACKLOG"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const TASK_STATUSES = ["OPEN", "WAITING", "DONE", "CANCELLED"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type HostedTask = {
  taskId: string; primaryWorkspaceId: ProductWorkspaceId; title: string; context: string | null;
  category: string | null; project: string | null; person: string | null; type: TaskType;
  priority: TaskPriority; status: TaskStatus; dueAt: string | null; dueIsDateOnly: boolean;
  remindAt: string | null; followUpAt: string | null; estimatedDuration: number | null;
  recurrence: string | null; dependency: string | null; createdAt: string; completedAt: string | null;
  source: string; sourceContext: string | null; lastNotifiedAt: string | null; updatedAt: string;
};

export type HorizonGroup = "OVERDUE" | "TODAY" | "NEXT_7_DAYS" | "DAYS_8_14" | "DAYS_15_30" | "DAYS_31_45" | "LATER_OR_UNSCHEDULED";

function localDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isTaskOverdue(task: Pick<HostedTask, "dueAt" | "dueIsDateOnly" | "status">, now: Date, timeZone: string): boolean {
  if (!task.dueAt || task.status === "DONE" || task.status === "CANCELLED") return false;
  if (task.dueIsDateOnly) return task.dueAt.slice(0, 10) < localDate(now, timeZone);
  const due = Date.parse(task.dueAt);
  return Number.isFinite(due) && due < now.getTime();
}

export function effectivePriorityRank(task: Pick<HostedTask, "dueAt" | "dueIsDateOnly" | "status" | "priority">, now: Date, timeZone: string) {
  if (isTaskOverdue(task, now, timeZone)) return 4;
  return { HIGH: 3, MEDIUM: 2, LOW: 1 }[task.priority];
}

export function taskHorizonGroup(task: Pick<HostedTask, "dueAt" | "dueIsDateOnly" | "status">, now: Date, timeZone: string): HorizonGroup {
  if (!task.dueAt) return "LATER_OR_UNSCHEDULED";
  if (isTaskOverdue(task, now, timeZone)) return "OVERDUE";
  const today = localDate(now, timeZone);
  const dueDate = task.dueIsDateOnly ? task.dueAt.slice(0, 10) : localDate(new Date(task.dueAt), timeZone);
  if (dueDate === today) return "TODAY";
  const day = 86_400_000;
  const delta = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / day);
  if (delta <= 7) return "NEXT_7_DAYS";
  if (delta <= 14) return "DAYS_8_14";
  if (delta <= 30) return "DAYS_15_30";
  if (delta <= 45) return "DAYS_31_45";
  return "LATER_OR_UNSCHEDULED";
}

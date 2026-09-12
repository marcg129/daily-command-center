import type { ProductWorkspaceId } from "./runtime/context";
import type { TaskItem } from "./types";
import { normalizeTaskPriority, taskHorizon, taskIsActive, visibleTaskItems } from "./tasks";

export const TASK_PLANNING_PRIORITY_FILTERS = ["ALL", "HIGH", "MEDIUM", "LOW"] as const;
export const TASK_PLANNING_DUE_FILTERS = ["ALL", "OVERDUE", "TODAY", "NEXT_7_DAYS", "LATER", "UNSCHEDULED"] as const;
export const TASK_PLANNING_DURATION_FILTERS = ["ALL", "QUICK", "ONE_HOUR", "LONG", "UNESTIMATED"] as const;

export type TaskPlanningPriorityFilter = (typeof TASK_PLANNING_PRIORITY_FILTERS)[number];
export type TaskPlanningDueFilter = (typeof TASK_PLANNING_DUE_FILTERS)[number];
export type TaskPlanningDurationFilter = (typeof TASK_PLANNING_DURATION_FILTERS)[number];
export type TaskPlanningDueBucket = Exclude<TaskPlanningDueFilter, "ALL">;
export type TaskPlanningDurationBucket = Exclude<TaskPlanningDurationFilter, "ALL">;

export type TaskPlanningFilters = {
  priority: TaskPlanningPriorityFilter;
  due: TaskPlanningDueFilter;
  duration: TaskPlanningDurationFilter;
};

export const DEFAULT_TASK_PLANNING_FILTERS: TaskPlanningFilters = {
  priority: "ALL",
  due: "ALL",
  duration: "ALL",
};

export function taskPlanningDueBucket(task: TaskItem, now = new Date()): TaskPlanningDueBucket {
  const horizon = taskHorizon([task], now);
  if (horizon.get("OVERDUE")?.length) return "OVERDUE";
  if (horizon.get("TODAY")?.length) return "TODAY";
  if (horizon.get("NEXT_7_DAYS")?.length) return "NEXT_7_DAYS";
  return task.due ? "LATER" : "UNSCHEDULED";
}

export function taskPlanningDurationBucket(task: TaskItem): TaskPlanningDurationBucket {
  if (!task.estimatedDuration) return "UNESTIMATED";
  if (["5m", "15m", "30m"].includes(task.estimatedDuration)) return "QUICK";
  if (task.estimatedDuration === "1h") return "ONE_HOUR";
  return "LONG";
}

export function taskMatchesPlanningFilters(
  task: TaskItem,
  filters: TaskPlanningFilters,
  now = new Date(),
) {
  return (filters.priority === "ALL" || normalizeTaskPriority(task.priority) === filters.priority)
    && (filters.due === "ALL" || taskPlanningDueBucket(task, now) === filters.due)
    && (filters.duration === "ALL" || taskPlanningDurationBucket(task) === filters.duration);
}

export function taskPlanningItems(
  tasks: TaskItem[],
  workspaceId: ProductWorkspaceId,
  filters: TaskPlanningFilters = DEFAULT_TASK_PLANNING_FILTERS,
  now = new Date(),
) {
  return visibleTaskItems(tasks, workspaceId)
    .filter(taskIsActive)
    .filter((task) => taskMatchesPlanningFilters(task, filters, now));
}

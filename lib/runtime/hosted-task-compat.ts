import { isProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTask, TaskPriority, TaskStatus, TaskType } from "@/lib/runtime/hosted-tasks";
import type { CaptureDuration } from "@/lib/runtime/task-capture";
import type { TaskItem } from "@/lib/types";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const durationMinutes: Record<CaptureDuration, number | null> = {
  "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h+": 120, Project: null,
};
const minuteLabels = new Map<number, CaptureDuration>([[5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"], [120, "2h+"]]);

function stringId(value: unknown, field = "Task ID"): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} must be a non-empty string for hosted tasks.`);
  return value;
}

function statusOf(task: TaskItem): TaskStatus {
  return task.status ?? (task.done ? "DONE" : "OPEN");
}

function typeOf(task: TaskItem): TaskType {
  if (task.type) return task.type;
  if (["Daily", "Weekly", "Monthly"].includes(task.recurrence)) return "RECURRING";
  return task.due ? "DEADLINE" : "ONE_TIME";
}

function priorityOf(value: string): TaskPriority {
  const priority = value.toUpperCase();
  if (priority === "LOW" || priority === "HIGH") return priority;
  return "MEDIUM";
}

/** Maps the canonical hosted record to the existing task-surface model without formatting due timestamps. */
export function hostedTaskToTaskItem(task: HostedTask): TaskItem {
  const duration = task.estimatedDurationLabel ??
    (task.estimatedDuration == null ? undefined : minuteLabels.get(task.estimatedDuration));
  return {
    id: task.taskId,
    primaryWorkspaceId: task.primaryWorkspaceId,
    title: task.title,
    description: task.context ?? "",
    category: task.category ?? undefined,
    project: task.project ?? undefined,
    person: task.person ?? undefined,
    type: task.type,
    priority: task.priority,
    status: task.status,
    done: task.status === "DONE",
    due: task.dueAt ?? "",
    remindAt: task.remindAt ?? undefined,
    followUpAt: task.followUpAt ?? undefined,
    estimatedDuration: duration,
    recurrence: task.recurrence ?? "One-time",
    seriesId: task.seriesId ?? undefined,
    recurrenceAnchorDay: task.recurrenceAnchorDay ?? undefined,
    dependency: task.dependency ?? undefined,
    createdAt: task.createdAt,
    completedAt: task.completedAt ?? undefined,
    source: task.source,
    sourceContext: task.sourceContext ?? undefined,
    captureFingerprint: task.captureFingerprint ?? undefined,
    updatedAt: task.updatedAt,
  };
}

/**
 * Maps a task-surface value to D1. Passing the existing row makes UI-style updates
 * preserve values which the UI cannot represent and immutable capture metadata.
 */
export function taskItemToHostedTask(task: TaskItem, now: string, existing?: HostedTask): HostedTask {
  const taskId = stringId(task.id);
  if (task.seriesId !== undefined) stringId(task.seriesId, "Task series ID");
  const workspace = existing?.primaryWorkspaceId ?? task.primaryWorkspaceId;
  if (!isProductWorkspaceId(workspace)) throw new Error("Task workspace owner is invalid.");
  if (existing && task.primaryWorkspaceId !== undefined && task.primaryWorkspaceId !== existing.primaryWorkspaceId)
    throw new Error("Task workspace ownership is immutable.");
  if (!task.title.trim()) throw new Error("Task title is required.");
  const label = task.estimatedDuration;
  const dueAt = task.due || null;
  return {
    taskId,
    primaryWorkspaceId: workspace,
    title: task.title,
    context: task.description || null,
    category: task.category || null,
    project: task.project || null,
    person: task.person || null,
    type: typeOf(task),
    priority: priorityOf(task.priority),
    status: statusOf(task),
    dueAt,
    dueIsDateOnly: dueAt !== null && dateOnly.test(dueAt),
    remindAt: task.remindAt || null,
    followUpAt: task.followUpAt || null,
    estimatedDuration: label ? durationMinutes[label] : null,
    estimatedDurationLabel: label ?? null,
    recurrence: task.recurrence === "One-time" || !task.recurrence ? null : task.recurrence,
    seriesId: task.seriesId === undefined ? null : String(task.seriesId),
    recurrenceAnchorDay: task.recurrenceAnchorDay ?? null,
    dependency: task.dependency || null,
    createdAt: existing?.createdAt ?? task.createdAt ?? now,
    completedAt: task.completedAt || null,
    source: task.source || existing?.source || "manual",
    sourceContext: task.sourceContext || null,
    captureFingerprint: existing?.captureFingerprint ?? task.captureFingerprint ?? null,
    lastNotifiedAt: existing?.lastNotifiedAt ?? null,
    updatedAt: task.updatedAt ?? now,
  };
}

import type { TaskItem } from "@/lib/types";

export type TaskMutation =
  | { kind: "CREATE"; task: TaskItem }
  | { kind: "UPDATE"; taskId: TaskItem["id"]; task: TaskItem }
  | { kind: "DELETE"; taskId: TaskItem["id"] };

export type TaskMutationRepository = {
  read(): Promise<TaskItem[]>;
  apply(mutations: TaskMutation[], now: string): Promise<TaskItem[]>;
};

function identity(id: TaskItem["id"]) {
  return `${typeof id}:${String(id)}`;
}

function canonicalValue(task: TaskItem) {
  return JSON.stringify({
    id: task.id, title: task.title, description: task.description, due: task.due,
    recurrence: task.recurrence, priority: task.priority,
    primaryWorkspaceId: task.primaryWorkspaceId, done: task.done,
    type: task.type, status: task.status, remindAt: task.remindAt,
    followUpAt: task.followUpAt, person: task.person, category: task.category,
    project: task.project, estimatedDuration: task.estimatedDuration,
    dependency: task.dependency, source: task.source, sourceContext: task.sourceContext,
    captureFingerprint: task.captureFingerprint,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt, completedAt: task.completedAt,
    seriesId: task.seriesId, recurrenceAnchorDay: task.recurrenceAnchorDay,
  });
}

/** Produces a stable ID-sorted batch from two already-canonical task snapshots. */
export function diffTaskItems(previous: TaskItem[], current: TaskItem[]): TaskMutation[] {
  const before = new Map(previous.map((task) => [identity(task.id), task]));
  const after = new Map(current.map((task) => [identity(task.id), task]));
  const operations: TaskMutation[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of [...keys].sort()) {
    const oldTask = before.get(key);
    const task = after.get(key);
    if (!oldTask && task) operations.push({ kind: "CREATE", task });
    else if (oldTask && task && canonicalValue(oldTask) !== canonicalValue(task))
      operations.push({ kind: "UPDATE", taskId: oldTask.id, task });
    else if (oldTask && !task && !(oldTask.done && oldTask.seriesId !== undefined))
      operations.push({ kind: "DELETE", taskId: oldTask.id });
  }
  return operations;
}

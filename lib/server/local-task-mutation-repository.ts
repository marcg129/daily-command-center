import type { DatabaseSync } from "node:sqlite";
import { isProductWorkspaceId } from "@/lib/runtime/context";
import type { TaskMutation, TaskMutationRepository } from "@/lib/runtime/task-mutations";
import { cleanTaskItems } from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";
import { readWorkspaceState } from "@/lib/workspace-store";

function identity(id: TaskItem["id"]) { return `${typeof id}:${String(id)}`; }
function protectedOccurrence(task: TaskItem) { return task.done && task.seriesId !== undefined; }

function normalizeMutationTask(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("A mutation task is required.");
  const candidate = value as Partial<TaskItem>;
  if (typeof candidate.id !== "string" && typeof candidate.id !== "number") throw new Error("Task ID is invalid.");
  if (typeof candidate.title !== "string" || !candidate.title.trim()) throw new Error("Task title is required.");
  if (!isProductWorkspaceId(candidate.primaryWorkspaceId)) throw new Error("Task workspace owner is invalid.");
  const normalized = cleanTaskItems([candidate]);
  if (normalized.length !== 1) throw new Error("Task data is invalid.");
  return normalized[0];
}

export class LocalTaskMutationRepository implements TaskMutationRepository {
  constructor(private readonly database: () => DatabaseSync) {}

  async read() { return cleanTaskItems(readWorkspaceState(this.database()).tasks); }

  async apply(mutations: TaskMutation[], now: string) {
    if (!Array.isArray(mutations) || mutations.length === 0) throw new Error("At least one task mutation is required.");
    const database = this.database();
    database.exec("BEGIN IMMEDIATE");
    try {
      const persisted = cleanTaskItems(readWorkspaceState(database).tasks);
      const tasks = new Map(persisted.map((task) => [identity(task.id), task]));
      const touched = new Set<string>();
      for (const mutation of mutations) {
        if (!mutation || typeof mutation !== "object" || !["CREATE", "UPDATE", "DELETE"].includes(mutation.kind))
          throw new Error("Unknown task mutation.");
        const rawId = mutation.kind === "CREATE" ? mutation.task?.id : mutation.taskId;
        if (typeof rawId !== "string" && typeof rawId !== "number") throw new Error("Task ID is invalid.");
        const key = identity(rawId);
        if (touched.has(key)) throw new Error("A task ID may only appear once in a mutation batch.");
        touched.add(key);
        if (mutation.kind === "CREATE") {
          const task = normalizeMutationTask(mutation.task);
          if (tasks.has(key)) throw new Error("Task ID already exists.");
          tasks.set(key, task);
        } else if (mutation.kind === "UPDATE") {
          const existing = tasks.get(key);
          if (!existing) throw new Error("Task to update does not exist.");
          const task = normalizeMutationTask(mutation.task);
          if (identity(task.id) !== key) throw new Error("An update cannot change the task ID.");
          if (task.primaryWorkspaceId !== existing.primaryWorkspaceId) throw new Error("Task workspace ownership is immutable.");
          if (protectedOccurrence(existing)) throw new Error("Completed recurring history is immutable.");
          tasks.set(key, task);
        } else {
          const existing = tasks.get(key);
          if (!existing) throw new Error("Task to delete does not exist.");
          if (protectedOccurrence(existing)) throw new Error("Completed recurring history is immutable.");
          tasks.delete(key);
        }
      }
      const result = [...tasks.values()];
      database.prepare("UPDATE workspace_state SET payload_json = ?, updated_at = ? WHERE state_key = 'tasks'")
        .run(JSON.stringify(result), now);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

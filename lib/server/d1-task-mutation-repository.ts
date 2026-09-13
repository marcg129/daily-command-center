import {
  INDELITECH_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
  requireHostedContext,
  taskVisibleInWorkspace,
  type ProductWorkspaceId,
  type RequestContext,
} from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import { hostedTaskToTaskItem, taskItemToHostedTask } from "@/lib/runtime/hosted-task-compat";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import type { TaskMutation, TaskMutationRepository } from "@/lib/runtime/task-mutations";
import type { TaskItem } from "@/lib/types";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import {
  resolveAuthorizedWorkspaceInstances,
  workspaceInstanceContext,
} from "@/lib/server/d1-workspace-instances";

type PlannedMutation =
  | { kind: "CREATE"; id: string; task: HostedTask }
  | { kind: "UPDATE"; id: string; task: HostedTask; existing: HostedTask }
  | { kind: "DELETE"; id: string; existing: HostedTask };

const columns = `task_id, primary_workspace_id, title, context, category, project, person, type, priority, status,
 due_at, due_is_date_only, remind_at, follow_up_at, estimated_duration, recurrence, series_id, recurrence_anchor_day, dependency, created_at,
 completed_at, source, source_context, last_notified_at, updated_at, capture_fingerprint, estimated_duration_label`;

function values(task: HostedTask, primaryWorkspaceId: string = task.primaryWorkspaceId) {
  return [task.taskId, primaryWorkspaceId, task.title, task.context, task.category, task.project, task.person,
    task.type, task.priority, task.status, task.dueAt, task.dueIsDateOnly ? 1 : 0, task.remindAt, task.followUpAt,
    task.estimatedDuration, task.recurrence, task.seriesId, task.recurrenceAnchorDay, task.dependency, task.createdAt,
    task.completedAt, task.source, task.sourceContext, task.lastNotifiedAt, task.updatedAt, task.captureFingerprint ?? null,
    task.estimatedDurationLabel ?? null];
}

function requireMutationId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Hosted task mutation IDs must be non-empty strings.");
  return value;
}

function visibility(owner: ProductWorkspaceId): ProductWorkspaceId[] {
  return owner === INDELITECH_WORKSPACE_ID
    ? [INDELITECH_WORKSPACE_ID, PERSONAL_WORKSPACE_ID]
    : [PERSONAL_WORKSPACE_ID];
}

function validRolledUpOccurrence(occurrence: HostedTask, parent: HostedTask, update: HostedTask) {
  return parent.primaryWorkspaceId === INDELITECH_WORKSPACE_ID &&
    parent.recurrence !== null && ["Daily", "Weekly", "Monthly"].includes(parent.recurrence) &&
    occurrence.status === "DONE" && occurrence.seriesId === parent.taskId &&
    occurrence.primaryWorkspaceId === parent.primaryWorkspaceId && occurrence.recurrence === parent.recurrence &&
    occurrence.title === parent.title && occurrence.dueAt === parent.dueAt &&
    update.taskId === parent.taskId && update.primaryWorkspaceId === parent.primaryWorkspaceId &&
    update.recurrence === parent.recurrence && update.dueAt !== parent.dueAt;
}

export class D1TaskMutationRepository implements TaskMutationRepository {
  private readonly tasks: D1TaskRepository;
  constructor(private readonly database: D1Database, private readonly context: RequestContext) {
    this.tasks = new D1TaskRepository(database);
    requireHostedContext(context);
  }

  async read(): Promise<TaskItem[]> {
    return (await this.tasks.list(this.context)).map(hostedTaskToTaskItem);
  }

  async apply(mutations: TaskMutation[], now: string): Promise<TaskItem[]> {
    if (!Array.isArray(mutations) || mutations.length === 0) throw new Error("At least one task mutation is required.");
    const workspaceId = requireHostedContext(this.context);
    const instance = workspaceInstanceContext(this.context);
    const visible = await this.tasks.list(this.context);
    const byId = new Map(visible.map((task) => [task.taskId, task]));
    const touched = new Set<string>();
    const planned: PlannedMutation[] = mutations.map((mutation) => {
      if (!mutation || !["CREATE", "UPDATE", "DELETE"].includes(mutation.kind)) throw new Error("Unknown task mutation.");
      const id = requireMutationId(mutation.kind === "CREATE" ? mutation.task?.id : mutation.taskId);
      if (touched.has(id)) throw new Error("A task ID may only appear once in a mutation batch.");
      touched.add(id);
      if (mutation.kind === "CREATE") return { kind: mutation.kind, id, task: taskItemToHostedTask(mutation.task, now) };
      const existing = byId.get(id);
      if (!existing) throw new Error(`Visible task ${id} does not exist.`);
      if (mutation.kind === "DELETE") return { kind: mutation.kind, id, existing };
      if (requireMutationId(mutation.task.id) !== id) throw new Error("An update cannot change the task ID.");
      return { kind: mutation.kind, id, existing, task: taskItemToHostedTask(mutation.task, now, existing) };
    });

    for (const operation of planned) {
      if (operation.kind !== "CREATE") continue;
      if (operation.task.primaryWorkspaceId === workspaceId) continue;
      const parentOperation = planned.find((candidate): candidate is Extract<PlannedMutation, { kind: "UPDATE" }> =>
        candidate.kind === "UPDATE" && candidate.task.taskId === operation.task.seriesId);
      const parent = operation.task.seriesId ? byId.get(operation.task.seriesId) : undefined;
      if (workspaceId !== PERSONAL_WORKSPACE_ID || !parent || !parentOperation ||
          !validRolledUpOccurrence(operation.task, parent, parentOperation.task)) {
        throw new Error("A task may only be created in the authorized primary workspace.");
      }
    }

    const requiredWorkspaceKeys = new Set<ProductWorkspaceId>([workspaceId]);
    for (const operation of planned) {
      if (operation.kind !== "CREATE") continue;
      requiredWorkspaceKeys.add(operation.task.primaryWorkspaceId);
      for (const target of visibility(operation.task.primaryWorkspaceId)) requiredWorkspaceKeys.add(target);
    }
    const instances = await resolveAuthorizedWorkspaceInstances(
      this.database,
      this.context,
      [...requiredWorkspaceKeys],
    );
    const currentPhysicalWorkspaceId = instance.userId === null
      ? workspaceId
      : instances.get(workspaceId);
    if (!currentPhysicalWorkspaceId) throw new Error("Workspace access denied.");

    const statements: D1PreparedStatement[] = [];
    for (const operation of planned) {
      if (operation.kind === "CREATE") {
        const physicalPrimaryWorkspaceId = instances.get(operation.task.primaryWorkspaceId);
        if (!physicalPrimaryWorkspaceId) throw new Error("Workspace access denied.");
        const placeholders = Array.from({ length: values(operation.task, physicalPrimaryWorkspaceId).length }, () => "?").join(",");
        statements.push(this.database.prepare(`INSERT INTO tasks (${columns}) VALUES (${placeholders})`).bind(
          ...values(operation.task, physicalPrimaryWorkspaceId),
        ));
        for (const target of visibility(operation.task.primaryWorkspaceId)) {
          if (!taskVisibleInWorkspace(operation.task.primaryWorkspaceId, target)) throw new Error("Invalid task visibility.");
          const physicalTarget = instances.get(target);
          if (!physicalTarget) throw new Error("Workspace access denied.");
          statements.push(this.database.prepare("INSERT INTO task_visibility (task_id, workspace_id) VALUES (?, ?)").bind(
            operation.id,
            physicalTarget,
          ));
        }
      } else if (operation.kind === "UPDATE") {
        const mutable = values(operation.task).slice(2);
        statements.push(this.database.prepare(`UPDATE tasks SET title=?, context=?, category=?, project=?, person=?, type=?, priority=?, status=?, due_at=?,
          due_is_date_only=?, remind_at=?, follow_up_at=?, estimated_duration=?, recurrence=?, series_id=?, recurrence_anchor_day=?, dependency=?, created_at=?, completed_at=?, source=?,
          source_context=?, last_notified_at=?, updated_at=?, capture_fingerprint=?, estimated_duration_label=? WHERE task_id=? AND EXISTS
          (SELECT 1 FROM task_visibility WHERE task_id=tasks.task_id AND workspace_id=?)`).bind(
            ...mutable,
            operation.id,
            currentPhysicalWorkspaceId,
          ));
      } else {
        statements.push(this.database.prepare(`DELETE FROM tasks WHERE task_id=? AND EXISTS
          (SELECT 1 FROM task_visibility WHERE task_id=tasks.task_id AND workspace_id=?)`).bind(
            operation.id,
            currentPhysicalWorkspaceId,
          ));
      }
    }
    const results = await this.database.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) throw new Error("D1 task mutation batch failed.");
    return this.read();
  }
}

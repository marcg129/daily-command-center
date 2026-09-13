import {
  requireHostedContext,
  taskVisibleInWorkspace,
  type ProductWorkspaceId,
  type RequestContext,
} from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import {
  resolveAuthorizedWorkspaceInstances,
  workspaceInstanceContext,
} from "@/lib/server/d1-workspace-instances";

type TaskRow = Record<string, unknown>;
const columns = `task_id, primary_workspace_id, title, context, category, project, person, type, priority, status,
 due_at, due_is_date_only, remind_at, follow_up_at, estimated_duration, recurrence, series_id, recurrence_anchor_day, dependency, created_at,
 completed_at, source, source_context, last_notified_at, updated_at, capture_fingerprint, estimated_duration_label`;
const selectedColumns = columns.split(",").map((column) => `t.${column.trim()}`).join(", ");

function fromRow(row: TaskRow): HostedTask {
  return {
    taskId: String(row.task_id),
    primaryWorkspaceId: String(row.primary_workspace_key ?? row.primary_workspace_id) as ProductWorkspaceId,
    title: String(row.title), context: row.context as string | null, category: row.category as string | null,
    project: row.project as string | null, person: row.person as string | null, type: row.type as HostedTask["type"],
    priority: row.priority as HostedTask["priority"], status: row.status as HostedTask["status"],
    dueAt: row.due_at as string | null, dueIsDateOnly: Number(row.due_is_date_only) === 1,
    remindAt: row.remind_at as string | null, followUpAt: row.follow_up_at as string | null,
    estimatedDuration: row.estimated_duration == null ? null : Number(row.estimated_duration), recurrence: row.recurrence as string | null,
    seriesId: row.series_id as string | null,
    recurrenceAnchorDay: row.recurrence_anchor_day == null ? null : Number(row.recurrence_anchor_day),
    dependency: row.dependency as string | null, createdAt: String(row.created_at), completedAt: row.completed_at as string | null,
    source: String(row.source), sourceContext: row.source_context as string | null,
    lastNotifiedAt: row.last_notified_at as string | null, updatedAt: String(row.updated_at),
    captureFingerprint: row.capture_fingerprint as string | null,
    estimatedDurationLabel: row.estimated_duration_label as HostedTask["estimatedDurationLabel"],
  };
}

function values(task: HostedTask, primaryWorkspaceId: string = task.primaryWorkspaceId) {
  return [task.taskId, primaryWorkspaceId, task.title, task.context, task.category, task.project, task.person,
    task.type, task.priority, task.status, task.dueAt, task.dueIsDateOnly ? 1 : 0, task.remindAt, task.followUpAt,
    task.estimatedDuration, task.recurrence, task.seriesId, task.recurrenceAnchorDay, task.dependency, task.createdAt, task.completedAt, task.source,
    task.sourceContext, task.lastNotifiedAt, task.updatedAt, task.captureFingerprint ?? null,
    task.estimatedDurationLabel ?? null];
}

export class D1TaskRepository implements HostedTaskRepository {
  constructor(private readonly database: D1Database) {}

  async list(context: RequestContext) {
    const workspaceKey = requireHostedContext(context);
    const instance = workspaceInstanceContext(context);
    if (instance.userId === null) {
      const rows = (await this.database.prepare(`SELECT ${selectedColumns} FROM tasks t JOIN task_visibility v ON v.task_id=t.task_id
        WHERE v.workspace_id=? AND (t.primary_workspace_id=? OR (t.primary_workspace_id='indelitech' AND ?='personal'))
        ORDER BY t.updated_at DESC, t.task_id`).bind(workspaceKey, workspaceKey, workspaceKey).all<TaskRow>()).results ?? [];
      return rows.map(fromRow).filter((task) => taskVisibleInWorkspace(task.primaryWorkspaceId, workspaceKey));
    }

    await resolveAuthorizedWorkspaceInstances(this.database, context, [workspaceKey]);
    const rows = (await this.database.prepare(`SELECT ${selectedColumns}, source_membership.workspace_key AS primary_workspace_key
      FROM tasks t
      JOIN task_visibility v ON v.task_id=t.task_id
      JOIN workspace_memberships source_membership
        ON source_membership.workspace_id=t.primary_workspace_id
       AND source_membership.user_id=?
       AND source_membership.role IN ('OWNER','MEMBER')
      JOIN users source_user ON source_user.user_id=source_membership.user_id AND source_user.status='ACTIVE'
      WHERE v.workspace_id=?
      ORDER BY t.updated_at DESC, t.task_id`).bind(instance.userId, instance.workspaceId).all<TaskRow>()).results ?? [];
    return rows.map(fromRow).filter((task) => taskVisibleInWorkspace(task.primaryWorkspaceId, workspaceKey));
  }

  async get(context: RequestContext, taskId: string) {
    const workspaceKey = requireHostedContext(context);
    const instance = workspaceInstanceContext(context);
    if (instance.userId === null) {
      const row = await this.database.prepare(`SELECT ${selectedColumns} FROM tasks t JOIN task_visibility v ON v.task_id=t.task_id
        WHERE t.task_id=? AND v.workspace_id=? AND (t.primary_workspace_id=? OR (t.primary_workspace_id='indelitech' AND ?='personal'))`)
        .bind(taskId, workspaceKey, workspaceKey, workspaceKey).first<TaskRow>();
      if (!row) return null;
      const task = fromRow(row);
      return taskVisibleInWorkspace(task.primaryWorkspaceId, workspaceKey) ? task : null;
    }

    await resolveAuthorizedWorkspaceInstances(this.database, context, [workspaceKey]);
    const row = await this.database.prepare(`SELECT ${selectedColumns}, source_membership.workspace_key AS primary_workspace_key
      FROM tasks t
      JOIN task_visibility v ON v.task_id=t.task_id
      JOIN workspace_memberships source_membership
        ON source_membership.workspace_id=t.primary_workspace_id
       AND source_membership.user_id=?
       AND source_membership.role IN ('OWNER','MEMBER')
      JOIN users source_user ON source_user.user_id=source_membership.user_id AND source_user.status='ACTIVE'
      WHERE t.task_id=? AND v.workspace_id=?`)
      .bind(instance.userId, taskId, instance.workspaceId).first<TaskRow>();
    if (!row) return null;
    const task = fromRow(row);
    return taskVisibleInWorkspace(task.primaryWorkspaceId, workspaceKey) ? task : null;
  }

  async create(context: RequestContext, task: HostedTask, visibleIn: readonly ProductWorkspaceId[]) {
    const workspaceKey = requireHostedContext(context);
    if (task.primaryWorkspaceId !== workspaceKey) throw new Error("A task must be created by its primary workspace.");
    const visibility = [...new Set(visibleIn)];
    if (!visibility.includes(workspaceKey) || visibility.some((target) => !taskVisibleInWorkspace(workspaceKey, target))) {
      throw new Error("Invalid task visibility.");
    }

    const instances = await resolveAuthorizedWorkspaceInstances(
      this.database,
      context,
      [...new Set([task.primaryWorkspaceId, ...visibility])],
    );
    const primaryWorkspaceId = instances.get(task.primaryWorkspaceId);
    if (!primaryWorkspaceId) throw new Error("Workspace access denied.");
    const physicalVisibility = visibility.map((target) => {
      const physical = instances.get(target);
      if (!physical) throw new Error("Workspace access denied.");
      return physical;
    });

    const placeholders = Array.from({ length: values(task, primaryWorkspaceId).length }, () => "?").join(",");
    const statements = [this.database.prepare(`INSERT INTO tasks (${columns}) VALUES (${placeholders})`).bind(...values(task, primaryWorkspaceId)),
      ...physicalVisibility.map((target) => this.database.prepare("INSERT INTO task_visibility (task_id, workspace_id) VALUES (?, ?)").bind(task.taskId, target))];
    const results = await this.database.batch(statements);
    if (results.some(({ success }) => !success)) throw new Error("D1 task creation failed.");
    return task;
  }

  async update(context: RequestContext, task: HostedTask) {
    const workspaceKey = requireHostedContext(context);
    const instance = workspaceInstanceContext(context);
    if (instance.userId !== null) await resolveAuthorizedWorkspaceInstances(this.database, context, [workspaceKey]);
    const existing = await this.get(context, task.taskId);
    if (!existing || existing.primaryWorkspaceId !== task.primaryWorkspaceId || task.createdAt !== existing.createdAt) throw new Error("Task access denied.");
    if (existing.captureFingerprint != null && task.captureFingerprint != null && task.captureFingerprint !== existing.captureFingerprint)
      throw new Error("Task capture fingerprint is immutable.");
    const saved = { ...task, captureFingerprint: existing.captureFingerprint ?? task.captureFingerprint ?? null };
    const mutable = values(saved).slice(2);
    const visibilityWorkspaceId = instance.userId === null ? workspaceKey : instance.workspaceId;
    const result = await this.database.prepare(`UPDATE tasks SET title=?, context=?, category=?, project=?, person=?, type=?, priority=?, status=?, due_at=?,
      due_is_date_only=?, remind_at=?, follow_up_at=?, estimated_duration=?, recurrence=?, series_id=?, recurrence_anchor_day=?, dependency=?, created_at=?, completed_at=?, source=?,
      source_context=?, last_notified_at=?, updated_at=?, capture_fingerprint=?, estimated_duration_label=? WHERE task_id=? AND EXISTS (SELECT 1 FROM task_visibility WHERE task_id=tasks.task_id AND workspace_id=?)`)
      .bind(...mutable, task.taskId, visibilityWorkspaceId).run();
    if (!result.success) throw new Error("D1 task update failed.");
    return saved;
  }
}

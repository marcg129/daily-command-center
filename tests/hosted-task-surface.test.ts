import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { hostedTaskToTaskItem, taskItemToHostedTask } from "@/lib/runtime/hosted-task-compat";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import { D1TaskMutationRepository } from "@/lib/server/d1-task-mutation-repository";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { readHostedWorkspace } from "@/lib/server/hosted-workspace-read-adapter";
import type { TaskItem } from "@/lib/types";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  private input() { return this.values as SQLInputValue[]; }
  async first<T>() { return (this.statement.get(...this.input()) as T | undefined) ?? null; }
  async all<T>() { return { success: true, results: this.statement.all(...this.input()) as T[] }; }
  async run<T>(): Promise<D1Result<T>> { this.statement.run(...this.input()); return { success: true }; }
}

class AtomicD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  failBatchAt: number | undefined;
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_workspaces.sql", "0002_tasks.sql", "0005_task_capture_metadata.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const [index, statement] of statements.entries()) {
        if (index === this.failBatchAt) throw new Error("forced batch failure");
        results.push(await statement.run<T>());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const now = "2026-09-11T12:00:00.000Z";
function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return { id: "task", primaryWorkspaceId: "personal", title: "Plan launch", description: "Context", due: "2026-09-12",
    recurrence: "One-time", priority: "HIGH", done: false, status: "OPEN", type: "DEADLINE", createdAt: now,
    updatedAt: now, source: "manual", ...overrides };
}
function hosted(overrides: Partial<HostedTask> = {}): HostedTask {
  return { ...taskItemToHostedTask(item({ primaryWorkspaceId: "indelitech" }), now), ...overrides };
}

test("hosted compatibility mapping preserves metadata, due semantics, recurrence, and every duration label", () => {
  const full = item({ id: "full", primaryWorkspaceId: "indelitech", description: "Details", category: "Ops", project: "Apollo",
    person: "Sam", type: "WAITING", status: "WAITING", priority: "LOW", remindAt: "2026-09-12T09:00:00Z",
    followUpAt: "2026-09-13T09:00:00Z", recurrence: "Monthly", seriesId: "series", recurrenceAnchorDay: 31,
    dependency: "Approval", completedAt: "2026-09-11T10:00:00Z", source: "capture", sourceContext: "thread/7",
    captureFingerprint: "fingerprint" });
  const mapped = taskItemToHostedTask(full, now);
  const roundTrip = hostedTaskToTaskItem(mapped);
  for (const field of ["id", "primaryWorkspaceId", "title", "description", "category", "project", "person", "type", "status",
    "priority", "remindAt", "followUpAt", "recurrence", "seriesId", "recurrenceAnchorDay", "dependency", "createdAt", "completedAt",
    "source", "sourceContext", "captureFingerprint"] as const) assert.equal(roundTrip[field], full[field]);
  assert.equal(mapped.dueIsDateOnly, true); assert.equal(roundTrip.due, "2026-09-12");
  assert.equal(hostedTaskToTaskItem({ ...mapped, dueAt: "2026-09-12T14:30:00-04:00", dueIsDateOnly: false }).due, "2026-09-12T14:30:00-04:00");
  assert.equal(taskItemToHostedTask(item({ due: "" }), now).dueAt, null);
  assert.equal(hostedTaskToTaskItem({ ...mapped, dueAt: null, dueIsDateOnly: false }).due, "");
  for (const label of ["5m", "15m", "30m", "1h", "2h+", "Project"] as const)
    assert.equal(hostedTaskToTaskItem(taskItemToHostedTask(item({ estimatedDuration: label }), now)).estimatedDuration, label);
});

test("UI-style updates preserve hosted-only and immutable metadata and reject numeric IDs", () => {
  const existing = hosted({ taskId: "stable", captureFingerprint: "original", lastNotifiedAt: "2026-09-11T11:00:00Z", createdAt: "2026-08-01T00:00:00Z" });
  const update = taskItemToHostedTask(item({ id: "stable", primaryWorkspaceId: "indelitech", title: "Edited",
    captureFingerprint: undefined, createdAt: now }), now, existing);
  assert.equal(update.lastNotifiedAt, existing.lastNotifiedAt);
  assert.equal(update.captureFingerprint, "original");
  assert.equal(update.createdAt, existing.createdAt);
  assert.throws(() => taskItemToHostedTask(item({ id: 7 }), now), /must be a non-empty string/);
  assert.throws(() => taskItemToHostedTask(item({ seriesId: 7 }), now), /series ID must be a non-empty string/);
  assert.throws(() => taskItemToHostedTask(item({ id: "stable", primaryWorkspaceId: "personal" }), now, existing), /ownership is immutable/);
});

test("D1 task surface reads canonical roll-up and creates only canonical visibility", async () => {
  const d1 = new AtomicD1(); const raw = new D1TaskRepository(d1);
  await raw.create({ workspaceId: "personal" }, hosted({ taskId: "personal", primaryWorkspaceId: "personal" }), ["personal"]);
  await raw.create({ workspaceId: "indelitech" }, hosted({ taskId: "team" }), ["indelitech", "personal"]);
  const personal = new D1TaskMutationRepository(d1, { workspaceId: "personal" });
  const team = new D1TaskMutationRepository(d1, { workspaceId: "indelitech" });
  assert.deepEqual((await personal.read()).map(({ id }) => id).sort(), ["personal", "team"]);
  assert.deepEqual((await team.read()).map(({ id }) => id), ["team"]);
  await personal.apply([{ kind: "CREATE", task: item({ id: "new-personal" }) }], now);
  assert.deepEqual(d1.sqlite.prepare("SELECT workspace_id FROM task_visibility WHERE task_id='new-personal'").all().map((row) => ({ ...row })), [{ workspace_id: "personal" }]);
  await team.apply([{ kind: "CREATE", task: item({ id: "new-team", primaryWorkspaceId: "indelitech" }) }], now);
  assert.equal(d1.sqlite.prepare("SELECT count(*) count FROM task_visibility WHERE task_id='new-team'").get()!.count, 2);
  await assert.rejects(personal.apply([{ kind: "CREATE", task: item({ id: "forbidden", primaryWorkspaceId: "indelitech" }) }], now), /authorized primary workspace/);
  await assert.rejects(personal.apply([{ kind: "DELETE", taskId: 7 }], now), /IDs must be non-empty strings/);
  d1.sqlite.close();
});

test("Personal update and permanent delete target the one rolled-up Indelitech row", async () => {
  const d1 = new AtomicD1(); const raw = new D1TaskRepository(d1);
  await raw.create({ workspaceId: "indelitech" }, hosted({ taskId: "team", captureFingerprint: "fixed", lastNotifiedAt: now }), ["indelitech", "personal"]);
  const personal = new D1TaskMutationRepository(d1, { workspaceId: "personal" });
  const current = (await personal.read())[0];
  await personal.apply([{ kind: "UPDATE", taskId: "team", task: { ...current, title: "Edited", captureFingerprint: "attempted", createdAt: "changed" } }], now);
  const row = await raw.get({ workspaceId: "indelitech" }, "team");
  assert.equal(row?.title, "Edited"); assert.equal(row?.captureFingerprint, "fixed"); assert.equal(row?.createdAt, now); assert.equal(row?.lastNotifiedAt, now);
  assert.equal(d1.sqlite.prepare("SELECT count(*) count FROM tasks WHERE task_id='team'").get()!.count, 1);
  await personal.apply([{ kind: "DELETE", taskId: "team" }], now);
  assert.equal(d1.sqlite.prepare("SELECT count(*) count FROM tasks WHERE task_id='team'").get()!.count, 0);
  assert.equal(d1.sqlite.prepare("SELECT count(*) count FROM task_visibility WHERE task_id='team'").get()!.count, 0);
  d1.sqlite.close();
});

test("Personal recurring roll-up completion is narrow and atomic, including forced rollback", async () => {
  const d1 = new AtomicD1(); const raw = new D1TaskRepository(d1);
  const parent = hosted({ taskId: "series", recurrence: "Weekly", type: "RECURRING", dueAt: "2026-09-12" });
  await raw.create({ workspaceId: "indelitech" }, parent, ["indelitech", "personal"]);
  const personal = new D1TaskMutationRepository(d1, { workspaceId: "personal" });
  const parentItem = (await personal.read())[0];
  const occurrence = { ...parentItem, id: "occurrence", done: true, status: "DONE" as const, seriesId: "series", completedAt: now };
  const advanced = { ...parentItem, due: "2026-09-19", updatedAt: now };
  await personal.apply([{ kind: "CREATE", task: occurrence }, { kind: "UPDATE", taskId: "series", task: advanced }], now);
  assert.equal((await raw.get({ workspaceId: "indelitech" }, "occurrence"))?.status, "DONE");
  assert.equal((await raw.get({ workspaceId: "indelitech" }, "series"))?.dueAt, "2026-09-19");

  const secondOccurrence = { ...occurrence, id: "occurrence-2", due: "2026-09-19" };
  const secondAdvance = { ...advanced, due: "2026-09-26" };
  d1.failBatchAt = 2;
  await assert.rejects(personal.apply([{ kind: "CREATE", task: secondOccurrence }, { kind: "UPDATE", taskId: "series", task: secondAdvance }], now), /forced batch failure/);
  assert.equal(await raw.get({ workspaceId: "indelitech" }, "occurrence-2"), null);
  assert.equal((await raw.get({ workspaceId: "indelitech" }, "series"))?.dueAt, "2026-09-19");
  d1.failBatchAt = undefined;
  await assert.rejects(personal.apply([{ kind: "CREATE", task: { ...secondOccurrence, id: "unpaired" } }], now), /authorized primary workspace/);
  d1.sqlite.close();
});

test("hosted workspace read response is initialized with deliberately empty reminders", async () => {
  const response = await readHostedWorkspace({ read: async () => [item()], apply: async () => [] });
  assert.equal(response.initialized, true); assert.equal(response.legacyBrowserImportAllowed, false);
  assert.deepEqual(response.reminders, []); assert.equal(response.tasks.length, 1);
});

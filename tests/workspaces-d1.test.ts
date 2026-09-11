import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { INDELITECH_WORKSPACE_ID, isWorkspaceId, LEGACY_WORKSPACE_ID, PERSONAL_WORKSPACE_ID } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { effectivePriorityRank, isTaskOverdue, taskHorizonGroup, type HostedTask } from "@/lib/runtime/hosted-tasks";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { transformLegacyWorkspace } from "@/lib/runtime/legacy-import";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { D1CollectorSnapshotRepository } from "@/lib/server/d1-collector-snapshot-repository";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  private input() { return this.values as SQLInputValue[]; }
  async first<T>() { return (this.statement.get(...this.input()) as T | undefined) ?? null; }
  async all<T>() { return { success: true, results: this.statement.all(...this.input()) as T[] }; }
  async run<T>(): Promise<D1Result<T>> { this.statement.run(...this.input()); return { success: true }; }
}
class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_workspaces.sql", "0002_tasks.sql", "0003_collector_snapshots.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

function task(overrides: Partial<HostedTask> = {}): HostedTask {
  return { taskId: "task-1", primaryWorkspaceId: INDELITECH_WORKSPACE_ID, title: "Ship proposal", context: null,
    category: null, project: null, person: null, type: "DEADLINE", priority: "LOW", status: "OPEN",
    dueAt: "2026-09-10", dueIsDateOnly: true, remindAt: null, followUpAt: null, estimatedDuration: null,
    recurrence: null, dependency: null, createdAt: "2026-09-01T00:00:00.000Z", completedAt: null,
    source: "manual", sourceContext: null, lastNotifiedAt: null, updatedAt: "2026-09-01T00:00:00.000Z", ...overrides };
}

test("workspace identities are stable and validation rejects arbitrary values", () => {
  assert.deepEqual([PERSONAL_WORKSPACE_ID, INDELITECH_WORKSPACE_ID, LEGACY_WORKSPACE_ID], ["personal", "indelitech", "legacy-local"]);
  assert.equal(isWorkspaceId("personal"), true); assert.equal(isWorkspaceId("renamed-by-user"), false);
});

test("D1 tasks share Indelitech to Personal without duplication and update one record", async () => {
  const d1 = new TestD1(); const repository = new D1TaskRepository(d1);
  const original = task();
  await repository.create({ workspaceId: "indelitech" }, original, [INDELITECH_WORKSPACE_ID, PERSONAL_WORKSPACE_ID]);
  assert.equal((await repository.list({ workspaceId: "personal" }))[0].taskId, original.taskId);
  assert.equal((await repository.list({ workspaceId: "indelitech" }))[0].taskId, original.taskId);
  await repository.update({ workspaceId: "personal" }, { ...original, status: "DONE", completedAt: "2026-09-11T10:00:00Z", updatedAt: "2026-09-11T10:00:00Z" });
  assert.equal((await repository.get({ workspaceId: "indelitech" }, original.taskId))?.status, "DONE");
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM tasks").get() as { count: number }).count, 1);
  d1.sqlite.close();
});

test("D1 task visibility is fail-closed in both repository and schema", async () => {
  const d1 = new TestD1(); const repository = new D1TaskRepository(d1);
  const personal = task({ taskId: "personal-task", primaryWorkspaceId: PERSONAL_WORKSPACE_ID });
  await repository.create({ workspaceId: "personal" }, personal, [PERSONAL_WORKSPACE_ID]);
  assert.deepEqual(await repository.list({ workspaceId: "indelitech" }), []);
  await assert.rejects(repository.create({ workspaceId: "personal" }, task({ taskId: "bad", primaryWorkspaceId: PERSONAL_WORKSPACE_ID }), [PERSONAL_WORKSPACE_ID, INDELITECH_WORKSPACE_ID]), /Invalid task visibility/);
  assert.throws(() => d1.sqlite.prepare("INSERT INTO task_visibility VALUES (?, ?)").run("personal-task", "indelitech"), /invalid task visibility/);
  await assert.rejects(repository.list({ workspaceId: "legacy-local" }), /hosted product workspace/);
  await assert.rejects(repository.list(undefined as never), /valid workspace context/);
  d1.sqlite.close();
});

test("effective priority and local date-only horizon semantics preserve stored priority", () => {
  const now = new Date("2026-09-11T04:30:00Z"); // Sep 10 in America/Los_Angeles
  const dateOnly = task({ dueAt: "2026-09-10", priority: "LOW" });
  assert.equal(isTaskOverdue(dateOnly, now, "America/Los_Angeles"), false);
  assert.equal(taskHorizonGroup(dateOnly, now, "America/Los_Angeles"), "TODAY");
  assert.equal(isTaskOverdue(dateOnly, new Date("2026-09-11T08:00:00Z"), "America/Los_Angeles"), true);
  assert.equal(effectivePriorityRank(dateOnly, new Date("2026-09-11T08:00:00Z"), "America/Los_Angeles"), 4);
  assert.equal(dateOnly.priority, "LOW");
  const groups = [1, 8, 15, 31, 46].map((days) => taskHorizonGroup(task({ dueAt: `2026-${days <= 19 ? "09" : "10"}-${String(days <= 19 ? 10 + days : days - 19).padStart(2, "0")}` }), new Date("2026-09-10T12:00:00Z"), "UTC"));
  assert.deepEqual(groups, ["NEXT_7_DAYS", "DAYS_8_14", "DAYS_15_30", "DAYS_31_45", "LATER_OR_UNSCHEDULED"]);
});

test("collector D1 snapshots are isolated by workspace and reject missing context", async () => {
  const d1 = new TestD1(); const repository = new D1CollectorSnapshotRepository(d1);
  await repository.write({ workspaceId: "personal" }, "industry", "same", { owner: "personal" }, "2026-09-11T00:00:00Z");
  await repository.write({ workspaceId: "indelitech" }, "industry", "same", { owner: "indelitech" }, "2026-09-11T00:00:00Z");
  assert.deepEqual((await repository.read<{ owner: string }>({ workspaceId: "personal" }, "industry"))?.payload, { owner: "personal" });
  assert.deepEqual((await repository.read<{ owner: string }>({ workspaceId: "indelitech" }, "industry"))?.payload, { owner: "indelitech" });
  await repository.write({ workspaceId: "personal" }, "mentions", "archive", { items: [{ id: "story" }], archivedItems: [] }, "2026-09-11T00:00:00Z");
  assert.equal(await repository.updateArchive({ workspaceId: "personal" }, "mentions", "story", true, "2026-09-11T01:00:00Z"), true);
  const archived = await repository.read<{ items: unknown[]; archivedItems: unknown[] }>({ workspaceId: "personal" }, "mentions");
  assert.equal(archived?.payload.items.length, 0); assert.equal(archived?.payload.archivedItems.length, 1);
  await assert.rejects(repository.read(null as never, "industry"), /valid workspace context/);
  d1.sqlite.close();
});

test("fake resolver authenticates grants rather than trusting requested workspace", async () => {
  const resolver = new FakeWorkspaceResolver(new Map([["personal-owner", new Set([PERSONAL_WORKSPACE_ID])], ["both", new Set([PERSONAL_WORKSPACE_ID, INDELITECH_WORKSPACE_ID])]]));
  await assert.rejects(resolver.resolve(null, "personal"), /Authentication/);
  await assert.rejects(resolver.resolve({ principalId: "unknown" }, "personal"), /denied/);
  await assert.rejects(resolver.resolve({ principalId: "personal-owner" }, "indelitech"), /denied/);
  assert.notDeepEqual(await resolver.resolve({ principalId: "both" }, "personal"), await resolver.resolve({ principalId: "both" }, "indelitech"));
});

test("legacy import requires policy, preserves recurrence history, date-only values and deterministic IDs", () => {
  const state = { reminders: [], tasks: [
    { id: "series", title: "Review", description: "", due: "2026-09-12", recurrence: "Weekly", priority: "Normal", done: false },
    { id: "unsafe id/occurrence", seriesId: "series", title: "Review", description: "", due: "2026-09-05", recurrence: "Weekly", priority: "Normal", done: true, completedAt: "2026-09-05T12:00:00Z" },
  ] };
  const first = transformLegacyWorkspace(state, "personal", "2026-09-11T00:00:00Z");
  const second = transformLegacyWorkspace(state, "personal", "2026-09-11T00:00:00Z");
  assert.equal(first.tasks[0].primaryWorkspaceId, PERSONAL_WORKSPACE_ID);
  assert.equal(first.tasks[0].dueIsDateOnly, true); assert.equal(first.tasks[1].status, "DONE");
  assert.equal(first.tasks[1].dependency, "series"); assert.deepEqual(first.idMap, second.idMap);
  assert.equal(transformLegacyWorkspace(state, "review", "2026-09-11T00:00:00Z").review.length, 2);
});

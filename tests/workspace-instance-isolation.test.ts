import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { principalId } from "@/lib/runtime/session";
import { D1TaskMutationRepository } from "@/lib/server/d1-task-mutation-repository";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";
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

class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0001_workspaces.sql",
      "0002_tasks.sql",
      "0005_task_capture_metadata.sql",
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const now = "2026-09-13T20:00:00.000Z";

function createUser(database: TestD1, name: string, physicalPersonalId: string) {
  const principal = principalId(`cf-user:${name}`);
  const userId = `user:${name}`;
  if (physicalPersonalId !== "personal") {
    database.sqlite.prepare(`INSERT INTO workspaces
      (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
      VALUES (?, 'Personal', 'PERSONAL', 'personal-tech-blue', ?, ?)`)
      .run(physicalPersonalId, now, now);
  }
  database.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
    .run(userId, now, now);
  database.sqlite.prepare("INSERT INTO user_principals (principal_id, user_id, provider, created_at) VALUES (?, ?, 'TEST', ?)")
    .run(principal, userId, now);
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, ?, 'personal', 'OWNER', ?, ?)`)
    .run(userId, physicalPersonalId, now, now);
  return { principal, userId, physicalPersonalId };
}

function item(id: string, title: string): TaskItem {
  return {
    id,
    primaryWorkspaceId: "personal",
    title,
    description: `${title} context`,
    due: "",
    recurrence: "One-time",
    priority: "MEDIUM",
    done: false,
    status: "OPEN",
    type: "ONE_TIME",
    createdAt: now,
    updatedAt: now,
    source: "manual",
  };
}

test("different users resolve the same logical Personal slot to different physical D1 boundaries", async () => {
  const database = new TestD1();
  const marc = createUser(database, "marc", "personal");
  const christa = createUser(database, "christa", "personal:christa");
  const resolver = new D1WorkspaceResolver(database);

  const marcContext = await resolver.resolve({ principalId: marc.principal }, "personal");
  const christaContext = await resolver.resolve({ principalId: christa.principal }, "personal");
  assert.deepEqual(marcContext, {
    userId: marc.userId,
    workspaceId: "personal",
    workspaceKey: "personal",
  });
  assert.deepEqual(christaContext, {
    userId: christa.userId,
    workspaceId: "personal:christa",
    workspaceKey: "personal",
  });

  await assert.rejects(
    resolver.resolve({ principalId: christa.principal }, "personal:christa"),
    /Unknown workspace/,
  );
  database.sqlite.close();
});

test("separate Personal instances isolate task reads and mutations while keeping the public task model logical", async () => {
  const database = new TestD1();
  const marc = createUser(database, "marc", "personal");
  const christa = createUser(database, "christa", "personal:christa");
  const resolver = new D1WorkspaceResolver(database);
  const marcContext = await resolver.resolve({ principalId: marc.principal }, "personal");
  const christaContext = await resolver.resolve({ principalId: christa.principal }, "personal");
  const marcTasks = new D1TaskMutationRepository(database, marcContext);
  const christaTasks = new D1TaskMutationRepository(database, christaContext);

  await marcTasks.apply([{ kind: "CREATE", task: item("marc-private", "Marc private") }], now);
  await christaTasks.apply([{ kind: "CREATE", task: item("christa-private", "Christa private") }], now);

  assert.deepEqual((await marcTasks.read()).map(({ id, primaryWorkspaceId }) => ({ id, primaryWorkspaceId })), [
    { id: "marc-private", primaryWorkspaceId: "personal" },
  ]);
  assert.deepEqual((await christaTasks.read()).map(({ id, primaryWorkspaceId }) => ({ id, primaryWorkspaceId })), [
    { id: "christa-private", primaryWorkspaceId: "personal" },
  ]);

  assert.deepEqual(
    database.sqlite.prepare("SELECT task_id, primary_workspace_id FROM tasks ORDER BY task_id").all().map((row) => ({ ...row })),
    [
      { task_id: "christa-private", primary_workspace_id: "personal:christa" },
      { task_id: "marc-private", primary_workspace_id: "personal" },
    ],
  );
  assert.deepEqual(
    database.sqlite.prepare("SELECT task_id, workspace_id FROM task_visibility ORDER BY task_id").all().map((row) => ({ ...row })),
    [
      { task_id: "christa-private", workspace_id: "personal:christa" },
      { task_id: "marc-private", workspace_id: "personal" },
    ],
  );

  await assert.rejects(
    christaTasks.apply([{ kind: "DELETE", taskId: "marc-private" }], now),
    /Visible task marc-private does not exist/,
  );
  assert.equal(database.sqlite.prepare("SELECT count(*) count FROM tasks WHERE task_id='marc-private'").get()!.count, 1);
  database.sqlite.close();
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import { createChatTaskCaptureService } from "@/lib/runtime/chat-task-capture";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { principalId, type PrincipalId } from "@/lib/runtime/session";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";

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

const now = new Date("2026-09-13T22:50:00.000Z");

function addPersonalUser(
  database: TestD1,
  name: string,
  physicalPersonalId: string,
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const principal = principalId(`cf-user:${name}`);
  const userId = `user:${name}`;
  if (physicalPersonalId !== "personal") {
    database.sqlite.prepare(`INSERT INTO workspaces
      (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
      VALUES (?, 'Personal', 'PERSONAL', 'personal-tech-blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .run(physicalPersonalId);
  }
  database.sqlite.prepare(
    "INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
  ).run(userId, status);
  database.sqlite.prepare(
    "INSERT INTO user_principals (principal_id, user_id, provider, created_at) VALUES (?, ?, 'TEST', CURRENT_TIMESTAMP)",
  ).run(principal, userId);
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, ?, 'personal', 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(userId, physicalPersonalId);
  return { principal, userId, physicalPersonalId };
}

function grantIndelitech(database: TestD1, userId: string) {
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, 'indelitech', 'indelitech', 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(userId);
}

function service(database: TestD1, principal: PrincipalId) {
  return createChatTaskCaptureService(
    { principalId: principal },
    new D1WorkspaceResolver(database),
    new D1TaskRepository(database),
    { now: () => now },
  );
}

function directCapture(requestId: string, workspaceId: unknown, title: string) {
  return {
    requestId,
    confirmedByUser: true,
    workspaceId,
    title,
    sourceContext: "Explicit SEND TO TASKS request",
  };
}

test("direct conversational capture keeps separate users in separate physical Personal workspaces", async () => {
  const database = new TestD1();
  const marc = addPersonalUser(database, "marc", "personal");
  const christa = addPersonalUser(database, "christa", "personal:christa");
  grantIndelitech(database, marc.userId);

  await service(database, marc.principal).create(
    directCapture("chat:marc-private", "personal", "Marc private task"),
  );
  await service(database, christa.principal).create(
    directCapture("chat:christa-private", "personal", "Christa private task"),
  );

  assert.deepEqual(
    database.sqlite.prepare(
      "SELECT task_id, primary_workspace_id FROM tasks ORDER BY task_id",
    ).all().map((row) => ({ ...row })),
    [
      { task_id: "capture:chat:christa-private", primary_workspace_id: "personal:christa" },
      { task_id: "capture:chat:marc-private", primary_workspace_id: "personal" },
    ],
  );

  const resolver = new D1WorkspaceResolver(database);
  const repository = new D1TaskRepository(database);
  const marcContext = await resolver.resolve({ principalId: marc.principal }, "personal");
  const christaContext = await resolver.resolve({ principalId: christa.principal }, "personal");
  assert.deepEqual((await repository.list(marcContext)).map(({ taskId }) => taskId), [
    "capture:chat:marc-private",
  ]);
  assert.deepEqual((await repository.list(christaContext)).map(({ taskId }) => taskId), [
    "capture:chat:christa-private",
  ]);
  database.sqlite.close();
});

test("conversational capture rejects unauthorized logical workspaces and forged physical workspace IDs", async () => {
  const database = new TestD1();
  const marc = addPersonalUser(database, "marc", "personal");
  const christa = addPersonalUser(database, "christa", "personal:christa");
  grantIndelitech(database, marc.userId);
  const christaTasks = service(database, christa.principal);

  await assert.rejects(
    christaTasks.create(directCapture("chat:cross-workspace", "indelitech", "Unauthorized business task")),
    /Workspace access denied/,
  );
  await assert.rejects(
    christaTasks.create(directCapture("chat:physical-id", "personal:christa", "Forged physical selector")),
    /workspaceId must be personal or indelitech/,
  );

  assert.equal(
    database.sqlite.prepare("SELECT count(*) AS count FROM tasks").get()!.count,
    0,
  );
  database.sqlite.close();
});

test("disabled and unmapped principals fail closed before conversational persistence", async () => {
  const database = new TestD1();
  const disabled = addPersonalUser(database, "disabled", "personal", "DISABLED");

  await assert.rejects(
    service(database, disabled.principal).create(
      directCapture("chat:disabled", "personal", "Should not save"),
    ),
    /Workspace access denied/,
  );
  await assert.rejects(
    service(database, principalId("cf-user:missing")).create(
      directCapture("chat:missing", "personal", "Should not save either"),
    ),
    /Workspace access denied/,
  );
  assert.equal(
    database.sqlite.prepare("SELECT count(*) AS count FROM tasks").get()!.count,
    0,
  );
  database.sqlite.close();
});

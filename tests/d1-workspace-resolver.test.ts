import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { createAuthorizedHostedTaskCaptureService } from "@/lib/runtime/authorized-hosted-task-capture";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
} from "@/lib/runtime/session";
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
    for (const name of ["0001_workspaces.sql", "0006_principal_workspace_grants.sql", "0007_user_workspace_ownership.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

function grant(database: TestD1, principal: string, workspaceId: ProductWorkspaceId) {
  const userId = `user:${principal}`;
  database.sqlite.prepare(
    "INSERT OR IGNORE INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
  ).run(userId);
  database.sqlite.prepare(
    "INSERT OR IGNORE INTO user_principals (principal_id, user_id, provider, created_at) VALUES (?, ?, 'TEST', CURRENT_TIMESTAMP)",
  ).run(principal, userId);
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES (?, ?, 'OWNER')",
  ).run(userId, workspaceId);
}

function memoryTaskRepository() {
  const tasks = new Map<string, HostedTask>();
  const visibility = new Map<string, readonly ProductWorkspaceId[]>();
  let creates = 0;
  const repository: HostedTaskRepository = {
    async list(context) {
      return [...tasks.values()].filter((task) =>
        visibility.get(task.taskId)?.includes(context.workspaceId as ProductWorkspaceId));
    },
    async get(context, taskId) {
      const task = tasks.get(taskId);
      return task && visibility.get(taskId)?.includes(context.workspaceId as ProductWorkspaceId)
        ? structuredClone(task)
        : null;
    },
    async create(_context, task, visibleIn) {
      if (tasks.has(task.taskId)) throw new Error("duplicate");
      creates++;
      tasks.set(task.taskId, structuredClone(task));
      visibility.set(task.taskId, [...visibleIn]);
      return structuredClone(task);
    },
    async update(_context, task) {
      tasks.set(task.taskId, structuredClone(task));
      return structuredClone(task);
    },
  };
  return { repository, tasks, get creates() { return creates; } };
}

const alice = principalId("cf-user:alice-123");
const bob = principalId("cf-user:bob-456");
const now = new Date("2026-09-11T18:00:00.000Z");

test("D1WorkspaceResolver fails closed without authentication, valid workspace, and exact grant", async () => {
  const d1 = new TestD1();
  const resolver = new D1WorkspaceResolver(d1);
  grant(d1, alice, "personal");

  await assert.rejects(resolver.resolve(null, "personal"), /Authentication required/);
  await assert.rejects(resolver.resolve({ principalId: alice }, "legacy-local"), /Unknown workspace/);
  await assert.rejects(resolver.resolve({ principalId: alice }, "invented"), /Unknown workspace/);
  await assert.rejects(resolver.resolve({ principalId: alice }, "indelitech"), /Workspace access denied/);
  await assert.rejects(resolver.resolve({ principalId: bob }, "personal"), /Workspace access denied/);
  assert.deepEqual(await resolver.resolve({ principalId: alice }, "personal"), { workspaceId: "personal" });

  d1.sqlite.close();
});

test("D1WorkspaceResolver supports independent grants for both product workspaces", async () => {
  const d1 = new TestD1();
  const resolver = new D1WorkspaceResolver(d1);
  grant(d1, alice, "personal");
  grant(d1, alice, "indelitech");

  assert.deepEqual(await resolver.resolve({ principalId: alice }, "personal"), { workspaceId: "personal" });
  assert.deepEqual(await resolver.resolve({ principalId: alice }, "indelitech"), { workspaceId: "indelitech" });

  d1.sqlite.close();
});

test("workspace membership schema rejects unknown workspaces and duplicate memberships", () => {
  const d1 = new TestD1();
  grant(d1, alice, "personal");
  assert.throws(
    () => d1.sqlite.prepare(
      "INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES (?, ?, 'MEMBER')",
    ).run(`user:${alice}`, "missing-workspace"),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () => grant(d1, alice, "personal"),
    /UNIQUE constraint failed/,
  );
  d1.sqlite.close();
});

test("migration 0007 preserves grants as durable users, principals, and owner memberships", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0001_workspaces.sql", "0002_tasks.sql", "0006_principal_workspace_grants.sql"])
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO tasks (task_id, primary_workspace_id, title, type, priority, status,
    due_is_date_only, created_at, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "existing-private-task", "personal", "Keep me", "ONE_TIME", "MEDIUM", "OPEN", 0,
    "2026-09-01T00:00:00.000Z", "manual", "2026-09-01T00:00:00.000Z",
  );
  sqlite.prepare("INSERT INTO task_visibility (task_id, workspace_id) VALUES (?, ?)")
    .run("existing-private-task", "personal");
  sqlite.prepare("INSERT INTO principal_workspace_grants (principal_id, workspace_id, created_at) VALUES (?, ?, ?)")
    .run(alice, "personal", "2026-09-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO principal_workspace_grants (principal_id, workspace_id, created_at) VALUES (?, ?, ?)")
    .run(alice, "indelitech", "2026-09-02T00:00:00.000Z");

  sqlite.exec(readFileSync(new URL("../migrations/0007_user_workspace_ownership.sql", import.meta.url), "utf8"));

  assert.deepEqual(
    sqlite.prepare("SELECT principal_id, user_id, provider FROM user_principals").all().map((row) => ({ ...row })),
    [{ principal_id: alice, user_id: `legacy:${alice}`, provider: "CLOUDFLARE_ACCESS" }],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT workspace_id, role FROM workspace_memberships ORDER BY workspace_id").all().map((row) => ({ ...row })),
    [{ workspace_id: "indelitech", role: "OWNER" }, { workspace_id: "personal", role: "OWNER" }],
  );
  assert.equal(
    sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='principal_workspace_grants'").get()!.count,
    0,
  );
  assert.deepEqual(
    { ...sqlite.prepare(`SELECT t.title, t.primary_workspace_id, v.workspace_id FROM tasks t
      JOIN task_visibility v ON v.task_id=t.task_id WHERE t.task_id='existing-private-task'`).get()! },
    { title: "Keep me", primary_workspace_id: "personal", workspace_id: "personal" },
  );
  sqlite.prepare(`INSERT INTO workspaces (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES ('household', 'Household', 'SHARED', 'household', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  sqlite.prepare("INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES (?, 'household', 'MEMBER')")
    .run(`legacy:${alice}`);
  assert.throws(
    () => sqlite.prepare("INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES (?, 'missing', 'MEMBER')")
      .run(`legacy:${alice}`),
    /FOREIGN KEY constraint failed/,
  );
  sqlite.close();
});

test("disabled users and missing principal mappings fail closed", async () => {
  const d1 = new TestD1();
  const resolver = new D1WorkspaceResolver(d1);
  grant(d1, alice, "personal");
  d1.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE user_id=?").run(`user:${alice}`);

  await assert.rejects(resolver.resolve({ principalId: alice }, "personal"), /Workspace access denied/);
  await assert.rejects(resolver.resolve({ principalId: bob }, "personal"), /Workspace access denied/);
  d1.sqlite.close();
});

test("real D1 workspace grants gate authorized hosted capture before persistence", async () => {
  const d1 = new TestD1();
  grant(d1, alice, "personal");
  const resolver = new D1WorkspaceResolver(d1);
  const state = memoryTaskRepository();
  const session: AuthenticatedSession = {
    sessionId: "verified-access",
    principal: { principalId: alice },
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const capture = createAuthorizedHostedTaskCaptureService(
    new InMemorySessionProvider(new Map([["assertion", session]])),
    resolver,
    state.repository,
    { now: () => now },
  );

  const personal = await capture({
    sessionIdentity: "assertion",
    requestedWorkspaceId: "personal",
    capture: {
      requestId: "grant-personal",
      workspaceId: "personal",
      title: "Allowed task",
    },
  });
  assert.equal(personal.created, true);
  assert.equal(state.creates, 1);

  await assert.rejects(
    capture({
      sessionIdentity: "assertion",
      requestedWorkspaceId: "indelitech",
      capture: {
        requestId: "grant-indelitech",
        workspaceId: "indelitech",
        title: "Denied task",
      },
    }),
    /Workspace access denied/,
  );
  assert.equal(state.creates, 1);
  assert.equal(state.tasks.has("capture:grant-indelitech"), false);

  d1.sqlite.close();
});

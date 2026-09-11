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
    for (const name of ["0001_workspaces.sql", "0006_principal_workspace_grants.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

function grant(database: TestD1, principal: string, workspaceId: ProductWorkspaceId) {
  database.sqlite.prepare(
    "INSERT INTO principal_workspace_grants (principal_id, workspace_id) VALUES (?, ?)",
  ).run(principal, workspaceId);
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

test("principal workspace grant schema rejects unknown workspaces and duplicate grants", () => {
  const d1 = new TestD1();
  grant(d1, alice, "personal");
  assert.throws(
    () => d1.sqlite.prepare(
      "INSERT INTO principal_workspace_grants (principal_id, workspace_id) VALUES (?, ?)",
    ).run(alice, "missing-workspace"),
    /FOREIGN KEY constraint failed|CHECK constraint failed/,
  );
  assert.throws(
    () => grant(d1, alice, "personal"),
    /UNIQUE constraint failed/,
  );
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

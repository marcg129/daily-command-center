import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { D1UserWorkspaceResolver } from "@/lib/server/d1-user-workspace-resolver";

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
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

function addWorkspace(database: TestD1, workspaceId: string) {
  database.sqlite.prepare(`INSERT INTO workspaces
    (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES (?, 'Personal', 'PERSONAL', 'personal-tech-blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(workspaceId);
}

function addUser(database: TestD1, userId: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  database.sqlite.prepare(
    "INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
  ).run(userId, status);
}

function addMembership(database: TestD1, userId: string, workspaceId: string, workspaceKey: "personal" | "indelitech") {
  database.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id, workspace_id, workspace_key, role) VALUES (?, ?, ?, 'OWNER')",
  ).run(userId, workspaceId, workspaceKey);
}

test("configured active DCC user resolves the exact physical workspace", async () => {
  const d1 = new TestD1();
  addWorkspace(d1, "personal:relay-user");
  addUser(d1, "user:relay");
  addMembership(d1, "user:relay", "personal:relay-user", "personal");

  const resolver = new D1UserWorkspaceResolver(d1, "user:relay");
  assert.deepEqual(await resolver.resolve("personal"), {
    userId: "user:relay",
    workspaceId: "personal:relay-user",
    workspaceKey: "personal",
  });
  d1.sqlite.close();
});

test("configured user resolver fails closed for missing, disabled, or ungranted users", async () => {
  const d1 = new TestD1();
  addUser(d1, "user:disabled", "DISABLED");
  addUser(d1, "user:no-membership");

  await assert.rejects(new D1UserWorkspaceResolver(d1, "user:missing").resolve("personal"), /Workspace access denied/);
  await assert.rejects(new D1UserWorkspaceResolver(d1, "user:disabled").resolve("personal"), /Workspace access denied/);
  await assert.rejects(new D1UserWorkspaceResolver(d1, "user:no-membership").resolve("personal"), /Workspace access denied/);
  d1.sqlite.close();
});

test("configured user resolver rejects unsupported logical workspace IDs", async () => {
  const d1 = new TestD1();
  addUser(d1, "user:relay");
  const resolver = new D1UserWorkspaceResolver(d1, "user:relay");
  await assert.rejects(resolver.resolve("personal:relay-user"), /Unknown workspace/);
  await assert.rejects(resolver.resolve("legacy-local"), /Unknown workspace/);
  d1.sqlite.close();
});

test("configured user resolver rejects ambiguous or corrupt membership results", async () => {
  const duplicate = {
    prepare() {
      return {
        bind() { return this; },
        async all() {
          return {
            success: true,
            results: [
              { user_id: "user:relay", workspace_id: "personal:a", workspace_key: "personal" },
              { user_id: "user:relay", workspace_id: "personal:b", workspace_key: "personal" },
            ],
          };
        },
      };
    },
  } as unknown as D1Database;
  await assert.rejects(new D1UserWorkspaceResolver(duplicate, "user:relay").resolve("personal"), /Workspace access denied/);

  const mismatched = {
    prepare() {
      return {
        bind() { return this; },
        async all() {
          return {
            success: true,
            results: [{ user_id: "user:relay", workspace_id: "personal:a", workspace_key: "indelitech" }],
          };
        },
      };
    },
  } as unknown as D1Database;
  await assert.rejects(new D1UserWorkspaceResolver(mismatched, "user:relay").resolve("personal"), /Workspace access denied/);
});

test("configured DCC user ID must be explicit and nonblank", () => {
  const d1 = new TestD1();
  assert.throws(() => new D1UserWorkspaceResolver(d1, ""), /DCC user ID is required/);
  assert.throws(() => new D1UserWorkspaceResolver(d1, "   "), /DCC user ID is required/);
  d1.sqlite.close();
});

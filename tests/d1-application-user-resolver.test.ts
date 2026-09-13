import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "@/lib/runtime/d1";
import { principalId } from "@/lib/runtime/session";
import { D1ApplicationUserResolver } from "@/lib/server/d1-application-user-resolver";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (
      (this.statement.get(...(this.values as SQLInputValue[])) as
        T | undefined) ?? null
    );
  }
  async all<T>() {
    return {
      success: true,
      results: this.statement.all(...(this.values as SQLInputValue[])) as T[],
    };
  }
  async run<T>(): Promise<D1Result<T>> {
    this.statement.run(...(this.values as SQLInputValue[]));
    return { success: true };
  }
}

class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0001_workspaces.sql",
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
    ]) {
      this.sqlite.exec(
        readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
      );
    }
  }
  prepare(sql: string) {
    return new Statement(this.sqlite.prepare(sql));
  }
  async batch<T>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

function addUser(
  database: TestD1,
  principal: string,
  userId: string,
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  database.sqlite
    .prepare(
      "INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .run(userId, status);
  database.sqlite
    .prepare(
      "INSERT INTO user_principals (principal_id, user_id, provider, created_at) VALUES (?, ?, 'TEST', CURRENT_TIMESTAMP)",
    )
    .run(principal, userId);
}

function grant(
  database: TestD1,
  userId: string,
  workspaceId: "personal" | "indelitech",
  role: "OWNER" | "MEMBER",
) {
  database.sqlite
    .prepare(
      "INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES (?, ?, ?)",
    )
    .run(userId, workspaceId, role);
}

test("application user resolution returns only the authenticated active user's memberships", async () => {
  const database = new TestD1();
  addUser(database, "cf-user:marc", "user:marc");
  addUser(database, "cf-user:christa", "user:christa");
  grant(database, "user:marc", "personal", "OWNER");
  grant(database, "user:marc", "indelitech", "OWNER");
  grant(database, "user:christa", "personal", "MEMBER");

  const resolved = await new D1ApplicationUserResolver(database).resolve({
    principalId: principalId("cf-user:marc"),
  });
  assert.equal(resolved.userId, "user:marc");
  assert.deepEqual(
    resolved.workspaces.map(({ workspaceId, role }) => ({ workspaceId, role })),
    [
      { workspaceId: "personal", role: "OWNER" },
      { workspaceId: "indelitech", role: "OWNER" },
    ],
  );
  database.sqlite.close();
});

test("application user resolution fails closed for unmapped, disabled, and membership-less users", async () => {
  const database = new TestD1();
  addUser(database, "cf-user:disabled", "user:disabled", "DISABLED");
  grant(database, "user:disabled", "personal", "OWNER");
  addUser(database, "cf-user:empty", "user:empty");
  const resolver = new D1ApplicationUserResolver(database);

  for (const value of [
    "cf-user:missing",
    "cf-user:disabled",
    "cf-user:empty",
  ]) {
    await assert.rejects(
      resolver.resolve({ principalId: principalId(value) }),
      /Application user access denied/,
    );
  }
  database.sqlite.close();
});

test("unsupported future workspaces are not exposed before their UI is implemented", async () => {
  const database = new TestD1();
  addUser(database, "cf-user:marc", "user:marc");
  grant(database, "user:marc", "personal", "OWNER");
  database.sqlite.exec(`INSERT INTO workspaces
    (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES ('household', 'Household', 'SHARED', 'household', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  database.sqlite
    .prepare(
      "INSERT INTO workspace_memberships (user_id, workspace_id, role) VALUES ('user:marc', 'household', 'MEMBER')",
    )
    .run();

  const resolved = await new D1ApplicationUserResolver(database).resolve({
    principalId: principalId("cf-user:marc"),
  });
  assert.deepEqual(
    resolved.workspaces.map(({ workspaceId }) => workspaceId),
    ["personal"],
  );
  database.sqlite.close();
});

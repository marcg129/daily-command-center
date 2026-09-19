import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { applicationUserId } from "@/lib/runtime/application-user";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "@/lib/runtime/d1";
import { principalId } from "@/lib/runtime/session";
import {
  ApplicationPrincipalLinkError,
  D1ApplicationPrincipalLinker,
} from "@/lib/server/d1-application-principal-linker";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  private input() {
    return this.values as SQLInputValue[];
  }
  async first<T>() {
    return (this.statement.get(...this.input()) as T | undefined) ?? null;
  }
  async all<T>() {
    return {
      success: true,
      results: this.statement.all(...this.input()) as T[],
    };
  }
  async run<T>(): Promise<D1Result<T>> {
    this.statement.run(...this.input());
    return { success: true };
  }
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
  db: TestD1,
  userId: string,
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  db.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES (?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
  ).run(userId, status);
}

function addPrincipal(
  db: TestD1,
  principal: string,
  userId: string,
  provider: string,
) {
  db.sqlite.prepare(
    "INSERT INTO user_principals (principal_id,user_id,provider,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)",
  ).run(principal, userId, provider);
}

function grant(
  db: TestD1,
  userId: string,
  workspaceId: string,
  workspaceKey: string,
  role: "OWNER" | "MEMBER" = "OWNER",
) {
  db.sqlite.prepare(
    "INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES (?,?,?,?)",
  ).run(userId, workspaceId, workspaceKey, role);
}

function counts(db: TestD1) {
  const value = (table: string) =>
    Number((db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
  return {
    users: value("users"),
    workspaces: value("workspaces"),
    principals: value("user_principals"),
    memberships: value("workspace_memberships"),
  };
}

test("linking a verified WorkOS principal preserves the existing user and memberships and is idempotent", async () => {
  const db = new TestD1();
  addUser(db, "user:marc");
  addPrincipal(db, "cf-user:marc", "user:marc", "CLOUDFLARE_ACCESS");
  grant(db, "user:marc", "personal", "personal");
  grant(db, "user:marc", "indelitech", "indelitech");
  const before = counts(db);

  const linker = new D1ApplicationPrincipalLinker(db);
  const input = {
    userId: applicationUserId("user:marc"),
    principalId: principalId("workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT"),
    provider: "WORKOS_AUTHKIT",
  };

  await linker.link(input);
  await linker.link(input);

  assert.deepEqual(
    db.sqlite.prepare(
      "SELECT principal_id,user_id,provider FROM user_principals WHERE principal_id LIKE 'workos-user:%'",
    ).all().map((row) => ({ ...row })),
    [{
      principal_id: "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
      user_id: "user:marc",
      provider: "WORKOS_AUTHKIT",
    }],
  );
  assert.deepEqual(counts(db), {
    ...before,
    principals: before.principals + 1,
  });
  assert.deepEqual(
    db.sqlite.prepare(
      "SELECT workspace_key,workspace_id,role FROM workspace_memberships WHERE user_id='user:marc' ORDER BY workspace_key",
    ).all().map((row) => ({ ...row })),
    [
      { workspace_key: "indelitech", workspace_id: "indelitech", role: "OWNER" },
      { workspace_key: "personal", workspace_id: "personal", role: "OWNER" },
    ],
  );
  db.sqlite.close();
});

test("linker fails closed when the WorkOS principal already belongs to another DCC user", async () => {
  const db = new TestD1();
  addUser(db, "user:marc");
  addUser(db, "user:other");
  addPrincipal(db, "cf-user:marc", "user:marc", "CLOUDFLARE_ACCESS");
  addPrincipal(
    db,
    "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
    "user:other",
    "WORKOS_AUTHKIT",
  );
  grant(db, "user:marc", "personal", "personal");
  db.sqlite.prepare(`INSERT INTO workspaces
    (workspace_id,name,workspace_type,theme_key,created_at,updated_at)
    VALUES ('personal:other','Personal','PERSONAL','personal-tech-blue',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
  grant(db, "user:other", "personal:other", "personal");

  const before = counts(db);
  await assert.rejects(
    new D1ApplicationPrincipalLinker(db).link({
      userId: applicationUserId("user:marc"),
      principalId: principalId("workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT"),
      provider: "WORKOS_AUTHKIT",
    }),
    ApplicationPrincipalLinkError,
  );
  assert.deepEqual(counts(db), before);
  assert.equal(
    db.sqlite.prepare(
      "SELECT user_id FROM user_principals WHERE principal_id='workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT'",
    ).get()!.user_id,
    "user:other",
  );
  db.sqlite.close();
});

test("linker rejects disabled or structurally incomplete target users without mutation", async () => {
  const db = new TestD1();
  addUser(db, "user:disabled", "DISABLED");
  grant(db, "user:disabled", "personal", "personal");

  addUser(db, "user:incomplete");
  grant(db, "user:incomplete", "indelitech", "indelitech");

  const linker = new D1ApplicationPrincipalLinker(db);
  for (const userId of ["user:disabled", "user:incomplete"]) {
    await assert.rejects(
      linker.link({
        userId: applicationUserId(userId),
        principalId: principalId(`workos-user:${userId.replace("user:", "")}_12345678`),
        provider: "WORKOS_AUTHKIT",
      }),
      ApplicationPrincipalLinkError,
    );
  }
  assert.equal(
    db.sqlite.prepare(
      "SELECT COUNT(*) count FROM user_principals WHERE principal_id LIKE 'workos-user:%'",
    ).get()!.count,
    0,
  );
  db.sqlite.close();
});

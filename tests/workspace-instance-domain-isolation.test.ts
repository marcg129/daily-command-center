import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { principalId } from "@/lib/runtime/session";
import { D1CollectorSnapshotRepository } from "@/lib/server/d1-collector-snapshot-repository";
import { D1WorkspaceDomainRepository } from "@/lib/server/d1-workspace-domain-repository";
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
      "0003_collector_snapshots.sql",
      "0004_secrets_and_workspace_domains.sql",
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

const updatedAt = "2026-09-13T20:00:00.000Z";

function createPersonalUser(database: TestD1, name: string, physicalWorkspaceId: string) {
  const principal = principalId(`cf-user:${name}`);
  const userId = `user:${name}`;
  if (physicalWorkspaceId !== "personal") {
    database.sqlite.prepare(`INSERT INTO workspaces
      (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
      VALUES (?, 'Personal', 'PERSONAL', 'personal-tech-blue', ?, ?)`)
      .run(physicalWorkspaceId, updatedAt, updatedAt);
  }
  database.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
    .run(userId, updatedAt, updatedAt);
  database.sqlite.prepare("INSERT INTO user_principals (principal_id, user_id, provider, created_at) VALUES (?, ?, 'TEST', ?)")
    .run(principal, userId, updatedAt);
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, ?, 'personal', 'OWNER', ?, ?)`)
    .run(userId, physicalWorkspaceId, updatedAt, updatedAt);
  return principal;
}

test("workspace-domain records use the resolved physical Personal instance", async () => {
  const database = new TestD1();
  const marc = createPersonalUser(database, "marc", "personal");
  const christa = createPersonalUser(database, "christa", "personal:christa");
  const resolver = new D1WorkspaceResolver(database);
  const marcContext = await resolver.resolve({ principalId: marc }, "personal");
  const christaContext = await resolver.resolve({ principalId: christa }, "personal");
  const domains = new D1WorkspaceDomainRepository(database);

  await domains.put(marcContext, "CONTENT", { key: "same", value: { owner: "marc" }, updatedAt });
  await domains.put(christaContext, "CONTENT", { key: "same", value: { owner: "christa" }, updatedAt });

  assert.deepEqual((await domains.get<{ owner: string }>(marcContext, "CONTENT", "same"))?.value, { owner: "marc" });
  assert.deepEqual((await domains.get<{ owner: string }>(christaContext, "CONTENT", "same"))?.value, { owner: "christa" });
  database.sqlite.close();
});

test("collector snapshots use the resolved physical Personal instance", async () => {
  const database = new TestD1();
  const marc = createPersonalUser(database, "marc", "personal");
  const christa = createPersonalUser(database, "christa", "personal:christa");
  const resolver = new D1WorkspaceResolver(database);
  const marcContext = await resolver.resolve({ principalId: marc }, "personal");
  const christaContext = await resolver.resolve({ principalId: christa }, "personal");
  const snapshots = new D1CollectorSnapshotRepository(database);

  await snapshots.write(marcContext, "industry", "same", { owner: "marc" }, updatedAt);
  await snapshots.write(christaContext, "industry", "same", { owner: "christa" }, updatedAt);

  assert.deepEqual((await snapshots.read<{ owner: string }>(marcContext, "industry", "same"))?.payload, { owner: "marc" });
  assert.deepEqual((await snapshots.read<{ owner: string }>(christaContext, "industry", "same"))?.payload, { owner: "christa" });
  database.sqlite.close();
});

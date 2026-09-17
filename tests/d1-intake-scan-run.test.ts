import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { D1IntakeRepository } from "@/lib/server/d1-intake-repository";

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
      "0001_workspaces.sql", "0002_tasks.sql", "0003_collector_snapshots.sql",
      "0004_secrets_and_workspace_domains.sql", "0005_task_capture_metadata.sql",
      "0006_principal_workspace_grants.sql", "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql", "0009_bills_and_obligations.sql", "0010_income_and_cashflow.sql",
      "0011_todoist_ingress_control.sql", "0012_daily_intake_events.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

test("Intake persistence retains and refreshes the originating scan-run ID", async () => {
  const database = new TestD1();
  database.sqlite.prepare(`INSERT INTO workspaces
    (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES ('personal:marc', 'Marc Personal', 'PERSONAL', 'personal-tech-blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  database.sqlite.prepare(`INSERT INTO users (user_id, status, created_at, updated_at)
    VALUES ('user:marc', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  database.sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role)
    VALUES ('user:marc', 'personal:marc', 'personal', 'OWNER')`).run();

  const clock = { now: () => new Date("2026-09-17T16:00:00Z") };
  let id = 0;
  const ids = { generate: () => `intake-${++id}` };
  const repo = new D1IntakeRepository(database, clock, ids);
  const context = { userId: "user:marc", workspaceId: "personal:marc", workspaceKey: "personal" as const };
  const base = {
    workspaceId: "personal" as const,
    sourceKey: "personal_gmail" as const,
    sourceType: "gmail" as const,
    messageId: "msg-1",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-17T11:00:00-04:00",
    intakeType: "TASK" as const,
    title: "Reply",
    summary: "Reply requested.",
    classificationReason: "Explicit response request.",
  };

  const created = await repo.ingest(context, { ...base, scanRunId: "scan-morning" });
  assert.equal(created.item.scanRunId, "scan-morning");
  assert.equal(database.sqlite.prepare("SELECT scan_run_id FROM intake_items WHERE intake_id='intake-1'").get()?.scan_run_id, "scan-morning");

  const replay = await repo.ingest(context, { ...base, scanRunId: "scan-noon", sourceTimestamp: "2026-09-17T12:30:00-04:00" });
  assert.equal(replay.item.scanRunId, "scan-noon");
  assert.equal(database.sqlite.prepare("SELECT scan_run_id FROM intake_items WHERE intake_id='intake-1'").get()?.scan_run_id, "scan-noon");
  database.sqlite.close();
});

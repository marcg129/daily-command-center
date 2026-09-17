import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { ScanStatusInput } from "@/lib/runtime/daily-intake";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { D1SourceFreshnessRepository } from "@/lib/server/d1-source-freshness-repository";

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

function addUser(database: TestD1, userId: string) {
  database.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    .run(userId);
}

function statuses(scanRunId: string, personalState: "SUCCESS" | "FAILED" = "SUCCESS"): ScanStatusInput {
  const attemptedAt = "2026-09-17T11:00:00-04:00";
  const success = (sourceKey: ScanStatusInput["sources"][number]["sourceKey"]) => ({
    sourceKey,
    state: "SUCCESS" as const,
    attemptedAt,
    completedAt: "2026-09-17T11:01:00-04:00",
  });
  return {
    scanRunId,
    sources: [
      personalState === "SUCCESS"
        ? success("personal_gmail")
        : { sourceKey: "personal_gmail", state: "FAILED", attemptedAt, diagnostic: "Gmail read failed." },
      success("professional_gmail"),
      success("indelitech_gmail"),
      success("primary_calendar"),
      success("family_calendar"),
    ],
  };
}

test("missing source freshness is unknown and stale rather than implied successful", async () => {
  const database = new TestD1();
  addUser(database, "user:marc");
  const repo = new D1SourceFreshnessRepository(database);

  const missing = await repo.get("user:marc", "personal_gmail");
  assert.deepEqual(missing, {
    sourceKey: "personal_gmail",
    state: "UNKNOWN",
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    diagnostic: null,
    scanRunId: null,
  });
  database.sqlite.close();
});

test("SUCCESS advances last successful freshness even when the scan produced zero proposals or events", async () => {
  const database = new TestD1();
  addUser(database, "user:marc");
  const repo = new D1SourceFreshnessRepository(database);

  await repo.record("user:marc", statuses("scan-empty-success"));
  const personal = await repo.get("user:marc", "personal_gmail");
  assert.equal(personal.state, "SUCCESS");
  assert.equal(personal.lastAttemptAt, "2026-09-17T11:00:00-04:00");
  assert.equal(personal.lastSuccessfulAt, "2026-09-17T11:01:00-04:00");
  assert.equal(personal.scanRunId, "scan-empty-success");
  database.sqlite.close();
});

test("FAILED updates attempt diagnostics but never advances the previous successful timestamp", async () => {
  const database = new TestD1();
  addUser(database, "user:marc");
  const repo = new D1SourceFreshnessRepository(database);

  await repo.record("user:marc", statuses("scan-success"));
  const before = await repo.get("user:marc", "personal_gmail");
  await repo.record("user:marc", statuses("scan-failed", "FAILED"));
  const after = await repo.get("user:marc", "personal_gmail");

  assert.equal(after.state, "FAILED");
  assert.equal(after.lastSuccessfulAt, before.lastSuccessfulAt);
  assert.equal(after.diagnostic, "Gmail read failed.");
  assert.equal(after.scanRunId, "scan-failed");
  database.sqlite.close();
});

test("freshness rows remain isolated per DCC user", async () => {
  const database = new TestD1();
  addUser(database, "user:marc");
  addUser(database, "user:other");
  const repo = new D1SourceFreshnessRepository(database);

  await repo.record("user:marc", statuses("scan-marc"));
  assert.equal((await repo.get("user:other", "personal_gmail")).state, "UNKNOWN");
  assert.equal((await repo.list("user:marc")).length, 5);
  assert.equal((await repo.list("user:other")).every((row) => row.state === "UNKNOWN"), true);
  database.sqlite.close();
});
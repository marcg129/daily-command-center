import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import type { RequestContext } from "@/lib/runtime/context";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { D1IncomeRepository } from "@/lib/server/d1-income-repository";

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
      "0001_workspaces.sql", "0002_tasks.sql", "0003_collector_snapshots.sql", "0004_secrets_and_workspace_domains.sql",
      "0005_task_capture_metadata.sql", "0006_principal_workspace_grants.sql", "0007_user_workspace_ownership.sql",
      "0008_workspace_instances.sql", "0009_bills_and_obligations.sql", "0010_income_and_cashflow.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));

    this.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
      .run("user:marc", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z");
    this.sqlite.prepare("INSERT INTO workspace_memberships (user_id, workspace_id, workspace_key, role) VALUES (?, ?, ?, 'OWNER')")
      .run("user:marc", "personal", "personal");
  }

  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
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

const context: RequestContext = { workspaceId: "personal", workspaceKey: "personal", userId: "user:marc" };
const clock: Clock = { now: () => new Date("2026-09-15T16:00:00.000Z") };
const ids: IdGenerator = { generate: () => "income-effective-date" };

function semimonthIncome(): IncomeDefinitionCore {
  return {
    name: "Paycheck",
    payer: "Employer",
    amountMode: "FIXED",
    defaultNetAmountMinor: 150_000,
    currency: "USD",
    scheduleStartDate: "2026-09-15",
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
    status: "ACTIVE",
  };
}

test("future-effective income schedule edits never replenish the new schedule before the boundary", async () => {
  const d1 = new TestD1();
  const repository = new D1IncomeRepository(d1, context, clock, ids);
  await repository.create(semimonthIncome());

  const weekly: IncomeDefinitionCore = {
    ...semimonthIncome(),
    recurrenceUnit: "WEEK",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
  };
  await repository.update("income-effective-date", weekly, "2026-10-01");

  assert.equal(
    (d1.sqlite.prepare("SELECT materialization_start_date FROM income_sources WHERE income_source_id=?")
      .get("income-effective-date") as { materialization_start_date: string }).materialization_start_date,
    "2026-10-01",
  );

  const firstSummary = await repository.listSummary();
  const firstDates = firstSummary.occurrences.map((item) => item.payDate);
  assert.ok(firstDates.includes("2026-09-30"), "old-schedule occurrence before the boundary is preserved");
  assert.equal(firstDates.includes("2026-09-22"), false, "new weekly schedule must not leak before effective date");
  assert.equal(firstDates.includes("2026-09-29"), false, "new weekly schedule must not leak before effective date");
  assert.ok(firstDates.includes("2026-10-06"), "new weekly schedule starts at its first date on/after the boundary");

  const october6 = firstSummary.occurrences.find((item) => item.payDate === "2026-10-06");
  assert.ok(october6);
  await repository.resolveOccurrence(october6.occurrenceId, { action: "SKIPPED" });

  const afterResolution = await repository.listOccurrences({ incomeSourceId: "income-effective-date" });
  assert.equal(afterResolution.some((item) => item.payDate === "2026-09-22"), false);
  assert.equal(afterResolution.some((item) => item.payDate === "2026-09-29"), false);
  assert.equal(afterResolution.find((item) => item.payDate === "2026-10-06")?.status, "SKIPPED");

  d1.sqlite.close();
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import type { RequestContext } from "@/lib/runtime/context";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { InMemorySessionProvider, principalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedIncomeHandler } from "@/lib/server/authorized-hosted-income-handler";
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

    this.sqlite.prepare("INSERT INTO workspaces (workspace_id, name, workspace_type, theme_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("personal:other", "Other Personal", "PERSONAL", "personal-tech-blue", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z");
    this.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
      .run("user:other", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z");
    this.sqlite.prepare("INSERT INTO workspace_memberships (user_id, workspace_id, workspace_key, role) VALUES (?, ?, ?, 'OWNER')")
      .run("user:other", "personal:other", "personal");
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

const marcContext: RequestContext = { workspaceId: "personal", workspaceKey: "personal", userId: "user:marc" };
const otherContext: RequestContext = { workspaceId: "personal:other", workspaceKey: "personal", userId: "user:other" };
const clock: Clock = { now: () => new Date("2026-09-15T16:00:00.000Z") };

function ids(...values: string[]): IdGenerator {
  let index = 0;
  return { generate: () => values[index++] ?? `generated-${index}` };
}

function semimonthIncome(overrides: Partial<IncomeDefinitionCore> = {}): IncomeDefinitionCore {
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
    ...overrides,
  };
}

test("D1 Income binds reads and writes to the authenticated physical workspace and materializes idempotently", async () => {
  const d1 = new TestD1();
  const repository = new D1IncomeRepository(d1, marcContext, clock, ids("income-1"));
  const created = await repository.create(semimonthIncome());
  assert.equal(created.incomeSource.primaryWorkspaceId, "personal");
  assert.equal(created.incomeSource.createdByUserId, "user:marc");
  assert.deepEqual(created.occurrences.slice(0, 2).map((item) => item.payDate), ["2026-09-15", "2026-09-30"]);
  assert.equal(created.occurrences.at(-1)?.payDate, "2027-09-15");

  const first = await repository.listSummary();
  const second = await repository.listSummary();
  assert.equal(first.incomeSources.length, 1);
  assert.equal(first.occurrences.length, second.occurrences.length);
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM income_occurrences WHERE income_source_id='income-1'").get() as { count: number }).count, first.occurrences.length);

  const other = new D1IncomeRepository(d1, otherContext, clock, ids("other-income"));
  assert.equal((await other.listSummary()).incomeSources.length, 0);
  await other.create(semimonthIncome({ name: "Other Paycheck" }));
  assert.equal((await other.listSummary()).incomeSources.length, 1);
  assert.equal((await repository.listSummary()).incomeSources.length, 1);

  const forged = new D1IncomeRepository(
    d1,
    { workspaceId: "personal", workspaceKey: "personal", userId: "user:other" },
    clock,
    ids("forged"),
  );
  await assert.rejects(forged.listSummary(), /Workspace access denied/);
  d1.sqlite.close();
});

test("Income lifecycle preserves resolved history and regenerates only future EXPECTED rows after occurrence-affecting edits", async () => {
  const d1 = new TestD1();
  const repository = new D1IncomeRepository(d1, marcContext, clock, ids("income-edit"));
  const created = await repository.create(semimonthIncome());
  const september15 = created.occurrences.find((item) => item.payDate === "2026-09-15");
  assert.ok(september15);

  const received = await repository.resolveOccurrence(september15.occurrenceId, {
    action: "RECEIVED",
    receivedOn: "2026-09-15",
    receivedAmountMinor: 151_234,
    resolutionNote: "Deposit received",
  });
  assert.equal(received.status, "RECEIVED");
  assert.equal(received.resolvedByUserId, "user:marc");
  assert.equal(received.resolvedAt, "2026-09-15T16:00:00.000Z");
  await assert.rejects(repository.resolveOccurrence(september15.occurrenceId, {
    action: "RECEIVED", receivedOn: "2026-09-15",
  }), /already resolved/);

  const changed = semimonthIncome({ defaultNetAmountMinor: 160_000 });
  await assert.rejects(repository.update("income-edit", changed), /effectiveDate/);
  await assert.rejects(repository.update("income-edit", changed, "2026-09-14"), /before today/);
  const saved = await repository.update("income-edit", changed, "2026-09-16");
  assert.equal(saved.defaultNetAmountMinor, 160_000);

  const history = await repository.listOccurrences({ incomeSourceId: "income-edit" });
  assert.equal(history.find((item) => item.payDate === "2026-09-15")?.status, "RECEIVED");
  assert.equal(history.find((item) => item.payDate === "2026-09-30")?.expectedAmountMinor, 160_000);

  await repository.update("income-edit", { ...changed, status: "PAUSED" });
  const paused = await repository.listSummary();
  assert.equal(paused.incomeSources[0]?.status, "PAUSED");
  assert.equal(paused.occurrences.length, 0);
  assert.ok((await repository.listOccurrences({ incomeSourceId: "income-edit" })).some((item) => item.status === "EXPECTED"));

  await repository.update("income-edit", { ...changed, status: "ACTIVE" });
  assert.ok((await repository.listSummary()).occurrences.length > 0);
  d1.sqlite.close();
});

test("one-time past income is retained once while old recurring income materializes only the current future horizon", async () => {
  const d1 = new TestD1();
  const repository = new D1IncomeRepository(d1, marcContext, clock, ids("one-time", "old-recurring"));
  const oneTime = await repository.create(semimonthIncome({
    name: "Past bonus",
    scheduleStartDate: "2026-09-01",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
  }));
  assert.deepEqual(oneTime.occurrences.map((item) => item.payDate), ["2026-09-01"]);

  const recurring = await repository.create(semimonthIncome({
    name: "Old biweekly pay",
    scheduleStartDate: "2024-01-05",
    recurrenceUnit: "WEEK",
    recurrenceInterval: 2,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
  }));
  assert.ok(recurring.occurrences.every((item) => item.payDate >= "2026-09-15"));
  d1.sqlite.close();
});

test("manual cash-flow baseline is signed, workspace-isolated, replaceable, and clearable", async () => {
  const d1 = new TestD1();
  const repository = new D1IncomeRepository(d1, marcContext, clock, ids());
  const saved = await repository.saveBaseline({ amountMinor: -12_345, currency: "USD", asOfDate: "2026-09-15" });
  assert.equal(saved.amountMinor, -12_345);
  assert.equal(saved.primaryWorkspaceId, "personal");
  assert.equal(saved.updatedByUserId, "user:marc");

  const updated = await repository.saveBaseline({ amountMinor: 54_321, currency: "USD", asOfDate: "2026-09-14" });
  assert.equal(updated.amountMinor, 54_321);
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM cashflow_baselines WHERE primary_workspace_id='personal'").get() as { count: number }).count, 1);
  await assert.rejects(repository.saveBaseline({ amountMinor: 1, currency: "USD", asOfDate: "2026-09-16" }), /after today/);

  const other = new D1IncomeRepository(d1, otherContext, clock, ids());
  assert.equal(await other.getBaseline(), null);

  const forged = new D1IncomeRepository(
    d1,
    { workspaceId: "personal", workspaceKey: "personal", userId: "user:other" },
    clock,
    ids(),
  );
  await assert.rejects(forged.getBaseline(), /Workspace access denied/);

  await repository.clearBaseline();
  assert.equal(await repository.getBaseline(), null);
  d1.sqlite.close();
});

test("hosted Income API requires Access and workspace authorization, disables caching, and supports occurrence plus baseline lifecycle", async () => {
  const d1 = new TestD1();
  const sessions = new InMemorySessionProvider(new Map([["good-token", {
    sessionId: "session-1",
    principal: { principalId: principalId("principal:marc") },
    expiresAt: "2026-09-16T16:00:00.000Z",
  }]]));
  const resolver: WorkspaceResolver = {
    async resolve(principal, requestedWorkspaceId) {
      if (principal?.principalId !== principalId("principal:marc") || requestedWorkspaceId !== "personal") {
        throw new Error("Workspace access denied.");
      }
      return marcContext;
    },
  };
  const handler = createAuthorizedHostedIncomeHandler(sessions, resolver, d1, clock, ids("api-income"));
  const incomeUrl = "https://command.coreyg.dev/api/hosted/income?workspaceId=personal";

  const unauthenticated = await handler.income.GET(new Request(incomeUrl));
  assert.equal(unauthenticated.status, 403);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

  const invalid = await handler.income.POST(new Request(incomeUrl, {
    method: "POST",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ incomeSource: semimonthIncome({ defaultNetAmountMinor: null }) }),
  }));
  assert.equal(invalid.status, 400);

  const created = await handler.income.POST(new Request(incomeUrl, {
    method: "POST",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ incomeSource: semimonthIncome() }),
  }));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const createdBody = await created.json() as { occurrences: Array<{ occurrenceId: string }> };
  assert.ok(createdBody.occurrences[0]?.occurrenceId);

  const summary = await handler.income.GET(new Request(incomeUrl, {
    headers: { "cf-access-jwt-assertion": "good-token" },
  }));
  assert.equal(summary.status, 200);
  assert.equal((await summary.json() as { incomeSources: unknown[] }).incomeSources.length, 1);

  const resolved = await handler.occurrences.POST(new Request(
    "https://command.coreyg.dev/api/hosted/income/occurrences?workspaceId=personal",
    {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
      body: JSON.stringify({
        occurrenceId: createdBody.occurrences[0].occurrenceId,
        action: "RECEIVED",
        receivedOn: "2026-09-15",
        receivedAmountMinor: 150_000,
      }),
    },
  ));
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json() as { occurrence: { status: string } }).occurrence.status, "RECEIVED");

  const baselineUrl = "https://command.coreyg.dev/api/hosted/cashflow/baseline?workspaceId=personal";
  const savedBaseline = await handler.baseline.PUT(new Request(baselineUrl, {
    method: "PUT",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ baseline: { amountMinor: 250_000, currency: "USD", asOfDate: "2026-09-15" } }),
  }));
  assert.equal(savedBaseline.status, 200);
  assert.equal(savedBaseline.headers.get("cache-control"), "no-store");
  assert.equal((await savedBaseline.json() as { baseline: { amountMinor: number } }).baseline.amountMinor, 250_000);

  const readBaseline = await handler.baseline.GET(new Request(baselineUrl, {
    headers: { "cf-access-jwt-assertion": "good-token" },
  }));
  assert.equal((await readBaseline.json() as { baseline: { amountMinor: number } }).baseline.amountMinor, 250_000);

  const futureBaseline = await handler.baseline.PUT(new Request(baselineUrl, {
    method: "PUT",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ baseline: { amountMinor: 1, currency: "USD", asOfDate: "2026-09-16" } }),
  }));
  assert.equal(futureBaseline.status, 400);

  const cleared = await handler.baseline.DELETE(new Request(baselineUrl, {
    method: "DELETE",
    headers: { "cf-access-jwt-assertion": "good-token" },
  }));
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json() as { baseline: null }).baseline, null);

  const denied = await handler.income.GET(new Request(
    "https://command.coreyg.dev/api/hosted/income?workspaceId=indelitech",
    { headers: { "cf-access-jwt-assertion": "good-token" } },
  ));
  assert.equal(denied.status, 403);
  d1.sqlite.close();
});

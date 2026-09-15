import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { BillDefinitionCore } from "@/lib/runtime/bills";
import type { RequestContext } from "@/lib/runtime/context";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { InMemorySessionProvider, principalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedBillsHandler } from "@/lib/server/authorized-hosted-bills-handler";
import { D1BillRepository } from "@/lib/server/d1-bill-repository";

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
      "0008_workspace_instances.sql", "0009_bills_and_obligations.sql",
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

function monthlyBill(overrides: Partial<BillDefinitionCore> = {}): BillDefinitionCore {
  return {
    name: "Rent",
    payee: "Landlord",
    category: "Housing",
    amountMode: "FIXED",
    defaultAmountMinor: 100_00,
    currency: "USD",
    autopay: false,
    paymentUrl: "https://example.com/pay",
    notes: null,
    scheduleStartDate: "2026-09-30",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "LAST_DAY",
    reminderDaysBefore: 5,
    status: "ACTIVE",
    ...overrides,
  };
}

test("D1 Bills bind every read and write to the authenticated physical workspace and materialize idempotently", async () => {
  const d1 = new TestD1();
  const repository = new D1BillRepository(d1, marcContext, clock, ids("bill-1"));
  const created = await repository.create(monthlyBill());
  assert.equal(created.bill.primaryWorkspaceId, "personal");
  assert.equal(created.bill.createdByUserId, "user:marc");
  assert.equal(created.occurrences[0]?.dueDate, "2026-09-30");
  assert.equal(created.occurrences.at(-1)?.dueDate, "2027-08-31");

  const first = await repository.listSummary();
  const second = await repository.listSummary();
  assert.equal(first.bills.length, 1);
  assert.equal(first.occurrences.length, second.occurrences.length);
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM bill_occurrences WHERE bill_id='bill-1'").get() as { count: number }).count, first.occurrences.length);

  const other = new D1BillRepository(d1, otherContext, clock, ids("other-bill"));
  assert.equal((await other.listSummary()).bills.length, 0);
  await other.create(monthlyBill({ name: "Other Rent" }));
  assert.equal((await other.listSummary()).bills.length, 1);
  assert.equal((await repository.listSummary()).bills.length, 1);

  const forged = new D1BillRepository(
    d1,
    { workspaceId: "personal", workspaceKey: "personal", userId: "user:other" },
    clock,
    ids("forged"),
  );
  await assert.rejects(forged.listSummary(), /Workspace access denied/);
  d1.sqlite.close();
});

test("Bill lifecycle preserves resolved history while occurrence-affecting edits replace only future OPEN rows", async () => {
  const d1 = new TestD1();
  const repository = new D1BillRepository(d1, marcContext, clock, ids("bill-edit"));
  const created = await repository.create(monthlyBill());
  const september = created.occurrences.find((item) => item.dueDate === "2026-09-30");
  assert.ok(september);

  const paid = await repository.resolveOccurrence(september.occurrenceId, {
    action: "PAID",
    paidOn: "2026-09-30",
    paidAmountMinor: 100_00,
    resolutionNote: "Paid from checking",
  });
  assert.equal(paid.status, "PAID");
  assert.equal(paid.resolvedByUserId, "user:marc");
  assert.equal(paid.resolvedAt, "2026-09-15T16:00:00.000Z");
  await assert.rejects(repository.resolveOccurrence(september.occurrenceId, {
    action: "PAID", paidOn: "2026-09-30",
  }), /already resolved/);

  const changed = monthlyBill({
    defaultAmountMinor: 120_00,
    scheduleStartDate: "2026-10-15",
    recurrenceDayMode: "ANCHOR_DATE",
  });
  await assert.rejects(repository.update("bill-edit", changed), /effectiveDate/);
  await assert.rejects(repository.update("bill-edit", changed, "2026-09-14"), /before today/);
  const saved = await repository.update("bill-edit", changed, "2026-10-01");
  assert.equal(saved.defaultAmountMinor, 120_00);

  const history = await repository.listOccurrences({ billId: "bill-edit" });
  assert.equal(history.find((item) => item.dueDate === "2026-09-30")?.status, "PAID");
  assert.equal(history.some((item) => item.dueDate === "2026-10-31"), false);
  assert.equal(history.find((item) => item.dueDate === "2026-10-15")?.expectedAmountMinor, 120_00);

  await repository.update("bill-edit", { ...changed, status: "PAUSED" });
  assert.equal((await repository.listSummary()).bills[0]?.status, "PAUSED");
  d1.sqlite.close();
});

test("one-time bills can be created already overdue without manufacturing recurring historical debt", async () => {
  const d1 = new TestD1();
  const repository = new D1BillRepository(d1, marcContext, clock, ids("one-time", "recurring-old"));
  const oneTime = await repository.create(monthlyBill({
    name: "Past one-time bill",
    scheduleStartDate: "2026-09-01",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
  }));
  assert.deepEqual(oneTime.occurrences.map((item) => item.dueDate), ["2026-09-01"]);

  const recurring = await repository.create(monthlyBill({
    name: "Old recurring bill",
    scheduleStartDate: "2024-01-31",
    recurrenceDayMode: "ANCHOR_DATE",
  }));
  assert.ok(recurring.occurrences.every((item) => item.dueDate >= "2026-09-15"));
  assert.equal(recurring.occurrences[0]?.dueDate, "2026-09-30");
  d1.sqlite.close();
});

test("hosted Bills API requires Access plus workspace authorization, rejects unsafe payment URLs, and disables caching", async () => {
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
  const handler = createAuthorizedHostedBillsHandler(sessions, resolver, d1, clock, ids("api-bill"));
  const url = "https://command.coreyg.dev/api/hosted/bills?workspaceId=personal";

  const unauthenticated = await handler.bills.GET(new Request(url));
  assert.equal(unauthenticated.status, 403);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

  const unsafe = await handler.bills.POST(new Request(url, {
    method: "POST",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ bill: monthlyBill({ paymentUrl: "http://example.com/pay" }) }),
  }));
  assert.equal(unsafe.status, 400);

  const created = await handler.bills.POST(new Request(url, {
    method: "POST",
    headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
    body: JSON.stringify({ bill: monthlyBill() }),
  }));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const createdBody = await created.json() as { occurrences: Array<{ occurrenceId: string }> };
  assert.ok(createdBody.occurrences[0]?.occurrenceId);

  const summary = await handler.bills.GET(new Request(url, { headers: { "cf-access-jwt-assertion": "good-token" } }));
  assert.equal(summary.status, 200);
  assert.equal((await summary.json() as { bills: unknown[] }).bills.length, 1);

  const resolved = await handler.occurrences.POST(new Request(
    "https://command.coreyg.dev/api/hosted/bills/occurrences?workspaceId=personal",
    {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "good-token", "content-type": "application/json" },
      body: JSON.stringify({
        occurrenceId: createdBody.occurrences[0].occurrenceId,
        action: "PAID",
        paidOn: "2026-09-30",
        paidAmountMinor: 100_00,
      }),
    },
  ));
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json() as { occurrence: { status: string } }).occurrence.status, "PAID");

  const denied = await handler.bills.GET(new Request(
    "https://command.coreyg.dev/api/hosted/bills?workspaceId=indelitech",
    { headers: { "cf-access-jwt-assertion": "good-token" } },
  ));
  assert.equal(denied.status, 403);
  d1.sqlite.close();
});

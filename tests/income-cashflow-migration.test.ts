import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const PRE_INCOME_MIGRATIONS = [
  "0001_workspaces.sql",
  "0002_tasks.sql",
  "0003_collector_snapshots.sql",
  "0004_secrets_and_workspace_domains.sql",
  "0005_task_capture_metadata.sql",
  "0006_principal_workspace_grants.sql",
  "0007_user_workspace_ownership.sql",
  "0008_workspace_instances.sql",
  "0009_bills_and_obligations.sql",
] as const;

function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function setupDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of PRE_INCOME_MIGRATIONS) sqlite.exec(migration(name));

  sqlite.prepare(`INSERT INTO bills (
    bill_id, primary_workspace_id, name, amount_mode, default_amount_minor, currency, autopay,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode, status,
    created_at, updated_at
  ) VALUES (?, 'personal', ?, 'FIXED', ?, 'USD', 0, ?, 'MONTH', 1, 'ANCHOR_DATE', 'ACTIVE', ?, ?)`).run(
    "pre-income-bill", "Existing bill", 12_34, "2026-09-16",
    "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );

  sqlite.exec(migration("0010_income_and_cashflow.sql"));
  return sqlite;
}

test("0010 adds STRICT income/cash-flow tables without altering existing Bills data", () => {
  const sqlite = setupDatabase();
  const tables = sqlite.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
  assert.equal(tables.find((row) => row.name === "income_sources")?.strict, 1);
  assert.equal(tables.find((row) => row.name === "income_occurrences")?.strict, 1);
  assert.equal(tables.find((row) => row.name === "cashflow_baselines")?.strict, 1);
  assert.equal((sqlite.prepare("SELECT name FROM bills WHERE bill_id=?").get("pre-income-bill") as { name: string }).name, "Existing bill");
  sqlite.close();
});

test("income source schema accepts future physical workspaces and enforces schedule/amount invariants", () => {
  const sqlite = setupDatabase();
  sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)").run(
    "user:future", "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );
  sqlite.prepare(`INSERT INTO workspaces (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    "personal:future", "Future Personal", "PERSONAL", "personal-tech-blue",
    "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );

  const insert = sqlite.prepare(`INSERT INTO income_sources (
    income_source_id, primary_workspace_id, name, payer, amount_mode, default_net_amount_minor, currency,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode,
    semimonth_day_one, semimonth_day_two, status, created_by_user_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const add = (overrides: Partial<{
    id: string; workspace: string; amountMode: string; amount: number | null; currency: string;
    startDate: string; unit: string; interval: number; dayMode: string | null;
    dayOne: number | null; dayTwo: number | null;
  }> = {}) => insert.run(
    overrides.id ?? "income-1",
    overrides.workspace ?? "personal:future",
    "Paycheck",
    "Employer",
    overrides.amountMode ?? "FIXED",
    overrides.amount === undefined ? 250_000 : overrides.amount,
    overrides.currency ?? "USD",
    overrides.startDate ?? "2026-09-30",
    overrides.unit ?? "MONTH",
    overrides.interval ?? 1,
    overrides.dayMode === undefined ? "LAST_DAY" : overrides.dayMode,
    overrides.dayOne === undefined ? null : overrides.dayOne,
    overrides.dayTwo === undefined ? null : overrides.dayTwo,
    "ACTIVE",
    "user:future",
    "2026-09-16T00:00:00Z",
    "2026-09-16T00:00:00Z",
  );

  assert.doesNotThrow(() => add());
  assert.equal((sqlite.prepare("SELECT primary_workspace_id FROM income_sources WHERE income_source_id='income-1'").get() as { primary_workspace_id: string }).primary_workspace_id, "personal:future");

  assert.doesNotThrow(() => add({
    id: "semi", startDate: "2026-09-15", unit: "SEMIMONTH", interval: 1, dayMode: null, dayOne: 15, dayTwo: 31,
  }));
  assert.throws(() => add({ id: "bad-workspace", workspace: "missing" }));
  assert.throws(() => add({ id: "bad-fixed", amountMode: "FIXED", amount: null }));
  assert.throws(() => add({ id: "bad-money", amount: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => add({ id: "bad-currency", currency: "US1" }));
  assert.throws(() => add({ id: "bad-none", unit: "NONE", interval: 2, dayMode: null }));
  assert.throws(() => add({ id: "bad-week", unit: "WEEK", dayMode: "ANCHOR_DATE" }));
  assert.throws(() => add({ id: "bad-semi-first", startDate: "2026-09-28", unit: "SEMIMONTH", dayMode: null, dayOne: 28, dayTwo: 31 }));
  assert.throws(() => add({ id: "bad-semi-interval", startDate: "2026-09-15", unit: "SEMIMONTH", interval: 2, dayMode: null, dayOne: 15, dayTwo: 31 }));
  assert.throws(() => sqlite.prepare("UPDATE income_sources SET primary_workspace_id='personal' WHERE income_source_id='income-1'").run(), /immutable/i);

  sqlite.close();
});

test("income occurrences preserve resolution history and manual baselines allow signed safe-integer cash", () => {
  const sqlite = setupDatabase();
  sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)").run(
    "user:resolver", "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );
  sqlite.prepare(`INSERT INTO income_sources (
    income_source_id, primary_workspace_id, name, amount_mode, default_net_amount_minor, currency,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode,
    semimonth_day_one, semimonth_day_two, status, created_by_user_id, created_at, updated_at
  ) VALUES (?, 'personal', ?, 'FIXED', ?, 'USD', ?, 'WEEK', 2, NULL, NULL, NULL, 'ACTIVE', ?, ?, ?)`).run(
    "income-history", "Salary", 200_000, "2026-09-18", "user:resolver",
    "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );

  const insertOccurrence = sqlite.prepare(`INSERT INTO income_occurrences (
    occurrence_id, income_source_id, pay_date, expected_amount_minor, currency, status,
    received_amount_minor, received_on, resolved_by_user_id, resolved_at, resolution_note,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  insertOccurrence.run(
    "income-open", "income-history", "2026-09-18", 200_000, "USD", "EXPECTED",
    null, null, null, null, null, "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );
  assert.throws(() => insertOccurrence.run(
    "income-dup", "income-history", "2026-09-18", 200_000, "USD", "EXPECTED",
    null, null, null, null, null, "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  ));
  assert.throws(() => insertOccurrence.run(
    "income-bad-expected", "income-history", "2026-10-02", 200_000, "USD", "EXPECTED",
    null, null, "user:resolver", "2026-10-02T12:00:00Z", null,
    "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  ));
  assert.throws(() => insertOccurrence.run(
    "income-bad-received", "income-history", "2026-10-16", 200_000, "USD", "RECEIVED",
    201_000, "2026-10-16", "user:resolver", null, null,
    "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  ));

  insertOccurrence.run(
    "income-received", "income-history", "2026-10-16", 200_000, "USD", "RECEIVED",
    201_000, "2026-10-16", "user:resolver", "2026-10-16T12:00:00Z", "Deposit confirmed manually",
    "2026-10-16T12:00:00Z", "2026-10-16T12:00:00Z",
  );

  sqlite.prepare("UPDATE income_sources SET status='ARCHIVED' WHERE income_source_id='income-history'").run();
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM income_occurrences WHERE income_source_id='income-history'").get() as { count: number }).count, 2);

  sqlite.prepare(`INSERT INTO cashflow_baselines (
    primary_workspace_id, amount_minor, currency, as_of_date, updated_by_user_id, created_at, updated_at
  ) VALUES ('personal', ?, 'USD', '2026-09-16', ?, ?, ?)`).run(
    -12_345, "user:resolver", "2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z",
  );
  assert.equal((sqlite.prepare("SELECT amount_minor FROM cashflow_baselines WHERE primary_workspace_id='personal'").get() as { amount_minor: number }).amount_minor, -12_345);
  assert.throws(() => sqlite.prepare("UPDATE cashflow_baselines SET primary_workspace_id='indelitech' WHERE primary_workspace_id='personal'").run(), /immutable/i);
  assert.throws(() => sqlite.prepare(`INSERT INTO cashflow_baselines (
    primary_workspace_id, amount_minor, currency, as_of_date, created_at, updated_at
  ) VALUES ('indelitech', 0, 'US1', '2026-09-16', ?, ?)`).run("2026-09-16T00:00:00Z", "2026-09-16T00:00:00Z"));

  sqlite.prepare("DELETE FROM users WHERE user_id='user:resolver'").run();
  const received = sqlite.prepare("SELECT status, received_on, resolved_by_user_id, resolved_at FROM income_occurrences WHERE occurrence_id='income-received'").get() as {
    status: string; received_on: string; resolved_by_user_id: string | null; resolved_at: string;
  };
  assert.equal(received.status, "RECEIVED");
  assert.equal(received.received_on, "2026-10-16");
  assert.equal(received.resolved_by_user_id, null);
  assert.equal(received.resolved_at, "2026-10-16T12:00:00Z");
  assert.equal((sqlite.prepare("SELECT updated_by_user_id FROM cashflow_baselines WHERE primary_workspace_id='personal'").get() as { updated_by_user_id: string | null }).updated_by_user_id, null);

  sqlite.prepare("DELETE FROM income_sources WHERE income_source_id='income-history'").run();
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM income_occurrences WHERE income_source_id='income-history'").get() as { count: number }).count, 0);
  sqlite.close();
});

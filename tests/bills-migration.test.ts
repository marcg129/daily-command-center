import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const PRE_BILLS_MIGRATIONS = [
  "0001_workspaces.sql",
  "0002_tasks.sql",
  "0003_collector_snapshots.sql",
  "0004_secrets_and_workspace_domains.sql",
  "0005_task_capture_metadata.sql",
  "0006_principal_workspace_grants.sql",
  "0007_user_workspace_ownership.sql",
  "0008_workspace_instances.sql",
] as const;

function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function setupDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of PRE_BILLS_MIGRATIONS) sqlite.exec(migration(name));

  sqlite.prepare(`INSERT INTO tasks (
    task_id, primary_workspace_id, title, type, priority, status, due_is_date_only, created_at, source, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "pre-bills-task", "personal", "Existing task", "ONE_TIME", "MEDIUM", "OPEN", 0,
    "2026-09-15T00:00:00Z", "manual", "2026-09-15T00:00:00Z",
  );

  sqlite.exec(migration("0009_bills_and_obligations.sql"));
  return sqlite;
}

test("0009 adds STRICT bill tables without altering existing task/workspace data", () => {
  const sqlite = setupDatabase();
  const tables = sqlite.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
  assert.equal(tables.find((row) => row.name === "bills")?.strict, 1);
  assert.equal(tables.find((row) => row.name === "bill_occurrences")?.strict, 1);
  assert.equal((sqlite.prepare("SELECT title FROM tasks WHERE task_id = ?").get("pre-bills-task") as { title: string }).title, "Existing task");
  assert.equal((sqlite.prepare("SELECT name FROM workspaces WHERE workspace_id = ?").get("personal") as { name: string }).name, "Personal");
  sqlite.close();
});

test("bill schema accepts future physical workspaces and enforces bill invariants", () => {
  const sqlite = setupDatabase();
  sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)").run(
    "user:christa", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  );
  sqlite.prepare(`INSERT INTO workspaces (workspace_id, name, workspace_type, theme_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    "personal:christa", "Christa Personal", "PERSONAL", "personal-tech-blue",
    "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  );

  const insertBill = sqlite.prepare(`INSERT INTO bills (
    bill_id, primary_workspace_id, name, amount_mode, default_amount_minor, currency, autopay,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode, status,
    created_by_user_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const addBill = (overrides: Partial<{
    id: string; workspace: string; amountMode: string; amount: number | null; currency: string;
    startDate: string; unit: string; interval: number; dayMode: string | null;
  }> = {}) => insertBill.run(
    overrides.id ?? "bill-1",
    overrides.workspace ?? "personal:christa",
    "Electric bill",
    overrides.amountMode ?? "VARIABLE",
    overrides.amount === undefined ? null : overrides.amount,
    overrides.currency ?? "USD",
    0,
    overrides.startDate ?? "2026-09-30",
    overrides.unit ?? "MONTH",
    overrides.interval ?? 1,
    overrides.dayMode === undefined ? "LAST_DAY" : overrides.dayMode,
    "ACTIVE",
    "user:christa",
    "2026-09-15T00:00:00Z",
    "2026-09-15T00:00:00Z",
  );

  assert.doesNotThrow(() => addBill());
  assert.equal((sqlite.prepare("SELECT primary_workspace_id FROM bills WHERE bill_id='bill-1'").get() as { primary_workspace_id: string }).primary_workspace_id, "personal:christa");

  assert.throws(() => addBill({ id: "bad-workspace", workspace: "missing" }));
  assert.throws(() => addBill({ id: "bad-fixed", amountMode: "FIXED", amount: null }));
  assert.throws(() => addBill({ id: "bad-money", amount: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => addBill({ id: "bad-currency", currency: "US1" }));
  assert.throws(() => addBill({ id: "bad-none", unit: "NONE", interval: 2, dayMode: null }));
  assert.throws(() => addBill({ id: "bad-week", unit: "WEEK", dayMode: "ANCHOR_DATE" }));
  assert.throws(() => addBill({ id: "bad-month", unit: "MONTH", dayMode: null }));
  assert.throws(() => sqlite.prepare("UPDATE bills SET primary_workspace_id='personal' WHERE bill_id='bill-1'").run(), /immutable/i);

  sqlite.close();
});

test("bill occurrences enforce idempotency, resolution state, history preservation, and explicit delete cascade", () => {
  const sqlite = setupDatabase();
  sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)").run(
    "user:resolver", "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  );
  sqlite.prepare(`INSERT INTO bills (
    bill_id, primary_workspace_id, name, amount_mode, default_amount_minor, currency, autopay,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode, status,
    created_by_user_id, created_at, updated_at
  ) VALUES (?, 'personal', ?, 'FIXED', ?, 'USD', 1, ?, 'MONTH', 1, 'ANCHOR_DATE', 'ACTIVE', ?, ?, ?)`).run(
    "bill-history", "Mortgage", 250_000, "2026-09-01", "user:resolver",
    "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  );

  const insertOccurrence = sqlite.prepare(`INSERT INTO bill_occurrences (
    occurrence_id, bill_id, due_date, expected_amount_minor, currency, status,
    paid_amount_minor, paid_on, resolved_by_user_id, resolved_at, resolution_note,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  insertOccurrence.run(
    "occ-open", "bill-history", "2026-10-01", 250_000, "USD", "OPEN",
    null, null, null, null, null, "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  );
  assert.throws(() => insertOccurrence.run(
    "occ-duplicate-date", "bill-history", "2026-10-01", 250_000, "USD", "OPEN",
    null, null, null, null, null, "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  ));
  assert.throws(() => insertOccurrence.run(
    "occ-bad-open", "bill-history", "2026-11-01", 250_000, "USD", "OPEN",
    null, null, "user:resolver", "2026-09-15T01:00:00Z", null,
    "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  ));
  assert.throws(() => insertOccurrence.run(
    "occ-bad-paid", "bill-history", "2026-12-01", 250_000, "USD", "PAID",
    250_000, "2026-12-01", "user:resolver", null, null,
    "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  ));
  assert.throws(() => insertOccurrence.run(
    "occ-bad-skip", "bill-history", "2027-01-01", 250_000, "USD", "SKIPPED",
    null, null, "user:resolver", null, "Not owed",
    "2026-09-15T00:00:00Z", "2026-09-15T00:00:00Z",
  ));

  insertOccurrence.run(
    "occ-paid", "bill-history", "2026-09-01", 250_000, "USD", "PAID",
    250_000, "2026-09-01", "user:resolver", "2026-09-01T13:00:00Z", "Paid online",
    "2026-09-01T13:00:00Z", "2026-09-01T13:00:00Z",
  );

  sqlite.prepare("UPDATE bills SET status='ARCHIVED' WHERE bill_id='bill-history'").run();
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM bill_occurrences WHERE bill_id='bill-history'").get() as { count: number }).count, 2);

  sqlite.prepare("DELETE FROM users WHERE user_id='user:resolver'").run();
  const paid = sqlite.prepare("SELECT status, paid_on, resolved_by_user_id, resolved_at FROM bill_occurrences WHERE occurrence_id='occ-paid'").get() as {
    status: string; paid_on: string; resolved_by_user_id: string | null; resolved_at: string;
  };
  assert.equal(paid.status, "PAID");
  assert.equal(paid.paid_on, "2026-09-01");
  assert.equal(paid.resolved_by_user_id, null);
  assert.equal(paid.resolved_at, "2026-09-01T13:00:00Z");

  sqlite.prepare("DELETE FROM bills WHERE bill_id='bill-history'").run();
  assert.equal((sqlite.prepare("SELECT count(*) AS count FROM bill_occurrences WHERE bill_id='bill-history'").get() as { count: number }).count, 0);
  sqlite.close();
});

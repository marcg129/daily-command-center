import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const PRE_1G_H_MIGRATIONS = [
  "0001_workspaces.sql",
  "0002_tasks.sql",
  "0003_collector_snapshots.sql",
  "0004_secrets_and_workspace_domains.sql",
  "0005_task_capture_metadata.sql",
  "0006_principal_workspace_grants.sql",
  "0007_user_workspace_ownership.sql",
  "0008_workspace_instances.sql",
  "0009_bills_and_obligations.sql",
  "0010_income_and_cashflow.sql",
  "0011_todoist_ingress_control.sql",
] as const;

function migration(name: string): string {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

function setupDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of PRE_1G_H_MIGRATIONS) sqlite.exec(migration(name));
  sqlite.exec(migration("0012_daily_intake_events.sql"));
  return sqlite;
}

function addUser(sqlite: DatabaseSync, userId: string) {
  sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', ?, ?)")
    .run(userId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
  sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, 'personal', 'personal', 'OWNER', ?, ?)`)
    .run(userId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
  sqlite.prepare(`INSERT INTO workspace_memberships
    (user_id, workspace_id, workspace_key, role, created_at, updated_at)
    VALUES (?, 'indelitech', 'indelitech', 'OWNER', ?, ?)`)
    .run(userId, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
}

function insertIntake(sqlite: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}) {
  const row: Record<string, unknown> = {
    intake_id: "intake-1",
    user_id: "user:marc",
    workspace_id: "personal",
    workspace_key: "personal",
    intake_type: "TASK",
    status: "PENDING",
    source_type: "gmail",
    source_key: "personal_gmail",
    source_message_id: "msg-1",
    source_thread_id: "thread-1",
    source_event_id: null,
    source_series_id: null,
    proposal_ordinal: 1,
    source_timestamp: "2026-09-17T12:10:00Z",
    source_sender: "sender@example.com",
    source_subject: "Please reply",
    source_url: "https://mail.google.com/mail/u/0/#inbox/msg-1",
    source_summary: "A reply was requested.",
    classification_reason: "The sender explicitly requested a response.",
    title: "Reply to sender",
    due_date: null,
    follow_up_at: null,
    priority: null,
    amount_minor: null,
    currency: null,
    target_payload_json: "{}",
    semantic_key: "personal_gmail:message:msg-1:1",
    scan_run_id: "scan-1",
    defer_until: null,
    approved_target_kind: null,
    approved_target_id: null,
    edited_at: null,
    created_at: "2026-09-17T12:10:00Z",
    updated_at: "2026-09-17T12:10:00Z",
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  sqlite.prepare(`INSERT INTO intake_items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...values);
}

test("0012 creates STRICT intake, calendar projection, sync, override, and freshness tables", () => {
  const sqlite = setupDatabase();
  const tables = sqlite.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
  for (const name of [
    "intake_items",
    "projected_calendar_events",
    "calendar_workspace_overrides",
    "calendar_sync_runs",
    "calendar_sync_batches",
    "daily_intake_source_status",
  ]) {
    assert.equal(tables.find((row) => row.name === name)?.strict, 1, `${name} should be STRICT`);
  }
  sqlite.close();
});

test("intake semantic identity is unique per user and terminal/schema invariants fail closed", () => {
  const sqlite = setupDatabase();
  addUser(sqlite, "user:marc");
  addUser(sqlite, "user:other");

  insertIntake(sqlite);
  assert.throws(() => insertIntake(sqlite, { intake_id: "intake-duplicate" }));
  assert.doesNotThrow(() => insertIntake(sqlite, {
    intake_id: "intake-other-user",
    user_id: "user:other",
  }));

  assert.throws(() => insertIntake(sqlite, {
    intake_id: "bad-type",
    semantic_key: "bad-type",
    intake_type: "REMINDER",
  }));
  assert.throws(() => insertIntake(sqlite, {
    intake_id: "bad-status",
    semantic_key: "bad-status",
    status: "DONE",
  }));
  assert.throws(() => insertIntake(sqlite, {
    intake_id: "bad-source-type",
    semantic_key: "bad-source-type",
    source_type: "slack",
  }));
  assert.throws(() => insertIntake(sqlite, {
    intake_id: "bad-source-key",
    semantic_key: "bad-source-key",
    source_key: "harvest_fire_gmail",
  }));
  assert.throws(() => insertIntake(sqlite, {
    intake_id: "bad-workspace-key",
    semantic_key: "bad-workspace-key",
    workspace_key: "personal:marc",
  }));

  sqlite.close();
});

test("calendar projection identity is user/source scoped and override scope is constrained", () => {
  const sqlite = setupDatabase();
  addUser(sqlite, "user:marc");
  addUser(sqlite, "user:other");

  const insertEvent = sqlite.prepare(`INSERT INTO projected_calendar_events (
    projection_id, user_id, source_key, google_event_id, series_id, occurrence_id,
    title, starts_at, ends_at, all_day, location, source_url, automatic_workspace_key,
    projection_status, last_seen_scan_run_id, removed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const eventValues = (projectionId: string, userId: string, sourceKey: string) => [
    projectionId, userId, sourceKey, "evt-shared", "series-1", "occ-1",
    "Dentist", "2026-09-25T14:00:00-04:00", "2026-09-25T15:00:00-04:00", 0,
    "Office", "https://calendar.google.com/calendar/event?eid=evt-shared", "personal",
    "ACTIVE", "scan-1", null, "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z",
  ] as const;

  insertEvent.run(...eventValues("projection-1", "user:marc", "primary_calendar"));
  assert.throws(() => insertEvent.run(...eventValues("projection-2", "user:marc", "primary_calendar")));
  assert.doesNotThrow(() => insertEvent.run(...eventValues("projection-family", "user:marc", "family_calendar")));
  assert.doesNotThrow(() => insertEvent.run(...eventValues("projection-other-user", "user:other", "primary_calendar")));

  const insertOverride = sqlite.prepare(`INSERT INTO calendar_workspace_overrides (
    override_id, user_id, source_key, scope, target_id, workspace_key, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  assert.doesNotThrow(() => insertOverride.run(
    "override-series", "user:marc", "primary_calendar", "SERIES", "series-1", "indelitech",
    "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z",
  ));
  assert.throws(() => insertOverride.run(
    "override-bad", "user:marc", "primary_calendar", "EVENT", "evt-shared", "personal",
    "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z",
  ));

  sqlite.close();
});

test("calendar sync batches are unique per user, source, run, and batch index", () => {
  const sqlite = setupDatabase();
  addUser(sqlite, "user:marc");

  sqlite.prepare(`INSERT INTO calendar_sync_runs (
    user_id, source_key, scan_run_id, window_start, window_end, expected_batch_count,
    status, started_at, updated_at, completed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      "user:marc", "primary_calendar", "scan-1", "2026-09-17T00:00:00-04:00", "2026-11-01T00:00:00-04:00",
      2, "OPEN", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z", null,
    );

  const insertBatch = sqlite.prepare(`INSERT INTO calendar_sync_batches (
    user_id, source_key, scan_run_id, batch_index, received_at
  ) VALUES (?, ?, ?, ?, ?)`);
  insertBatch.run("user:marc", "primary_calendar", "scan-1", 1, "2026-09-17T12:01:00Z");
  assert.throws(() => insertBatch.run("user:marc", "primary_calendar", "scan-1", 1, "2026-09-17T12:02:00Z"));
  assert.doesNotThrow(() => insertBatch.run("user:marc", "primary_calendar", "scan-1", 2, "2026-09-17T12:02:00Z"));

  sqlite.close();
});

test("bills can link idempotently to an Intake origin", () => {
  const sqlite = setupDatabase();
  addUser(sqlite, "user:marc");
  insertIntake(sqlite, { intake_type: "BILL", title: "Pay renewal" });

  const insertBill = sqlite.prepare(`INSERT INTO bills (
    bill_id, primary_workspace_id, name, amount_mode, default_amount_minor, currency, autopay,
    schedule_start_date, recurrence_unit, recurrence_interval, recurrence_day_mode, status,
    created_by_user_id, created_at, updated_at, source_intake_id
  ) VALUES (?, 'personal', ?, 'FIXED', 14900, 'USD', 0, '2026-09-30', 'NONE', 1, NULL, 'ACTIVE', ?, ?, ?, ?)`);

  insertBill.run(
    "bill-intake-1", "Renewal", "user:marc", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z", "intake-1",
  );
  assert.throws(() => insertBill.run(
    "bill-intake-2", "Renewal duplicate", "user:marc", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z", "intake-1",
  ));
  assert.doesNotThrow(() => insertBill.run(
    "bill-manual", "Manual bill", "user:marc", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z", null,
  ));

  sqlite.close();
});

test("1G-H schema intentionally has no full Gmail body, attachment, calendar description, or attendee columns", () => {
  const sqlite = setupDatabase();
  const columns = (table: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
  const intakeColumns = columns("intake_items");
  const eventColumns = columns("projected_calendar_events");

  for (const forbidden of ["body", "message_body", "html_body", "attachments", "attachment_json"]) {
    assert.equal(intakeColumns.includes(forbidden), false, `intake_items must not contain ${forbidden}`);
  }
  for (const forbidden of ["description", "event_description", "attendees", "attendee_json"]) {
    assert.equal(eventColumns.includes(forbidden), false, `projected_calendar_events must not contain ${forbidden}`);
  }
  sqlite.close();
});

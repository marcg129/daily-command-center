import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { CalendarSyncInput } from "@/lib/runtime/calendar-projections";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { D1CalendarProjectionRepository } from "@/lib/server/d1-calendar-projection-repository";

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
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = await Promise.all(statements.map((statement) => statement.run<T>()));
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now() { return new Date(this.value); }
}

class SequenceIds implements IdGenerator {
  private next = 0;
  generate() { return `event-projection-${++this.next}`; }
}

function addUser(database: TestD1, userId = "user:marc") {
  database.sqlite.prepare("INSERT INTO users (user_id, status, created_at, updated_at) VALUES (?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    .run(userId);
}

function event(eventId: string, title: string, start: string, automaticWorkspaceId: "personal" | "indelitech" = "personal") {
  return {
    eventId,
    seriesId: "series-client",
    occurrenceId: start,
    title,
    start,
    end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    allDay: false,
    sourceUrl: `https://calendar.google.com/calendar/event?eid=${eventId}`,
    automaticWorkspaceId,
    cancelled: false,
  } as const;
}

function sync(overrides: Partial<CalendarSyncInput> = {}): CalendarSyncInput {
  return {
    scanRunId: "scan-1",
    sourceKey: "primary_calendar",
    windowStart: "2026-09-17T00:00:00-04:00",
    windowEnd: "2026-11-01T00:00:00-04:00",
    batchIndex: 1,
    batchCount: 1,
    events: [event("event-a", "Client call", "2026-09-20T14:00:00-04:00")],
    ...overrides,
  };
}

function setup() {
  const database = new TestD1();
  addUser(database);
  const repo = new D1CalendarProjectionRepository(
    database,
    new FixedClock(new Date("2026-09-17T16:00:00Z")),
    new SequenceIds(),
  );
  return { database, repo };
}

test("calendar batch replay and out-of-order delivery are idempotent while reconciliation waits for every batch", async () => {
  const { database, repo } = setup();

  await repo.ingestBatch("user:marc", sync({
    scanRunId: "baseline",
    events: [
      event("event-a", "Client call", "2026-09-20T14:00:00-04:00"),
      event("event-old", "Old appointment", "2026-09-21T14:00:00-04:00"),
    ],
  }));

  const batch2 = sync({
    scanRunId: "scan-partial",
    batchIndex: 2,
    batchCount: 2,
    events: [event("event-b", "Interview", "2026-09-22T15:00:00-04:00")],
  });
  const partial = await repo.ingestBatch("user:marc", batch2);
  assert.equal(partial.complete, false);
  assert.equal(database.sqlite.prepare("SELECT removed_at FROM projected_calendar_events WHERE google_event_id='event-old'").get()?.removed_at, null);

  const replay = await repo.ingestBatch("user:marc", batch2);
  assert.equal(replay.complete, false);
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM calendar_sync_batches WHERE scan_run_id='scan-partial'").get()?.count, 1);

  const completed = await repo.ingestBatch("user:marc", sync({
    scanRunId: "scan-partial",
    batchIndex: 1,
    batchCount: 2,
    events: [event("event-a", "Client call updated", "2026-09-20T14:30:00-04:00")],
  }));
  assert.equal(completed.complete, true);
  assert.notEqual(database.sqlite.prepare("SELECT removed_at FROM projected_calendar_events WHERE google_event_id='event-old'").get()?.removed_at, null);
  assert.equal(database.sqlite.prepare("SELECT title FROM projected_calendar_events WHERE google_event_id='event-a'").get()?.title, "Client call updated");
  database.sqlite.close();
});

test("same Google event ID remains distinct across source calendars and reads are bounded to 45 days", async () => {
  const { database, repo } = setup();
  await repo.ingestBatch("user:marc", sync({
    sourceKey: "primary_calendar",
    events: [event("shared-event", "Primary version", "2026-09-20T14:00:00-04:00")],
  }));
  await repo.ingestBatch("user:marc", sync({
    scanRunId: "family-scan",
    sourceKey: "family_calendar",
    events: [event("shared-event", "Family version", "2026-09-21T14:00:00-04:00")],
  }));

  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM projected_calendar_events WHERE google_event_id='shared-event'").get()?.count, 2);
  await assert.rejects(
    repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-02" }),
    /45|window|range/i,
  );
  const rows = await repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-01" });
  assert.deepEqual(rows.map((row) => row.title).sort(), ["Family version", "Primary version"]);
  database.sqlite.close();
});

test("workspace resolution precedence is occurrence override, series override, automatic classification, then source default", async () => {
  const { database, repo } = setup();
  const noAutomatic = {
    ...event("event-default", "Family dinner", "2026-09-20T18:00:00-04:00"),
    automaticWorkspaceId: undefined,
    seriesId: undefined,
    occurrenceId: undefined,
  };
  await repo.ingestBatch("user:marc", sync({ sourceKey: "family_calendar", events: [noAutomatic] }));
  assert.equal((await repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-01" }))[0]?.resolvedWorkspaceId, "personal");

  await repo.ingestBatch("user:marc", sync({
    scanRunId: "auto",
    events: [event("event-auto", "Indelitech call", "2026-09-21T14:00:00-04:00", "indelitech")],
  }));
  assert.equal((await repo.list("user:marc", "indelitech", { fromDate: "2026-09-17", throughDate: "2026-11-01" }))[0]?.googleEventId, "event-auto");

  await repo.setWorkspaceOverride("user:marc", {
    sourceKey: "primary_calendar",
    scope: "SERIES",
    identityKey: "series-client",
    workspaceId: "personal",
  });
  assert.equal((await repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-01" })).some((row) => row.googleEventId === "event-auto"), true);

  await repo.setWorkspaceOverride("user:marc", {
    sourceKey: "primary_calendar",
    scope: "OCCURRENCE",
    identityKey: "2026-09-21T14:00:00-04:00",
    workspaceId: "indelitech",
  });
  assert.equal((await repo.list("user:marc", "indelitech", { fromDate: "2026-09-17", throughDate: "2026-11-01" })).some((row) => row.googleEventId === "event-auto"), true);
  database.sqlite.close();
});

test("series overrides affect later synced occurrences while occurrence-only overrides remain narrow", async () => {
  const { database, repo } = setup();
  await repo.ingestBatch("user:marc", sync({
    events: [event("event-1", "Weekly client call", "2026-09-20T14:00:00-04:00", "indelitech")],
  }));
  await repo.setWorkspaceOverride("user:marc", {
    sourceKey: "primary_calendar",
    scope: "SERIES",
    identityKey: "series-client",
    workspaceId: "personal",
  });
  await repo.setWorkspaceOverride("user:marc", {
    sourceKey: "primary_calendar",
    scope: "OCCURRENCE",
    identityKey: "2026-09-20T14:00:00-04:00",
    workspaceId: "indelitech",
  });

  await repo.ingestBatch("user:marc", sync({
    scanRunId: "next-week",
    events: [event("event-2", "Weekly client call", "2026-09-27T14:00:00-04:00", "indelitech")],
  }));

  const personal = await repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-01" });
  const indelitech = await repo.list("user:marc", "indelitech", { fromDate: "2026-09-17", throughDate: "2026-11-01" });
  assert.equal(personal.some((row) => row.googleEventId === "event-2"), true);
  assert.equal(indelitech.some((row) => row.googleEventId === "event-1"), true);
  assert.equal(indelitech.some((row) => row.googleEventId === "event-2"), false);
  database.sqlite.close();
});

test("calendar reads expose compact related Intake and approved target metadata", async () => {
  const { database, repo } = setup();
  await repo.ingestBatch("user:marc", sync());
  database.sqlite.prepare(`INSERT INTO intake_items (
    intake_id, user_id, workspace_id, workspace_key, intake_type, status, source_type, source_key,
    source_message_id, source_thread_id, source_event_id, source_series_id, proposal_ordinal, source_timestamp,
    source_sender, source_subject, source_url, source_summary, classification_reason, title, due_date, follow_up_at,
    priority, amount_minor, currency, target_payload_json, semantic_key, scan_run_id, user_edited_at, defer_until,
    approved_target_kind, approved_target_id, created_at, updated_at
  ) VALUES (
    'intake-event-a', 'user:marc', 'personal', 'personal', 'TASK', 'APPROVED', 'calendar', 'primary_calendar',
    NULL, NULL, 'event-a', 'series-client', 1, '2026-09-20T14:00:00-04:00',
    NULL, NULL, NULL, 'Prepare for the meeting.', 'Meeting needs preparation.', 'Prepare for client call', NULL, NULL,
    NULL, NULL, NULL, '{}', 'primary_calendar:event:event-a:1', 'scan-1', NULL, NULL,
    'TASK', 'task-123', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )`).run();

  const listed = await repo.list("user:marc", "personal", { fromDate: "2026-09-17", throughDate: "2026-11-01" });
  assert.deepEqual(listed[0]?.relatedIntake, [{
    intakeId: "intake-event-a",
    intakeType: "TASK",
    status: "APPROVED",
    approvedTargetKind: "TASK",
    approvedTargetId: "task-123",
  }]);
  database.sqlite.close();
});
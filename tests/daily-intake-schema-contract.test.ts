import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
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
  "0012_daily_intake_events.sql",
] as const;

function setupDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of MIGRATIONS) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  return sqlite;
}

function columns(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function tableSql(sqlite: DatabaseSync, table: string): string {
  const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

test("intake_items exposes the approved stable names and validates target JSON", () => {
  const sqlite = setupDatabase();
  const names = columns(sqlite, "intake_items");
  assert.equal(names.includes("user_edited_at"), true);
  assert.equal(names.includes("edited_at"), false);
  assert.match(tableSql(sqlite, "intake_items"), /json_valid\s*\(\s*target_payload_json\s*\)/i);
  sqlite.close();
});

test("calendar projection, override, and sync tables use the approved Task 1 contract", () => {
  const sqlite = setupDatabase();

  assert.deepEqual(columns(sqlite, "projected_calendar_events"), [
    "event_projection_id",
    "user_id",
    "source_key",
    "google_event_id",
    "series_id",
    "occurrence_key",
    "title",
    "start_at",
    "end_at",
    "all_day",
    "location",
    "source_url",
    "automatic_workspace_key",
    "last_seen_scan_run_id",
    "removed_at",
    "created_at",
    "updated_at",
  ]);

  assert.deepEqual(columns(sqlite, "calendar_workspace_overrides"), [
    "user_id",
    "source_key",
    "scope",
    "identity_key",
    "workspace_key",
    "created_at",
    "updated_at",
  ]);

  assert.deepEqual(columns(sqlite, "calendar_sync_runs"), [
    "user_id",
    "source_key",
    "scan_run_id",
    "window_start",
    "window_end",
    "batch_count",
    "state",
    "started_at",
    "completed_at",
  ]);

  sqlite.close();
});

test("calendar automatic workspace is always explicit and bill source links stay idempotent", () => {
  const sqlite = setupDatabase();
  const eventInfo = sqlite.prepare("PRAGMA table_info(projected_calendar_events)").all() as Array<{ name: string; notnull: number }>;
  assert.equal(eventInfo.find((column) => column.name === "automatic_workspace_key")?.notnull, 1);

  const billNames = columns(sqlite, "bills");
  assert.equal(billNames.includes("source_intake_id"), true);
  const index = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='bills_source_intake_uidx'").get() as { sql?: string } | undefined;
  assert.match(index?.sql ?? "", /UNIQUE INDEX[\s\S]*source_intake_id[\s\S]*WHERE source_intake_id IS NOT NULL/i);
  sqlite.close();
});

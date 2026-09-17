import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { InMemorySessionProvider, principalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedEventsHandler } from "@/lib/server/authorized-hosted-events-handler";

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
      "0011_todoist_ingress_control.sql", "0012_daily_intake_events.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
}

const clock: Clock = { now: () => new Date("2026-09-17T18:00:00.000Z") };
let id = 0;
const ids: IdGenerator = { generate: () => `events-test-${++id}` };

function seed(database: TestD1) {
  const now = "2026-09-17T18:00:00Z";
  database.sqlite.prepare("INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:marc','ACTIVE',?,?)").run(now, now);
  database.sqlite.prepare("INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:other','ACTIVE',?,?)").run(now, now);
  database.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc','personal','personal','OWNER')").run();
  database.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc','indelitech','indelitech','OWNER')").run();
  database.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:other','personal','personal','OWNER')").run();

  const insertEvent = database.sqlite.prepare(`INSERT INTO projected_calendar_events (
    event_projection_id,user_id,source_key,google_event_id,series_id,occurrence_key,title,start_at,end_at,all_day,
    location,source_url,automatic_workspace_key,last_seen_scan_run_id,removed_at,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`);
  insertEvent.run("projection-personal","user:marc","primary_calendar","event-personal","series-personal","occ-personal","Dentist","2026-09-20T14:00:00-04:00","2026-09-20T15:00:00-04:00",0,"Office","https://calendar.google.com/calendar/event?eid=event-personal","personal","scan-1",now,now);
  insertEvent.run("projection-work","user:marc","primary_calendar","event-work","series-work","occ-work","Indelitech client call","2026-09-21T14:00:00-04:00","2026-09-21T15:00:00-04:00",0,"Meet","https://calendar.google.com/calendar/event?eid=event-work","indelitech","scan-1",now,now);
  insertEvent.run("projection-other","user:other","primary_calendar","event-other","series-other","occ-other","Other user private event","2026-09-22T14:00:00-04:00","2026-09-22T15:00:00-04:00",0,NULL,NULL,"personal","scan-1",now,now);

  database.sqlite.prepare(`INSERT INTO intake_items (
    intake_id,user_id,workspace_id,workspace_key,intake_type,status,source_type,source_key,source_event_id,source_series_id,
    proposal_ordinal,source_timestamp,source_summary,classification_reason,title,target_payload_json,semantic_key,scan_run_id,
    approved_target_kind,approved_target_id,created_at,updated_at
  ) VALUES ('intake-work','user:marc','indelitech','indelitech','TASK','APPROVED','calendar','primary_calendar','event-work','series-work',
    1,'2026-09-21T14:00:00-04:00','Prepare','Meeting preparation','Prepare for client call','{}','primary_calendar:event:event-work:1','scan-1',
    'TASK','task-work',?,?)`).run(now, now);
}

function handler(database: TestD1, denyIndelitech = false) {
  const sessions = new InMemorySessionProvider(new Map([["marc-token", {
    sessionId: "session:marc",
    principal: { principalId: principalId("principal:marc") },
    expiresAt: "2026-09-18T18:00:00Z",
  }]]));
  const resolver: WorkspaceResolver = {
    async resolve(principal, workspaceId) {
      if (principal?.principalId !== principalId("principal:marc")) throw new Error("Workspace access denied.");
      if (workspaceId === "personal") return { userId: "user:marc", workspaceId: "personal", workspaceKey: "personal" };
      if (workspaceId === "indelitech" && !denyIndelitech) return { userId: "user:marc", workspaceId: "indelitech", workspaceKey: "indelitech" };
      throw new Error("Workspace access denied.");
    },
  };
  return createAuthorizedHostedEventsHandler(sessions, resolver, database, clock, ids);
}

function request(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: { "cf-access-jwt-assertion": "marc-token", ...(init?.headers ?? {}) },
  });
}

test("hosted Events requires Access, exact workspace scope, bounded dates, related Intake, and no-store", async () => {
  const database = new TestD1();
  seed(database);
  const api = handler(database);

  const unauthenticated = await api.GET(new Request("https://command.coreyg.dev/api/hosted/events?workspaceId=personal&fromDate=2026-09-17&throughDate=2026-10-31"));
  assert.equal(unauthenticated.status, 403);

  const tooWide = await api.GET(request("https://command.coreyg.dev/api/hosted/events?workspaceId=personal&fromDate=2026-09-17&throughDate=2026-11-02"));
  assert.equal(tooWide.status, 400);

  const personal = await api.GET(request("https://command.coreyg.dev/api/hosted/events?workspaceId=personal&fromDate=2026-09-17&throughDate=2026-10-31"));
  assert.equal(personal.status, 200);
  assert.equal(personal.headers.get("cache-control"), "no-store");
  const personalBody = await personal.json() as { events: Array<{ googleEventId: string }> };
  assert.deepEqual(personalBody.events.map((event) => event.googleEventId), ["event-personal"]);

  const work = await api.GET(request("https://command.coreyg.dev/api/hosted/events?workspaceId=indelitech&fromDate=2026-09-17&throughDate=2026-10-31"));
  const workBody = await work.json() as { events: Array<{ googleEventId: string; relatedIntake: unknown[] }> };
  assert.equal(work.status, 200);
  assert.equal(workBody.events[0]?.googleEventId, "event-work");
  assert.deepEqual(workBody.events[0]?.relatedIntake, [{
    intakeId: "intake-work",
    intakeType: "TASK",
    status: "APPROVED",
    approvedTargetKind: "TASK",
    approvedTargetId: "task-work",
  }]);
  assert.equal(JSON.stringify(workBody).includes("event-other"), false);
  database.sqlite.close();
});

test("workspace override mutations prove event ownership, target authorization, and series/occurrence identity", async () => {
  const database = new TestD1();
  seed(database);
  const api = handler(database);

  const series = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "primary_calendar", eventId: "event-work", scope: "SERIES", workspaceId: "personal" }),
  }));
  assert.equal(series.status, 200);
  assert.equal(database.sqlite.prepare("SELECT workspace_key FROM calendar_workspace_overrides WHERE user_id='user:marc' AND scope='SERIES' AND identity_key='series-work'").get()?.workspace_key, "personal");

  const occurrence = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "primary_calendar", eventId: "event-work", scope: "OCCURRENCE", workspaceId: "indelitech" }),
  }));
  assert.equal(occurrence.status, 200);
  assert.equal(database.sqlite.prepare("SELECT workspace_key FROM calendar_workspace_overrides WHERE user_id='user:marc' AND scope='OCCURRENCE' AND identity_key='occ-work'").get()?.workspace_key, "indelitech");

  const clear = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "primary_calendar", eventId: "event-work", scope: "SERIES", workspaceId: "personal", clear: true }),
  }));
  assert.equal(clear.status, 200);
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM calendar_workspace_overrides WHERE user_id='user:marc' AND scope='SERIES' AND identity_key='series-work'").get()?.count, 0);

  const foreign = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "primary_calendar", eventId: "event-other", scope: "SERIES", workspaceId: "personal" }),
  }));
  assert.equal(foreign.status, 404);
  database.sqlite.close();
});

test("Events override rejects invalid sources and target workspaces without authorization", async () => {
  const database = new TestD1();
  seed(database);
  const api = handler(database, true);

  const badSource = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "work_calendar", eventId: "event-personal", scope: "SERIES", workspaceId: "personal" }),
  }));
  assert.equal(badSource.status, 400);

  const unauthorizedTarget = await api.PATCH(request("https://command.coreyg.dev/api/hosted/events", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKey: "primary_calendar", eventId: "event-personal", scope: "SERIES", workspaceId: "indelitech" }),
  }));
  assert.equal(unauthorizedTarget.status, 403);
  assert.equal(database.sqlite.prepare("SELECT count(*) AS count FROM calendar_workspace_overrides").get()?.count, 0);
  database.sqlite.close();
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import type { Clock, IdGenerator } from "@/lib/runtime/primitives";
import { InMemorySessionProvider, principalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedIntakeHandler } from "@/lib/server/authorized-hosted-intake-handler";

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

    this.sqlite.prepare("INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:marc','ACTIVE',?,?)")
      .run("2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
    this.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc','personal','personal','OWNER')").run();
    this.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:marc','indelitech','indelitech','OWNER')").run();

    this.sqlite.prepare("INSERT INTO workspaces (workspace_id,name,workspace_type,theme_key,created_at,updated_at) VALUES ('personal:other','Other','PERSONAL','personal-tech-blue',?,?)")
      .run("2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
    this.sqlite.prepare("INSERT INTO users (user_id,status,created_at,updated_at) VALUES ('user:other','ACTIVE',?,?)")
      .run("2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z");
    this.sqlite.prepare("INSERT INTO workspace_memberships (user_id,workspace_id,workspace_key,role) VALUES ('user:other','personal:other','personal','OWNER')").run();
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

const clock: Clock = { now: () => new Date("2026-09-17T17:30:00.000Z") };
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `generated-${++n}` };
}

function insertIntake(
  d1: TestD1,
  id: string,
  workspace: "personal" | "indelitech",
  type: "TASK" | "FOLLOW_UP" | "BILL" | "AWARENESS" = "TASK",
  userId = "user:marc",
) {
  const physical = userId === "user:other" ? "personal:other" : workspace;
  const sourceKey = workspace === "indelitech" ? "indelitech_gmail" : "personal_gmail";
  d1.sqlite.prepare(`INSERT INTO intake_items (
    intake_id,user_id,workspace_id,workspace_key,intake_type,status,source_type,source_key,
    source_message_id,proposal_ordinal,source_timestamp,source_summary,classification_reason,title,
    due_date,follow_up_at,priority,amount_minor,currency,target_payload_json,semantic_key,scan_run_id,
    created_at,updated_at
  ) VALUES (?,?,?,?,?,'PENDING','gmail',?,?,1,?,?,?,?,?,?,?,?,?,'{}',?,?,?,?)`)
    .run(
      id, userId, physical, workspace, type, sourceKey, `msg-${id}`, "2026-09-17T16:00:00Z",
      "Source evidence", "Source supports this proposal", `Proposal ${id}`,
      type === "BILL" ? "2026-09-30" : null,
      type === "FOLLOW_UP" ? "2026-09-20T18:00:00Z" : null,
      null,
      type === "BILL" ? 12500 : null,
      type === "BILL" ? "USD" : null,
      `${sourceKey}:message:msg-${id}:1`, "scan-1", "2026-09-17T16:00:00Z", "2026-09-17T16:00:00Z",
    );
}

function harness() {
  const d1 = new TestD1();
  const sessions = new InMemorySessionProvider(new Map([
    ["marc-token", {
      sessionId: "session:marc",
      principal: { principalId: principalId("principal:marc") },
      expiresAt: "2026-09-18T17:30:00Z",
    }],
    ["other-token", {
      sessionId: "session:other",
      principal: { principalId: principalId("principal:other") },
      expiresAt: "2026-09-18T17:30:00Z",
    }],
  ]));
  const resolver: WorkspaceResolver = {
    async resolve(principal, workspaceId) {
      if (principal?.principalId === principalId("principal:marc")) {
        if (workspaceId === "personal") return { userId: "user:marc", workspaceId: "personal", workspaceKey: "personal" };
        if (workspaceId === "indelitech") return { userId: "user:marc", workspaceId: "indelitech", workspaceKey: "indelitech" };
      }
      if (principal?.principalId === principalId("principal:other") && workspaceId === "personal") {
        return { userId: "user:other", workspaceId: "personal:other", workspaceKey: "personal" };
      }
      throw new Error("Workspace access denied.");
    },
  };
  return { d1, handler: createAuthorizedHostedIntakeHandler(sessions, resolver, d1, clock, ids()) };
}

function req(path: string, token = "marc-token", init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("cf-access-jwt-assertion", token);
  return new Request(`https://command.coreyg.dev${path}`, { ...init, headers });
}

function jsonReq(path: string, body: unknown, method: "POST" | "PATCH" = "PATCH", token = "marc-token") {
  return req(path, token, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("hosted Intake requires Access and exact workspace authorization, filters reads, and never caches", async () => {
  const { d1, handler } = harness();
  insertIntake(d1, "personal-task", "personal", "TASK");
  insertIntake(d1, "business-bill", "indelitech", "BILL");
  insertIntake(d1, "other-task", "personal", "TASK", "user:other");

  const unauthenticated = await handler.intake.GET(req("/api/hosted/intake?workspaceId=personal", ""));
  assert.equal(unauthenticated.status, 403);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

  const personal = await handler.intake.GET(req("/api/hosted/intake?workspaceId=personal&status=PENDING&type=TASK"));
  assert.equal(personal.status, 200);
  assert.equal(personal.headers.get("cache-control"), "no-store");
  const body = await personal.json() as { items: Array<{ intakeId: string }> };
  assert.deepEqual(body.items.map((item) => item.intakeId), ["personal-task"]);

  const denied = await handler.intake.GET(req("/api/hosted/intake?workspaceId=indelitech", "other-token"));
  assert.equal(denied.status, 403);
  d1.sqlite.close();
});

test("PATCH edits, defers, dismisses, archives, and requires destination authorization for workspace moves", async () => {
  const { d1, handler } = harness();
  insertIntake(d1, "move-me", "personal", "TASK");

  const edited = await handler.intake.PATCH(jsonReq("/api/hosted/intake?workspaceId=personal", {
    intakeId: "move-me",
    action: "EDIT",
    patch: { title: "Edited title", workspaceId: "indelitech" },
  }));
  assert.equal(edited.status, 200);
  assert.equal((await edited.json() as { item: { workspaceKey: string; title: string } }).item.workspaceKey, "indelitech");

  const deferred = await handler.intake.PATCH(jsonReq("/api/hosted/intake?workspaceId=indelitech", {
    intakeId: "move-me", action: "DEFER", until: "2026-09-20T12:00:00Z",
  }));
  assert.equal(deferred.status, 200);

  const dismissed = await handler.intake.PATCH(jsonReq("/api/hosted/intake?workspaceId=indelitech", {
    intakeId: "move-me", action: "DISMISS",
  }));
  assert.equal(dismissed.status, 200);

  insertIntake(d1, "archive-me", "personal", "AWARENESS");
  const archived = await handler.intake.PATCH(jsonReq("/api/hosted/intake?workspaceId=personal", {
    intakeId: "archive-me", action: "ARCHIVE",
  }));
  assert.equal(archived.status, 200);
  d1.sqlite.close();
});

test("POST approves one item, rejects Bill bulk approval, and returns per-item results for conservative bulk actions", async () => {
  const { d1, handler } = harness();
  insertIntake(d1, "task-1", "personal", "TASK");
  insertIntake(d1, "task-2", "personal", "FOLLOW_UP");
  insertIntake(d1, "bill-1", "personal", "BILL");

  const approved = await handler.intake.POST(jsonReq("/api/hosted/intake?workspaceId=personal", {
    action: "APPROVE", intakeIds: ["task-1"],
  }, "POST"));
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json() as { results: Array<{ intakeId: string; ok: boolean; targetId?: string }> };
  assert.equal(approvedBody.results[0]?.ok, true);
  assert.equal(approvedBody.results[0]?.targetId, "capture:intake:task-1");

  const billBulk = await handler.intake.POST(jsonReq("/api/hosted/intake?workspaceId=personal", {
    action: "APPROVE_BULK", intakeIds: ["task-2", "bill-1"],
  }, "POST"));
  assert.equal(billBulk.status, 400);

  const dismissed = await handler.intake.POST(jsonReq("/api/hosted/intake?workspaceId=personal", {
    action: "DISMISS_BULK", intakeIds: ["task-2", "missing"],
  }, "POST"));
  assert.equal(dismissed.status, 200);
  const dismissedBody = await dismissed.json() as { results: Array<{ intakeId: string; ok: boolean }> };
  assert.deepEqual(dismissedBody.results.map((item) => item.ok), [true, false]);
  d1.sqlite.close();
});

test("freshness endpoint returns the five known per-user sources and preserves failed-source diagnostics", async () => {
  const { d1, handler } = harness();
  d1.sqlite.prepare(`INSERT INTO daily_intake_source_status
    (user_id,source_key,state,last_attempt_at,last_successful_at,diagnostic,scan_run_id,updated_at)
    VALUES ('user:marc','personal_gmail','FAILED',?,NULL,'OAuth refresh failed','scan-2',?)`)
    .run("2026-09-17T17:00:00Z", "2026-09-17T17:00:00Z");

  const response = await handler.status.GET(req("/api/hosted/intake/status?workspaceId=personal"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { sources: Array<{ sourceKey: string; state: string; diagnostic: string | null }> };
  assert.equal(body.sources.length, 5);
  assert.deepEqual(body.sources.find((source) => source.sourceKey === "personal_gmail"), {
    sourceKey: "personal_gmail",
    state: "FAILED",
    lastAttemptAt: "2026-09-17T17:00:00Z",
    lastSuccessfulAt: null,
    diagnostic: "OAuth refresh failed",
    scanRunId: "scan-2",
  });
  assert.equal(body.sources.find((source) => source.sourceKey === "family_calendar")?.state, "UNKNOWN");
  d1.sqlite.close();
});

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

class FailingBulkD1 implements D1Database {
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
    this.sqlite.prepare(`INSERT INTO intake_items (
      intake_id,user_id,workspace_id,workspace_key,intake_type,status,source_type,source_key,
      source_message_id,proposal_ordinal,source_timestamp,source_summary,classification_reason,title,
      target_payload_json,semantic_key,scan_run_id,created_at,updated_at
    ) VALUES ('bulk-secret','user:marc','personal','personal','TASK','PENDING','gmail','personal_gmail',
      'msg-bulk-secret',1,'2026-09-17T16:00:00Z','Evidence','Reason','Proposal','{}',
      'personal_gmail:message:msg-bulk-secret:1','scan-1','2026-09-17T16:00:00Z','2026-09-17T16:00:00Z')`).run();
  }
  prepare(sql: string): D1PreparedStatement {
    if (sql.includes("UPDATE intake_items SET status='DISMISSED'")) {
      return {
        bind() { return this; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { success: true, results: [] as T[] }; },
        async run<T>(): Promise<D1Result<T>> { throw new Error("SECRET /var/lib/d1/prod.sqlite write failed"); },
      };
    }
    return new Statement(this.sqlite.prepare(sql));
  }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

const clock: Clock = { now: () => new Date("2026-09-17T17:30:00.000Z") };
const ids: IdGenerator = { generate: () => "generated-id" };

test("bulk Intake failures never expose repository diagnostics", async () => {
  const d1 = new FailingBulkD1();
  const sessions = new InMemorySessionProvider(new Map([["marc-token", {
    sessionId: "session:marc",
    principal: { principalId: principalId("principal:marc") },
    expiresAt: "2026-09-18T17:30:00Z",
  }]]));
  const resolver: WorkspaceResolver = {
    async resolve(principal, workspaceId) {
      if (principal?.principalId === principalId("principal:marc") && workspaceId === "personal") {
        return { userId: "user:marc", workspaceId: "personal", workspaceKey: "personal" };
      }
      throw new Error("Workspace access denied.");
    },
  };
  const handler = createAuthorizedHostedIntakeHandler(sessions, resolver, d1, clock, ids);
  const response = await handler.intake.POST(new Request(
    "https://command.coreyg.dev/api/hosted/intake?workspaceId=personal",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-access-jwt-assertion": "marc-token",
      },
      body: JSON.stringify({ action: "DISMISS_BULK", intakeIds: ["bulk-secret"] }),
    },
  ));

  assert.equal(response.status, 200);
  const body = await response.json() as { results: Array<{ ok: boolean; error?: string }> };
  assert.equal(body.results[0]?.ok, false);
  assert.equal(body.results[0]?.error, "Intake item could not be dismissed.");
  assert.doesNotMatch(JSON.stringify(body), /SECRET|prod\.sqlite|write failed/i);
  d1.sqlite.close();
});

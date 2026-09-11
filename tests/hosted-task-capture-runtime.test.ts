import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { createHostedTaskCaptureRuntime } from "@/lib/server/hosted-task-capture-runtime";

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
      "0001_workspaces.sql",
      "0002_tasks.sql",
      "0005_task_capture_metadata.sql",
      "0006_principal_workspace_grants.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

const now = new Date("2026-09-11T18:00:00.000Z");
const teamDomain = "https://daily-command-center.cloudflareaccess.com";
const audience = "daily-command-center-aud";

async function accessFixture() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "runtime-key";
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const assertion = await new SignJWT({ type: "app", sub: "marc-runtime" })
    .setProtectedHeader({ alg: "RS256", kid: "runtime-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(now.getTime() / 1_000) + 3_600)
    .sign(pair.privateKey);
  return { keyResolver, assertion };
}

function request(assertion: string, workspaceId: "personal" | "indelitech", requestId: string) {
  return new Request("https://command.example/api/tasks/capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-jwt-assertion": assertion,
    },
    body: JSON.stringify({ requestId, workspaceId, title: `Task ${requestId}` }),
  });
}

test("hosted runtime composes verified Access identity, D1 grant, repository, and HTTP handler", async () => {
  const d1 = new TestD1();
  const { keyResolver, assertion } = await accessFixture();
  d1.sqlite.prepare(
    "INSERT INTO principal_workspace_grants (principal_id, workspace_id) VALUES (?, ?)",
  ).run("cf-user:marc-runtime", "personal");

  const post = createHostedTaskCaptureRuntime(
    { DB: d1, TEAM_DOMAIN: teamDomain, POLICY_AUD: audience },
    { clock: { now: () => now }, accessKeyResolver: keyResolver },
  );

  const response = await post(request(assertion, "personal", "runtime-personal"));
  assert.equal(response.status, 200);
  const body = await response.json() as { created: boolean; task: { taskId: string; primaryWorkspaceId: string } };
  assert.equal(body.created, true);
  assert.equal(body.task.taskId, "capture:runtime-personal");
  assert.equal(body.task.primaryWorkspaceId, "personal");
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM tasks").get() as { count: number }).count, 1);
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM task_visibility WHERE workspace_id='personal'").get() as { count: number }).count, 1);

  d1.sqlite.close();
});

test("hosted runtime denies a verified principal without the requested D1 grant before task creation", async () => {
  const d1 = new TestD1();
  const { keyResolver, assertion } = await accessFixture();
  d1.sqlite.prepare(
    "INSERT INTO principal_workspace_grants (principal_id, workspace_id) VALUES (?, ?)",
  ).run("cf-user:marc-runtime", "personal");

  const post = createHostedTaskCaptureRuntime(
    { DB: d1, TEAM_DOMAIN: teamDomain, POLICY_AUD: audience },
    { clock: { now: () => now }, accessKeyResolver: keyResolver },
  );

  const response = await post(request(assertion, "indelitech", "runtime-denied"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Workspace access denied." });
  assert.equal((d1.sqlite.prepare("SELECT count(*) count FROM tasks").get() as { count: number }).count, 0);

  d1.sqlite.close();
});

test("hosted runtime preserves Indelitech roll-up visibility when explicitly granted", async () => {
  const d1 = new TestD1();
  const { keyResolver, assertion } = await accessFixture();
  d1.sqlite.prepare(
    "INSERT INTO principal_workspace_grants (principal_id, workspace_id) VALUES (?, ?)",
  ).run("cf-user:marc-runtime", "indelitech");

  const post = createHostedTaskCaptureRuntime(
    { DB: d1, TEAM_DOMAIN: teamDomain, POLICY_AUD: audience },
    { clock: { now: () => now }, accessKeyResolver: keyResolver },
  );

  const response = await post(request(assertion, "indelitech", "runtime-business"));
  assert.equal(response.status, 200);
  const visibility = d1.sqlite.prepare(
    "SELECT workspace_id FROM task_visibility WHERE task_id = ? ORDER BY workspace_id",
  ).all("capture:runtime-business") as Array<{ workspace_id: string }>;
  assert.deepEqual(visibility.map(({ workspace_id }) => workspace_id), ["indelitech", "personal"]);

  d1.sqlite.close();
});

test("hosted runtime fails configuration closed before serving requests", async () => {
  const d1 = new TestD1();
  const { keyResolver } = await accessFixture();

  assert.throws(
    () => createHostedTaskCaptureRuntime(
      { DB: null as unknown as D1Database, TEAM_DOMAIN: teamDomain, POLICY_AUD: audience },
      { clock: { now: () => now }, accessKeyResolver: keyResolver },
    ),
    /D1 DB binding is required/,
  );
  assert.throws(
    () => createHostedTaskCaptureRuntime(
      { DB: d1, TEAM_DOMAIN: "http://unsafe.example", POLICY_AUD: audience },
      { clock: { now: () => now }, accessKeyResolver: keyResolver },
    ),
    /valid Cloudflare Access team domain/,
  );
  assert.throws(
    () => createHostedTaskCaptureRuntime(
      { DB: d1, TEAM_DOMAIN: teamDomain, POLICY_AUD: "   " },
      { clock: { now: () => now }, accessKeyResolver: keyResolver },
    ),
    /audience is required/,
  );

  d1.sqlite.close();
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { taskItemToHostedTask } from "@/lib/runtime/hosted-task-compat";
import type { Clock } from "@/lib/runtime/primitives";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";
import { D1TaskRepository } from "@/lib/server/d1-task-repository";
import { D1WorkspaceResolver } from "@/lib/server/d1-workspace-resolver";
import { createAuthorizedHostedTaskSurfaceHandler } from "@/lib/server/authorized-hosted-task-surface-handler";
import type { TaskItem } from "@/lib/types";

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
  failReads = false;
  failBatchAt: number | undefined;
  prepareCount = 0;
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_workspaces.sql", "0002_tasks.sql", "0005_task_capture_metadata.sql", "0006_principal_workspace_grants.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    this.prepareCount++;
    if (this.failReads && sql.includes("FROM tasks")) throw new Error("SQL and binding secret");
    return new Statement(this.sqlite.prepare(sql));
  }
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const [index, statement] of statements.entries()) {
        if (index === this.failBatchAt) throw new Error("D1_ERROR: no such table: tasks");
        results.push(await statement.run<T>());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const now = "2026-09-12T08:00:00.000Z";
const clock: Clock = { now: () => new Date(now) };
const alice = principalId("principal-alice");
const session: AuthenticatedSession = {
  sessionId: "verified-session",
  principal: { principalId: alice },
  expiresAt: "2026-09-12T09:00:00.000Z",
};

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return { id: "task", primaryWorkspaceId: "personal", title: "Secure task", description: "Context", due: "2026-09-13",
    recurrence: "One-time", priority: "HIGH", done: false, status: "OPEN", type: "DEADLINE", createdAt: now,
    updatedAt: now, source: "manual", ...overrides };
}

function request(path: string, body?: unknown, assertion = "assertion") {
  return new Request(`https://command.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: assertion ? { "cf-access-jwt-assertion": assertion, "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function fixture(sessions: ReadonlyMap<string, AuthenticatedSession> = new Map([["assertion", session]])) {
  const database = new TestD1();
  const handlers = createAuthorizedHostedTaskSurfaceHandler(
    new InMemorySessionProvider(sessions), new D1WorkspaceResolver(database), database, clock,
  );
  return { database, handlers };
}

function grant(database: TestD1, workspaceId: "personal" | "indelitech") {
  database.sqlite.prepare("INSERT INTO principal_workspace_grants (principal_id, workspace_id, created_at) VALUES (?, ?, ?)")
    .run(alice, workspaceId, now);
}

async function seed(database: TestD1, item: TaskItem) {
  const hosted = taskItemToHostedTask(item, now);
  const visible = hosted.primaryWorkspaceId === "indelitech" ? ["indelitech", "personal"] as const : ["personal"] as const;
  await new D1TaskRepository(database).create({ workspaceId: hosted.primaryWorkspaceId }, hosted, visible);
}

test("missing, invalid, and expired assertions fail before any D1 statement", async () => {
  for (const [sessions, assertion] of [
    [new Map<string, AuthenticatedSession>(), "bad"],
    [new Map([["assertion", { ...session, expiresAt: now }]]), "assertion"],
  ] as const) {
    const { database, handlers } = fixture(sessions);
    const response = await handlers.GET(request("/api/hosted/workspace?workspaceId=personal", undefined, assertion));
    assert.equal(response.status, 403); assert.equal(database.prepareCount, 0);
  }
  const { database, handlers } = fixture();
  assert.equal((await handlers.GET(request("/api/hosted/workspace?workspaceId=personal", undefined, ""))).status, 403);
  assert.equal(database.prepareCount, 0);
});

test("unknown workspace is bounded and exact workspace grants are required", async () => {
  const { database, handlers } = fixture();
  assert.equal((await handlers.GET(request("/api/hosted/workspace?workspaceId=other"))).status, 400);
  const denied = await handlers.GET(request("/api/hosted/workspace?workspaceId=personal"));
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Workspace access denied." });
  grant(database, "indelitech");
  assert.equal((await handlers.GET(request("/api/hosted/workspace?workspaceId=personal"))).status, 403);
});

test("Personal reads its roll-up while Indelitech excludes Personal", async () => {
  const { database, handlers } = fixture(); grant(database, "personal"); grant(database, "indelitech");
  await seed(database, task({ id: "private" }));
  await seed(database, task({ id: "team", primaryWorkspaceId: "indelitech" }));
  const personal = await (await handlers.GET(request("/api/hosted/workspace?workspaceId=personal"))).json() as { tasks: TaskItem[] };
  const team = await (await handlers.GET(request("/api/hosted/workspace?workspaceId=indelitech"))).json() as { tasks: TaskItem[] };
  assert.deepEqual(personal.tasks.map(({ id }) => id).sort(), ["private", "team"]);
  assert.deepEqual(team.tasks.map(({ id }) => id), ["team"]);
});

test("authorized mutations use the query workspace, not client identity or first-task ownership", async () => {
  const { database, handlers } = fixture(); grant(database, "personal"); grant(database, "indelitech");
  await seed(database, task({ id: "team", primaryWorkspaceId: "indelitech" }));
  const current = task({ id: "team", primaryWorkspaceId: "indelitech", title: "Edited" });
  const updated = await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=personal&principalId=attacker", {
    mutations: [{ kind: "UPDATE", taskId: "team", task: current }], principalId: "attacker",
  }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json() as { tasks: TaskItem[] }).tasks[0].title, "Edited");

  const created = await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=indelitech", {
    mutations: [{ kind: "CREATE", task: task({ id: "new-team", primaryWorkspaceId: "indelitech" }) }],
  }));
  assert.equal(created.status, 200);
  const personalCreate = await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=personal", {
    mutations: [{ kind: "CREATE", task: task({ id: "forbidden", primaryWorkspaceId: "indelitech" }) }],
  }));
  assert.equal(personalCreate.status, 400);
});

test("recurring Personal roll-up completion is atomic through the HTTP boundary", async () => {
  const { database, handlers } = fixture(); grant(database, "personal");
  await seed(database, task({ id: "series", primaryWorkspaceId: "indelitech", recurrence: "Weekly", type: "RECURRING" }));
  const parent = task({ id: "series", primaryWorkspaceId: "indelitech", recurrence: "Weekly", type: "RECURRING" });
  const occurrence = { ...parent, id: "occurrence", done: true, status: "DONE" as const, seriesId: "series", completedAt: now };
  const advance = { ...parent, due: "2026-09-20" };
  database.failBatchAt = 2;
  const response = await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=personal", {
    mutations: [{ kind: "CREATE", task: occurrence }, { kind: "UPDATE", taskId: "series", task: advance }],
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Task mutations could not be saved safely." });
  assert.equal(database.sqlite.prepare("SELECT count(*) count FROM tasks WHERE task_id='occurrence'").get()!.count, 0);
  assert.equal(database.sqlite.prepare("SELECT due_at FROM tasks WHERE task_id='series'").get()!.due_at, "2026-09-13");
});

test("malformed mutations and internal reads have bounded responses without sensitive detail", async () => {
  const { database, handlers } = fixture(); grant(database, "personal");
  assert.equal((await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=personal", "{bad"))).status, 400);
  assert.equal((await handlers.POST(request("/api/hosted/tasks/mutations?workspaceId=personal", { mutations: [] }))).status, 400);
  database.failReads = true;
  const failed = await handlers.GET(request("/api/hosted/workspace?workspaceId=personal"));
  assert.equal(failed.status, 500);
  const body = await failed.json();
  assert.deepEqual(body, { error: "Workspace could not be read safely." });
  assert.doesNotMatch(JSON.stringify(body).toLowerCase(), /sql|binding|secret|principal|jwt/);
});

test("the hosted capture route delegates to the existing authorized idempotent runtime", () => {
  const source = readFileSync(new URL("../app/api/hosted/tasks/capture/route.ts", import.meta.url), "utf8");
  assert.match(source, /createHostedTaskCaptureRuntime/);
  assert.doesNotMatch(source, /request\.json|captureFingerprint|D1TaskRepository/);
});

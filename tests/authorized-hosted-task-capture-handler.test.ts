import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
} from "@/lib/runtime/session";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { createAuthorizedHostedTaskCaptureHandler } from "@/lib/server/authorized-hosted-task-capture-handler";
import { isLocalTaskCaptureEnabled } from "@/lib/server/local-task-capture-boundary";

const now = new Date("2026-09-11T18:00:00.000Z");
const alice = principalId("principal-alice");
const validSession: AuthenticatedSession = {
  sessionId: "verified-access-token",
  principal: { principalId: alice },
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function memoryRepository() {
  const tasks = new Map<string, HostedTask>();
  const visibility = new Map<string, readonly ProductWorkspaceId[]>();
  let creates = 0;
  const repository: HostedTaskRepository = {
    async list(context) {
      return [...tasks.values()].filter((task) =>
        visibility.get(task.taskId)?.includes(context.workspaceId as ProductWorkspaceId));
    },
    async get(context, taskId) {
      const task = tasks.get(taskId);
      return task && visibility.get(taskId)?.includes(context.workspaceId as ProductWorkspaceId)
        ? structuredClone(task)
        : null;
    },
    async create(_context, task, visibleIn) {
      if (tasks.has(task.taskId)) throw new Error("duplicate");
      creates++;
      tasks.set(task.taskId, structuredClone(task));
      visibility.set(task.taskId, [...visibleIn]);
      return structuredClone(task);
    },
    async update(_context, task) {
      tasks.set(task.taskId, structuredClone(task));
      return structuredClone(task);
    },
  };
  return { repository, tasks, visibility, get creates() { return creates; } };
}

function request(body: unknown, assertion = "verified-assertion") {
  return new Request("https://command.example/api/tasks/capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-jwt-assertion": assertion,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function handler(options: {
  workspaces?: readonly ProductWorkspaceId[];
  repository?: HostedTaskRepository;
  sessions?: ReadonlyMap<string, AuthenticatedSession>;
} = {}) {
  const state = memoryRepository();
  const repository = options.repository ?? state.repository;
  const sessions = options.sessions ?? new Map([["verified-assertion", validSession]]);
  const resolver = new FakeWorkspaceResolver(new Map([
    [alice, new Set(options.workspaces ?? ["personal"])],
  ]));
  return {
    state,
    post: createAuthorizedHostedTaskCaptureHandler(
      new InMemorySessionProvider(sessions),
      resolver,
      repository,
      { now: () => now },
    ),
  };
}

const base = {
  requestId: "http-1",
  workspaceId: "personal",
  title: "Capture this task",
} as const;

test("trusted HTTP boundary requires the Access assertion header before reading capture identity", async () => {
  const { post, state } = handler();
  const response = await post(new Request("https://command.example/api/tasks/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(base),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
  assert.equal(state.creates, 0);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("valid assertion and workspace grant create one hosted task and preserve replay idempotency", async () => {
  const { post, state } = handler();
  const first = await post(request(base));
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { created: boolean; task: HostedTask };
  assert.equal(firstBody.created, true);
  assert.equal(firstBody.task.taskId, "capture:http-1");
  assert.equal(firstBody.task.primaryWorkspaceId, "personal");
  assert.equal(state.creates, 1);

  const replay = await post(request(base));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { created: boolean }).created, false);
  assert.equal(state.creates, 1);
  assert.equal(replay.headers.get("access-control-allow-origin"), null);
});

test("invalid or expired session and missing workspace grant fail closed before persistence", async () => {
  const invalid = handler({ sessions: new Map() });
  assert.equal((await invalid.post(request(base))).status, 403);
  assert.equal(invalid.state.creates, 0);

  const expiredSession = { ...validSession, expiresAt: "2026-09-11T17:59:59.000Z" };
  const expired = handler({ sessions: new Map([["verified-assertion", expiredSession]]) });
  assert.equal((await expired.post(request(base))).status, 403);
  assert.equal(expired.state.creates, 0);

  const denied = handler({ workspaces: ["personal"] });
  const response = await denied.post(request({ ...base, requestId: "denied", workspaceId: "indelitech" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Workspace access denied." });
  assert.equal(denied.state.creates, 0);
  assert.equal(denied.state.tasks.has("capture:denied"), false);
});

test("malformed JSON, invalid workspace, capture validation, and idempotency conflict have bounded responses", async () => {
  const { post, state } = handler();
  const malformed = await post(request("{not-json"));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON." });

  const invalidWorkspace = await post(request({ ...base, workspaceId: "legacy-local" }));
  assert.equal(invalidWorkspace.status, 400);
  assert.deepEqual(await invalidWorkspace.json(), { error: "workspaceId must be personal or indelitech." });

  const waiting = await post(request({ ...base, requestId: "waiting", type: "WAITING" }));
  assert.equal(waiting.status, 400);
  assert.match((await waiting.json() as { error: string }).error, /WAITING requires person and followUpAt/);

  assert.equal((await post(request(base))).status, 200);
  const conflict = await post(request({ ...base, title: "Different original capture" }));
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json() as { error: string }).error, /requestId is already associated/);
  assert.equal(state.creates, 1);
});

test("unexpected persistence failures return a generic 500 without leaking internal detail", async () => {
  const broken: HostedTaskRepository = {
    async list() { return []; },
    async get() { return null; },
    async create() { throw new Error("database password or stack trace"); },
    async update(_context, task) { return task; },
  };
  const { post } = handler({ repository: broken });
  const response = await post(request(base));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Task capture could not be saved safely." });
});

test("legacy local task-capture route is disabled in production only", () => {
  assert.equal(isLocalTaskCaptureEnabled("production"), false);
  assert.equal(isLocalTaskCaptureEnabled("development"), true);
  assert.equal(isLocalTaskCaptureEnabled("test"), true);
  assert.equal(isLocalTaskCaptureEnabled(undefined), true);
});

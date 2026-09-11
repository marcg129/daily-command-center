import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAuthorizedHostedTaskCaptureService } from "@/lib/runtime/authorized-hosted-task-capture";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
} from "@/lib/runtime/session";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";

const now = new Date("2026-09-11T18:00:00.000Z");
const aliceId = principalId("principal-alice");
const bobId = principalId("principal-bob");

function session(
  sessionId: string,
  principal: ReturnType<typeof principalId>,
  expiresAt = "2026-09-12T18:00:00.000Z",
): AuthenticatedSession {
  return { sessionId, principal: { principalId: principal }, expiresAt };
}

function memoryRepository() {
  const tasks = new Map<string, HostedTask>();
  const visibility = new Map<string, readonly ProductWorkspaceId[]>();
  let creates = 0;
  const repository: HostedTaskRepository = {
    async list(context) {
      return [...tasks.values()].filter((task) =>
        visibility.get(task.taskId)?.includes(context.workspaceId as ProductWorkspaceId),
      );
    },
    async get(context, taskId) {
      const task = tasks.get(taskId);
      return task && visibility.get(taskId)?.includes(context.workspaceId as ProductWorkspaceId)
        ? structuredClone(task)
        : null;
    },
    async create(_context, task, visibleIn) {
      creates++;
      if (tasks.has(task.taskId)) throw new Error("duplicate");
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

function service(options: {
  grants?: ReadonlyMap<string, ReadonlySet<ProductWorkspaceId>>;
  sessions?: ReadonlyMap<string, AuthenticatedSession>;
} = {}) {
  const state = memoryRepository();
  const sessions = options.sessions ?? new Map([
    ["alice-session", session("alice-session", aliceId)],
    ["bob-session", session("bob-session", bobId)],
  ]);
  const grants = options.grants ?? new Map([
    [aliceId, new Set<ProductWorkspaceId>(["personal"])],
    [bobId, new Set<ProductWorkspaceId>(["personal", "indelitech"])],
  ]);
  return {
    state,
    capture: createAuthorizedHostedTaskCaptureService(
      new InMemorySessionProvider(sessions),
      new FakeWorkspaceResolver(grants),
      state.repository,
      { now: () => now },
    ),
  };
}

const personalCapture = {
  requestId: "authorized-personal-1",
  workspaceId: "personal",
  title: "Review the launch checklist",
} as const;

test("authorized capture resolves session then workspace before creating a hosted task", async () => {
  const { capture, state } = service();
  const result = await capture({
    sessionIdentity: "alice-session",
    requestedWorkspaceId: "personal",
    capture: personalCapture,
  });

  assert.equal(result.created, true);
  assert.equal(result.task.primaryWorkspaceId, "personal");
  assert.equal(result.task.taskId, "capture:authorized-personal-1");
  assert.deepEqual(state.visibility.get(result.task.taskId), ["personal"]);
  assert.equal(state.creates, 1);
});

test("missing, unknown, and expired sessions fail closed before persistence", async () => {
  const expiredSessions = new Map([
    ["expired", session("expired", aliceId, "2026-09-11T17:59:59.000Z")],
  ]);
  const { capture, state } = service({ sessions: expiredSessions });

  for (const sessionIdentity of [null, "missing", "expired"] as const) {
    await assert.rejects(
      capture({ sessionIdentity, requestedWorkspaceId: "personal", capture: personalCapture }),
      /Authentication required/,
    );
  }
  assert.equal(state.creates, 0);
  assert.equal(state.tasks.size, 0);
});

test("workspace grants and capture ownership both fail closed before create", async () => {
  const { capture, state } = service();

  await assert.rejects(
    capture({
      sessionIdentity: "alice-session",
      requestedWorkspaceId: "indelitech",
      capture: { ...personalCapture, requestId: "no-grant", workspaceId: "indelitech" },
    }),
    /Workspace access denied/,
  );

  await assert.rejects(
    capture({
      sessionIdentity: "alice-session",
      requestedWorkspaceId: "personal",
      capture: { ...personalCapture, requestId: "mismatch", workspaceId: "indelitech" },
    }),
    /workspace must match/i,
  );

  await assert.rejects(
    capture({
      sessionIdentity: "alice-session",
      requestedWorkspaceId: "legacy-local",
      capture: personalCapture,
    }),
    /Unknown workspace/,
  );

  assert.equal(state.creates, 0);
  assert.equal(state.tasks.size, 0);
});

test("an authorized Indelitech capture rolls up to Personal and replay remains idempotent", async () => {
  const { capture, state } = service();
  const request = {
    sessionIdentity: "bob-session",
    requestedWorkspaceId: "indelitech",
    capture: {
      requestId: "authorized-indelitech-1",
      workspaceId: "indelitech",
      title: "Send client onboarding summary",
      due: "2026-09-15",
    },
  } as const;

  const first = await capture(request);
  const replay = await capture(request);

  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(first.task.taskId, replay.task.taskId);
  assert.deepEqual(state.visibility.get(first.task.taskId), ["indelitech", "personal"]);
  assert.equal(state.creates, 1);
});

test("a verified Access principal captures only into its granted workspace", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "integration-key";
  const access = new CloudflareAccessSessionProvider({
    teamDomain: "https://daily-command-center.cloudflareaccess.com",
    audience: "hosted-capture",
    clock: { now: () => now },
    keyResolver: createLocalJWKSet({ keys: [jwk] }),
  });
  const assertion = await new SignJWT({ type: "app", sub: "access-user" })
    .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
    .setIssuer("https://daily-command-center.cloudflareaccess.com")
    .setAudience("hosted-capture")
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(now.getTime() / 1_000) + 3_600)
    .sign(privateKey);
  const state = memoryRepository();
  const capture = createAuthorizedHostedTaskCaptureService(
    access,
    new FakeWorkspaceResolver(new Map([
      [principalId("cf-user:access-user"), new Set<ProductWorkspaceId>(["personal"])],
    ])),
    state.repository,
    { now: () => now },
  );

  const result = await capture({
    sessionIdentity: assertion,
    requestedWorkspaceId: "personal",
    capture: { ...personalCapture, requestId: "verified-access" },
  });
  assert.equal(result.created, true);
  assert.equal(state.creates, 1);

  await assert.rejects(
    capture({
      sessionIdentity: assertion,
      requestedWorkspaceId: "indelitech",
      capture: { ...personalCapture, requestId: "access-denied", workspaceId: "indelitech" },
    }),
    /Workspace access denied/,
  );
  assert.equal(state.creates, 1);
  assert.equal(state.tasks.has("capture:access-denied"), false);
});

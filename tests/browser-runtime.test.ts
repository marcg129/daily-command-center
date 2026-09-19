import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserRuntimeMode,
  fetchHostedWithSessionRefresh,
  hostedWorkspaceEndpoint,
  isLoopbackHostname,
  loadHostedApplicationSession,
  loadBrowserWorkspace,
  selectAuthorizedWorkspace,
  taskMutationEndpoint,
} from "@/lib/runtime/browser-runtime";
import { OrderedSaveQueue } from "@/lib/runtime/ordered-save-queue";
import { readFile } from "node:fs/promises";

const workspace = {
  initialized: true,
  legacyBrowserImportAllowed: false,
  reminders: [],
  tasks: [],
};
const settings = { general: { workspaceName: "Test" } };

test("browser mode recognizes only the specified loopback hostnames", () => {
  for (const hostname of [
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "::1",
    "[::1]",
  ])
    assert.equal(isLoopbackHostname(hostname), true);
  for (const hostname of [
    "app.example.com",
    "0.0.0.0",
    "127.0.0.2",
    "localhost.example.com",
    "",
  ])
    assert.equal(browserRuntimeMode(hostname), "hosted");
});

test("local bootstrap reads settings and workspace while hosted bootstrap reads only its workspace", async () => {
  const localCalls: Array<{ url: string; init?: RequestInit }> = [];
  const localFetch = async (url: string, init?: RequestInit) => {
    localCalls.push({ url, init });
    return Response.json(url === "/api/settings" ? settings : workspace);
  };
  const local = await loadBrowserWorkspace(localFetch, "local", "personal");
  assert.deepEqual(local.settings, settings);
  assert.deepEqual(localCalls.map(({ url }) => url).sort(), [
    "/api/settings",
    "/api/workspace",
  ]);
  assert.ok(
    localCalls.every(({ init }) => !init?.method || init.method === "GET"),
  );

  const hostedCalls: string[] = [];
  const hosted = await loadBrowserWorkspace(
    async (url) => {
      hostedCalls.push(url);
      return Response.json(workspace);
    },
    "hosted",
    "indelitech",
  );
  assert.equal(hosted.settings, undefined);
  assert.deepEqual(hostedCalls, [
    "/api/hosted/workspace?workspaceId=indelitech",
  ]);
});

test("hosted workspace switches and task writes retain explicit workspace endpoints", async () => {
  assert.equal(
    hostedWorkspaceEndpoint("personal"),
    "/api/hosted/workspace?workspaceId=personal",
  );
  assert.equal(
    hostedWorkspaceEndpoint("indelitech"),
    "/api/hosted/workspace?workspaceId=indelitech",
  );
  assert.equal(
    taskMutationEndpoint("local", "personal"),
    "/api/tasks/mutations",
  );
  assert.equal(
    taskMutationEndpoint("hosted", "personal"),
    "/api/hosted/tasks/mutations?workspaceId=personal",
  );

  const queue = new OrderedSaveQueue();
  const calls: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enqueueFor = (workspaceId: "personal" | "indelitech") =>
    queue.enqueue(async () => {
      calls.push(taskMutationEndpoint("hosted", workspaceId));
      if (workspaceId === "personal") await blocked;
    });
  const first = enqueueFor("personal");
  const second = enqueueFor("indelitech");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [
    "/api/hosted/tasks/mutations?workspaceId=personal",
    "/api/hosted/tasks/mutations?workspaceId=indelitech",
  ]);
});

test("concurrent hosted 403s share one same-document AuthKit refresh-token rotation", async () => {
  const attempts = new Map<string, number>();
  let refreshCalls = 0;
  let refreshed = false;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  const fetcher = async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/workos/refresh") {
      refreshCalls += 1;
      assert.equal(init?.method, "POST");
      await refreshGate;
      refreshed = true;
      return new Response(null, { status: 204 });
    }

    attempts.set(url, (attempts.get(url) ?? 0) + 1);
    return new Response(null, { status: refreshed ? 200 : 403 });
  };

  const first = fetchHostedWithSessionRefresh(fetcher, "/api/hosted/workspace?workspaceId=personal");
  const second = fetchHostedWithSessionRefresh(fetcher, "/api/hosted/events?workspaceId=personal");

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(refreshCalls, 1);

  releaseRefresh();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(refreshCalls, 1);
  assert.ok((attempts.get("/api/hosted/workspace?workspaceId=personal") ?? 0) >= 2);
  assert.ok((attempts.get("/api/hosted/events?workspaceId=personal") ?? 0) >= 2);
});

test("hosted identity bootstrap accepts only authorized workspace metadata", async () => {
  const session = await loadHostedApplicationSession(async (url, init) => {
    assert.equal(url, "/api/hosted/session");
    assert.equal(init?.cache, "no-store");
    return Response.json({
      userId: "user:marc",
      expiresAt: "2026-09-20T00:00:00.000Z",
      workspaces: [
        {
          workspaceId: "personal",
          displayName: "Personal",
          workspaceType: "PERSONAL",
          themeKey: "personal-tech-blue",
          role: "OWNER",
        },
      ],
    });
  });
  assert.equal(session.userId, "user:marc");
  assert.deepEqual(
    session.workspaces.map(({ workspaceId }) => workspaceId),
    ["personal"],
  );
  assert.equal(
    selectAuthorizedWorkspace(session.workspaces, "indelitech"),
    "personal",
  );
  assert.equal(
    selectAuthorizedWorkspace(session.workspaces, "personal"),
    "personal",
  );
});

test("hosted identity bootstrap refreshes an expired AuthKit session once and retries", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  let sessionAttempts = 0;

  const session = await loadHostedApplicationSession(async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url === "/api/auth/workos/refresh") {
      return new Response(null, { status: 204 });
    }
    sessionAttempts += 1;
    if (sessionAttempts === 1) return new Response(null, { status: 403 });
    return Response.json({
      userId: "user:workos",
      expiresAt: "2026-09-20T00:00:00.000Z",
      workspaces: [
        {
          workspaceId: "personal",
          displayName: "Personal",
          workspaceType: "PERSONAL",
          themeKey: "personal-tech-blue",
          role: "OWNER",
        },
      ],
    });
  });

  assert.equal(session.userId, "user:workos");
  assert.deepEqual(calls, [
    { url: "/api/hosted/session", method: undefined },
    { url: "/api/auth/workos/refresh", method: "POST" },
    { url: "/api/hosted/session", method: undefined },
  ]);
});

test("hosted identity bootstrap preserves the original failure when refresh is unavailable", async () => {
  const calls: string[] = [];
  await assert.rejects(
    loadHostedApplicationSession(async (url) => {
      calls.push(url);
      return new Response(null, { status: url === "/api/auth/workos/refresh" ? 401 : 403 });
    }),
    /identity could not be resolved/,
  );
  assert.deepEqual(calls, [
    "/api/hosted/session",
    "/api/hosted/session",
    "/api/auth/workos/refresh",
  ]);
});

test("hosted identity bootstrap rejects missing and malformed memberships", async () => {
  await assert.rejects(
    loadHostedApplicationSession(async () =>
      Response.json({
        userId: "user:marc",
        expiresAt: "2026-09-20T00:00:00.000Z",
        workspaces: [],
      }),
    ),
    /identity response was invalid/,
  );
  await assert.rejects(
    loadHostedApplicationSession(
      async () => new Response(null, { status: 403 }),
    ),
    /identity could not be resolved/,
  );
});

test("hosted UI keeps task views and substitutes deferred shells for local-only modules", async () => {
  const source = await readFile(
    new URL("../components/control-center.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /runtimeMode === "hosted" \? <TaskFocusedTodayView/);
  assert.match(source, /MY COMMAND CENTER/);
  assert.doesNotMatch(source, /MARC&apos;S COMMAND CENTER/);
  assert.match(source, /Hosted Intel is deferred/);
  assert.match(source, /Hosted Mentions are deferred/);
  assert.match(source, /Hosted Settings are deferred/);
  assert.match(source, /activeTab === "industry" && runtimeMode === "local"/);
  assert.match(source, /activeTab === "mentions" && runtimeMode === "local"/);
  assert.match(source, /activeTab === "settings" && runtimeMode === "local"/);
  assert.match(source, /runtimeMode !== "local"/);
  assert.match(
    source,
    /lastScheduledTasks\.current === scheduledTasks/,
    "an older hosted response must not overwrite a newer optimistic task snapshot",
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createChatTaskCaptureService, TaskCaptureConfirmationError } from "@/lib/runtime/chat-task-capture";
import type { ProductWorkspaceId } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import { principalId } from "@/lib/runtime/session";
import { FakeWorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import worker from "@/workers/task-capture-mcp";

const now = new Date("2026-09-12T14:00:00.000Z");
const marc = { principalId: principalId("cf-user:marc") };

function memoryRepository() {
  const tasks = new Map<string, HostedTask>();
  const visibility = new Map<string, readonly ProductWorkspaceId[]>();
  let creates = 0;
  const repository: HostedTaskRepository = {
    async list(context) {
      return [...tasks.values()].filter((task) => visibility.get(task.taskId)?.includes(context.workspaceId as ProductWorkspaceId));
    },
    async get(context, taskId) {
      const task = tasks.get(taskId);
      return task && visibility.get(taskId)?.includes(context.workspaceId as ProductWorkspaceId) ? structuredClone(task) : null;
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

function service(grants: readonly ProductWorkspaceId[] = ["personal", "indelitech"]) {
  const state = memoryRepository();
  return {
    state,
    tasks: createChatTaskCaptureService(
      marc,
      new FakeWorkspaceResolver(new Map([[marc.principalId, new Set(grants)]])),
      state.repository,
      { now: () => now },
      () => "chat:proposal-123",
    ),
  };
}

const proposed = {
  workspaceId: "indelitech",
  title: "Prepare quarterly access review",
  context: "Include privileged vendor accounts.",
  priority: "HIGH",
  due: "2026-09-18",
  remindAt: "2026-09-17T09:00:00-04:00",
  estimatedDuration: "1h",
  recurrence: "Weekly",
  project: "Security operations",
  sourceContext: "ChatGPT task planning chat",
} as const;

test("chat preview normalizes every confirmation field without persisting", async () => {
  const { tasks, state } = service();
  const preview = await tasks.preview(proposed);

  assert.deepEqual(preview, {
    requestId: "chat:proposal-123",
    workspaceId: "indelitech",
    title: "Prepare quarterly access review",
    context: "Include privileged vendor accounts.",
    type: "RECURRING",
    priority: "HIGH",
    due: "2026-09-18",
    remindAt: "2026-09-17T13:00:00.000Z",
    followUpAt: null,
    recurrence: "Weekly",
    repeats: true,
    estimatedDuration: "1h",
    category: null,
    project: "Security operations",
    person: null,
    dependency: null,
    sourceContext: "ChatGPT task planning chat",
  });
  assert.equal(state.creates, 0);
  assert.equal(state.tasks.size, 0);
});

test("chat create requires explicit confirmation before any persistence", async () => {
  const { tasks, state } = service();
  await assert.rejects(
    tasks.create({ ...proposed, requestId: "chat:proposal-123" }),
    TaskCaptureConfirmationError,
  );
  await assert.rejects(
    tasks.create({ ...proposed, requestId: "chat:proposal-123", confirmedByUser: false }),
    TaskCaptureConfirmationError,
  );
  assert.equal(state.creates, 0);
  assert.equal(state.tasks.size, 0);
});

test("confirmed chat capture creates one canonical D1-shaped task with existing roll-up and replay semantics", async () => {
  const { tasks, state } = service();
  const input = { ...proposed, requestId: "chat:proposal-123", confirmedByUser: true };
  const created = await tasks.create(input);
  const replay = await tasks.create(input);

  assert.equal(created.created, true);
  assert.equal(replay.created, false);
  assert.equal(created.task.taskId, "capture:chat:proposal-123");
  assert.equal(created.task.primaryWorkspaceId, "indelitech");
  assert.equal(created.task.estimatedDuration, 60);
  assert.equal(created.task.estimatedDurationLabel, "1h");
  assert.equal(created.task.source, "send-to-tasks");
  assert.deepEqual(state.visibility.get(created.task.taskId), ["indelitech", "personal"]);
  assert.equal(state.creates, 1);
});

test("chat preview and create both require the exact workspace grant", async () => {
  const { tasks, state } = service(["personal"]);
  await assert.rejects(tasks.preview(proposed), /Workspace access denied/);
  await assert.rejects(
    tasks.create({ ...proposed, requestId: "chat:proposal-123", confirmedByUser: true }),
    /Workspace access denied/,
  );
  assert.equal(state.creates, 0);
});

test("MCP transport fails closed before parsing tools or touching D1", async () => {
  const missing = await worker.fetch(
    new Request("https://daily-command-center-mcp.example/mcp", { method: "POST" }),
    {} as never,
  );
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), { error: "Authentication required." });

  const crossSite = await worker.fetch(
    new Request("https://daily-command-center-mcp.example/mcp", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }),
    {} as never,
  );
  assert.equal(crossSite.status, 403);
  assert.deepEqual(await crossSite.json(), { error: "Cross-site requests are blocked." });
});

test("MCP tool metadata encodes preview-before-confirmation and bounded private writes", async () => {
  const source = await readFile(new URL("../workers/task-capture-mcp.ts", import.meta.url), "utf8");
  assert.match(source, /Always call preview_task first/);
  assert.match(source, /explicit confirmation/);
  assert.match(source, /confirmedByUser: z\.literal\(true\)/);
  assert.match(source, /readOnlyHint: true/);
  assert.match(source, /readOnlyHint: false/);
  assert.doesNotMatch(source, /api[_-]?key|bearer-token bypass|Access-Control-Allow-Origin/i);
});

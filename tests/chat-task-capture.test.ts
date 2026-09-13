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

test("chat create still requires a user-authorized write before persistence", async () => {
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

test("an explicit user-authorized capture can create directly without a preview and remains idempotent", async () => {
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

test("MCP metadata makes SEND TO TASKS a direct explicit command while inferred tasks still require confirmation", async () => {
  const source = await readFile(new URL("../workers/task-capture-mcp.ts", import.meta.url), "utf8");
  assert.match(source, /SEND TO TASKS/);
  assert.match(source, /call create_task directly/);
  assert.match(source, /do not ask the user to repeat known fields/);
  assert.match(source, /merely infer a likely task/);
  assert.match(source, /Ask whether the user wants it added/);
  assert.match(source, /confirmedByUser: z\.literal\(true\)/);
  assert.match(source, /readOnlyHint: true/);
  assert.match(source, /readOnlyHint: false/);
  assert.doesNotMatch(source, /Always call preview_task first/);
  assert.doesNotMatch(source, /api[_-]?key|bearer-token bypass|Access-Control-Allow-Origin/i);
});

test("future-ready Skill mirrors the explicit command and confirmation boundary", async () => {
  const skill = await readFile(
    new URL("../skills/daily-command-center-tasks/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---[\s\S]*name: daily-command-center-tasks[\s\S]*description:/);
  assert.match(skill, /SEND TO TASKS/);
  assert.match(skill, /Do not create a task merely because a likely action appears/);
  assert.match(skill, /Do not ask the user to repeat fields already clear/);
  assert.match(skill, /Do not claim success unless the Daily Command Center action succeeds/);
});

test("deployment documentation uses the account's canonical workers.dev subdomain", async () => {
  const documentation = await readFile(
    new URL("../docs/MILESTONE-1D-F-CHAT-CONFIRMED-CAPTURE.md", import.meta.url),
    "utf8",
  );
  assert.match(documentation, /https:\/\/daily-command-center-mcp\.mecg129\.workers\.dev\/mcp/);
  assert.doesNotMatch(documentation, /daily-command-center-mcp\.marcg129\.workers\.dev/);
  assert.match(documentation, /\/deploy-current-main <merge-sha> <check-run-id>/);
  assert.match(documentation, /accepts the exact command only from the repository owner/);
});

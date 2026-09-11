import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProductWorkspaceId, RequestContext } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import { createHostedStructuredTaskCaptureService, hostedTaskFromCapture } from "@/lib/runtime/hosted-task-capture";
import {
  captureFingerprint,
  createStructuredTaskCaptureService,
  parseStructuredTaskCapture,
  TaskCaptureConflictError,
  type CaptureDuration,
} from "@/lib/runtime/task-capture";
import type { TaskItem } from "@/lib/types";

const now = new Date("2026-09-11T12:00:00.000Z");
const base = { requestId: "hosted-1", workspaceId: "personal", title: "Prepare launch" } as const;

function memoryRepository() {
  const tasks = new Map<string, HostedTask>();
  const visibility = new Map<string, readonly ProductWorkspaceId[]>();
  const repository: HostedTaskRepository = {
    async list(context) {
      return [...tasks.values()].filter((task) => visibility.get(task.taskId)?.includes(context.workspaceId as ProductWorkspaceId));
    },
    async get(context, taskId) {
      const task = tasks.get(taskId);
      return task && visibility.get(taskId)?.includes(context.workspaceId as ProductWorkspaceId) ? structuredClone(task) : null;
    },
    async create(_context, task, visibleIn) {
      if (tasks.has(task.taskId)) throw new Error("duplicate");
      tasks.set(task.taskId, structuredClone(task)); visibility.set(task.taskId, [...visibleIn]);
      return structuredClone(task);
    },
    async update(_context, task) { tasks.set(task.taskId, structuredClone(task)); return structuredClone(task); },
  };
  return { repository, tasks, visibility };
}

test("hosted capture enforces authorized context and canonical visibility", async () => {
  for (const workspaceId of ["personal", "indelitech"] as const) {
    const state = memoryRepository();
    const capture = createHostedStructuredTaskCaptureService(state.repository, { now: () => now });
    const result = await capture({ workspaceId }, { ...base, requestId: `hosted-${workspaceId}`, workspaceId });
    assert.equal(result.created, true);
    assert.equal(result.task.taskId, `capture:hosted-${workspaceId}`);
    assert.equal(result.task.primaryWorkspaceId, workspaceId);
    assert.equal(result.task.source, "send-to-tasks");
    assert.deepEqual(state.visibility.get(result.task.taskId), workspaceId === "personal" ? ["personal"] : ["indelitech", "personal"]);
  }
  const capture = createHostedStructuredTaskCaptureService(memoryRepository().repository, { now: () => now });
  await assert.rejects(capture(undefined as unknown as RequestContext, base), /valid workspace context/);
  await assert.rejects(capture({ workspaceId: "legacy-local" }, base), /hosted product workspace/);
  await assert.rejects(capture({ workspaceId: "indelitech" }, base), /workspace must match/i);
});

test("hosted replay uses immutable capture metadata and never overwrites later edits", async () => {
  const state = memoryRepository();
  const capture = createHostedStructuredTaskCaptureService(state.repository, { now: () => now });
  const input = { ...base, context: "Original", remindAt: "2026-09-12T09:00:00Z" };
  const created = await capture({ workspaceId: "personal" }, input);
  state.tasks.set(created.task.taskId, { ...created.task, title: "Edited", status: "DONE", completedAt: now.toISOString(), remindAt: null });
  const replay = await capture({ workspaceId: "personal" }, input);
  assert.equal(replay.created, false); assert.equal(replay.task.title, "Edited"); assert.equal(replay.task.status, "DONE");
  await assert.rejects(capture({ workspaceId: "personal" }, { ...input, title: "Different" }), TaskCaptureConflictError);
  state.tasks.set("capture:occupied", { ...created.task, taskId: "capture:occupied", source: "manual", captureFingerprint: null });
  state.visibility.set("capture:occupied", ["personal"]);
  await assert.rejects(capture({ workspaceId: "personal" }, { ...base, requestId: "occupied" }), TaskCaptureConflictError);
});

test("hosted conversion preserves capture fields, timing, waiting, recurrence, and shared fingerprint", async () => {
  const input = parseStructuredTaskCapture({
    ...base, requestId: "full", context: "Details", category: "Ops", project: "Launch", person: "Sam",
    type: "WAITING", priority: "HIGH", due: "2026-09-20", remindAt: "2026-09-19T09:00:00-04:00",
    followUpAt: "2026-09-18T10:00:00-04:00", dependency: "Approval", sourceContext: "thread/7",
  });
  const task = hostedTaskFromCapture(input, now.toISOString());
  assert.deepEqual(
    { context: task.context, category: task.category, project: task.project, person: task.person, dependency: task.dependency, sourceContext: task.sourceContext },
    { context: "Details", category: "Ops", project: "Launch", person: "Sam", dependency: "Approval", sourceContext: "thread/7" },
  );
  assert.equal(task.status, "WAITING"); assert.equal(task.dueAt, "2026-09-20"); assert.equal(task.dueIsDateOnly, true);
  assert.equal(task.remindAt, "2026-09-19T13:00:00.000Z"); assert.equal(task.captureFingerprint, captureFingerprint(input));
  const recurring = hostedTaskFromCapture(parseStructuredTaskCapture({ ...base, requestId: "repeat", recurrence: "Weekly", due: "2026-09-20" }), now.toISOString());
  assert.equal(recurring.type, "RECURRING"); assert.equal(recurring.recurrence, "Weekly");

  let localTask: TaskItem | undefined;
  const local = createStructuredTaskCaptureService({ read: async () => [], apply: async (mutations) => {
    localTask = mutations[0].kind === "CREATE" ? mutations[0].task : undefined; return localTask ? [localTask] : [];
  } }, { now: () => now });
  await local(input);
  assert.equal(localTask?.captureFingerprint, task.captureFingerprint);
});

test("hosted duration mapping is numeric-compatible and label-lossless", () => {
  const mappings: Array<[CaptureDuration, number | null]> = [["5m", 5], ["15m", 15], ["30m", 30], ["1h", 60], ["2h+", 120], ["Project", null]];
  for (const [index, [label, minutes]] of mappings.entries()) {
    const task = hostedTaskFromCapture(parseStructuredTaskCapture({ ...base, requestId: `duration-${index}`, estimatedDuration: label }), now.toISOString());
    assert.equal(task.estimatedDuration, minutes); assert.equal(task.estimatedDurationLabel, label);
  }
  const omitted = hostedTaskFromCapture(parseStructuredTaskCapture(base), now.toISOString());
  assert.equal(omitted.estimatedDuration, null); assert.equal(omitted.estimatedDurationLabel, null);
});

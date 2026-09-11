import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createStructuredTaskCaptureService, TaskCaptureConflictError, TaskCaptureValidationError } from "@/lib/runtime/task-capture";
import { diffTaskItems, type TaskMutationRepository } from "@/lib/runtime/task-mutations";
import { createTaskCaptureHandler } from "@/lib/server/task-capture-service";
import { LocalTaskMutationRepository } from "@/lib/server/local-task-mutation-repository";
import { cleanTaskItems, visibleTaskItems } from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";
import { initializeWorkspaceStore } from "@/lib/workspace-store";

const now = new Date("2026-09-11T12:00:00.000Z");
const base = { requestId: "chat:message-1", workspaceId: "personal", title: "File quarterly report" } as const;

function memoryRepository(initial: TaskItem[] = []) {
  const tasks = structuredClone(initial);
  let applies = 0;
  const repository: TaskMutationRepository = {
    async read() { return structuredClone(tasks); },
    async apply(mutations) {
      applies++;
      for (const mutation of mutations) {
        if (mutation.kind !== "CREATE") throw new Error("Unexpected test mutation");
        if (tasks.some(({ id }) => id === mutation.task.id)) throw new Error("Task ID already exists.");
        tasks.push(structuredClone(mutation.task));
      }
      return structuredClone(tasks);
    },
  };
  return { repository, get tasks() { return tasks; }, get applies() { return applies; } };
}

test("task normalization and diff preserve every structured compatibility field", () => {
  const task = cleanTaskItems([{ ...base, id: "one", description: "Context", due: "", recurrence: "One-time",
    priority: "HIGH", primaryWorkspaceId: "personal", done: false, category: " Finance ", project: " Q3 ",
    estimatedDuration: "30m", dependency: " CFO ", source: " send-to-tasks ", sourceContext: " chat/42 " }])[0];
  assert.deepEqual(
    { category: task.category, project: task.project, estimatedDuration: task.estimatedDuration,
      dependency: task.dependency, source: task.source, sourceContext: task.sourceContext },
    { category: "Finance", project: "Q3", estimatedDuration: "30m", dependency: "CFO",
      source: "send-to-tasks", sourceContext: "chat/42" },
  );
  for (const field of ["category", "project", "estimatedDuration", "dependency", "source", "sourceContext"] as const) {
    const changed = { ...task, [field]: `${task[field]}-changed` } as TaskItem;
    assert.equal(diffTaskItems([task], [changed])[0]?.kind, "UPDATE", `${field} should produce an update`);
  }
});

test("Personal and Indelitech captures use canonical ownership and roll-up visibility", async () => {
  for (const workspaceId of ["personal", "indelitech"] as const) {
    const state = memoryRepository();
    const capture = createStructuredTaskCaptureService(state.repository, { now: () => now });
    const result = await capture({ ...base, requestId: `owner-${workspaceId}`, workspaceId });
    assert.equal(result.created, true);
    assert.equal(result.task.primaryWorkspaceId, workspaceId);
    assert.equal(result.task.source, "send-to-tasks");
    assert.equal(visibleTaskItems([result.task], workspaceId).length, 1);
    if (workspaceId === "indelitech") assert.equal(visibleTaskItems([result.task], "personal").length, 1);
  }
});

test("capture requires canonical workspace, title, request ID, and supported fields", async () => {
  const capture = createStructuredTaskCaptureService(memoryRepository().repository, { now: () => now });
  for (const invalid of [
    { ...base, workspaceId: undefined }, { ...base, workspaceId: "legacy-local" },
    { ...base, title: "  " }, { ...base, requestId: "has spaces" },
    { ...base, requestId: "x".repeat(129) }, { ...base, surprise: true },
  ]) await assert.rejects(capture(invalid), TaskCaptureValidationError);
});

test("requestId replay is idempotent while conflicting and non-capture records are protected", async () => {
  const state = memoryRepository();
  const capture = createStructuredTaskCaptureService(state.repository, { now: () => now });
  const first = await capture(base);
  const replay = await capture(structuredClone(base));
  assert.equal(first.created, true); assert.equal(replay.created, false);
  assert.equal(state.applies, 1); assert.equal(state.tasks.length, 1);
  await assert.rejects(capture({ ...base, title: "Different" }), TaskCaptureConflictError);
  assert.equal(state.tasks[0].title, base.title);

  const foreign = cleanTaskItems([{ id: "capture:foreign", title: "Existing", description: "Details", due: "",
    recurrence: "One-time", priority: "MEDIUM", primaryWorkspaceId: "personal", done: false }]);
  const protectedState = memoryRepository(foreign);
  await assert.rejects(
    createStructuredTaskCaptureService(protectedState.repository, { now: () => now })({ ...base, requestId: "foreign" }),
    TaskCaptureConflictError,
  );
  assert.equal(protectedState.applies, 0); assert.equal(protectedState.tasks[0].title, "Existing");
});

test("safe defaults never invent due dates or reminders and preserve context metadata", async () => {
  const capture = createStructuredTaskCaptureService(memoryRepository().repository, { now: () => now });
  const result = await capture({ ...base, context: "From a structured conversation", sourceContext: "thread/123" });
  assert.equal(result.task.priority, "MEDIUM"); assert.equal(result.task.due, "");
  assert.equal(result.task.remindAt, undefined); assert.equal(result.task.type, "ONE_TIME");
  assert.equal(result.task.description, "From a structured conversation");
  assert.equal(result.task.sourceContext, "thread/123"); assert.equal(result.task.source, "send-to-tasks");
});

test("due dates are strict and independent from normalized timestamp reminders", async () => {
  const capture = createStructuredTaskCaptureService(memoryRepository().repository, { now: () => now });
  for (const due of ["tomorrow", "Friday", "next week", "2026-02-31"])
    await assert.rejects(capture({ ...base, requestId: `bad-${due}`, due }), TaskCaptureValidationError);
  const dueOnly = await capture({ ...base, requestId: "due-only", due: "2026-09-15" });
  assert.equal(dueOnly.task.due, "2026-09-15"); assert.equal(dueOnly.task.remindAt, undefined);
  const reminderOnly = await capture({ ...base, requestId: "reminder-only", remindAt: "2026-09-14T09:00:00-04:00" });
  assert.equal(reminderOnly.task.due, ""); assert.equal(reminderOnly.task.remindAt, "2026-09-14T13:00:00.000Z");
});

test("WAITING, recurring, and BACKLOG rules remain deterministic", async () => {
  const capture = createStructuredTaskCaptureService(memoryRepository().repository, { now: () => now });
  await assert.rejects(capture({ ...base, requestId: "waiting-1", type: "WAITING" }), TaskCaptureValidationError);
  await assert.rejects(capture({ ...base, requestId: "waiting-2", type: "WAITING", person: "Alex" }), TaskCaptureValidationError);
  const waiting = await capture({ ...base, requestId: "waiting-ok", type: "WAITING", person: " Alex ", followUpAt: "2026-09-20T09:00:00-04:00" });
  assert.equal(waiting.task.status, "WAITING"); assert.equal(waiting.task.person, "Alex");
  assert.equal(waiting.task.followUpAt, "2026-09-20T13:00:00.000Z");
  await assert.rejects(capture({ ...base, requestId: "repeat-no-due", recurrence: "Weekly" }), TaskCaptureValidationError);
  await assert.rejects(capture({ ...base, requestId: "repeat-wrong-type", recurrence: "Weekly", type: "DEADLINE", due: "2026-09-18" }), TaskCaptureValidationError);
  const recurring = await capture({ ...base, requestId: "repeat-ok", recurrence: "Weekly", due: "2026-09-18" });
  assert.equal(recurring.task.type, "RECURRING"); assert.equal(recurring.task.recurrence, "Weekly");
  const backlog = await capture({ ...base, requestId: "backlog", type: "BACKLOG" });
  assert.equal(backlog.task.type, "BACKLOG"); assert.equal(backlog.task.due, ""); assert.equal(backlog.task.remindAt, undefined);
});

test("capture handler returns interpretation, validation 400, conflict 409, and persistence 500", async () => {
  const state = memoryRepository();
  const handler = createTaskCaptureHandler(state.repository, { now: () => now });
  const request = (body: string) => new Request("http://local/api/tasks/capture", { method: "POST", body });
  const created = await handler(request(JSON.stringify({ ...base, due: "2026-09-15", priority: "HIGH" })));
  assert.equal(created.status, 200);
  const body = await created.json() as { created: boolean; task: TaskItem; interpretation: Record<string, unknown> };
  assert.equal(body.created, true); assert.equal(body.task.id, "capture:chat:message-1");
  assert.deepEqual(body.interpretation, { workspaceId: "personal", type: "DEADLINE", priority: "HIGH",
    due: "2026-09-15", recurrence: "One-time" });
  assert.equal((await handler(request("not-json"))).status, 400);
  assert.equal((await handler(request(JSON.stringify({ ...base, title: "Different" })))).status, 409);
  assert.equal(state.tasks.length, 1);

  const broken = createTaskCaptureHandler({ read: async () => { throw new Error("secret stack"); }, apply: async () => [] }, { now: () => now });
  const response = await broken(request(JSON.stringify(base)));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "Task capture could not be saved safely." });
});

test("local SQLite capture uses one atomic CREATE and keeps exact replay idempotent", async () => {
  const database = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  const repository = new LocalTaskMutationRepository(() => database);
  const capture = createStructuredTaskCaptureService(repository, { now: () => now });
  assert.equal((await capture({ ...base, requestId: "sqlite" })).created, true);
  assert.equal((await capture({ ...base, requestId: "sqlite" })).created, false);
  assert.equal((await repository.read()).length, 1);
  database.close();
});

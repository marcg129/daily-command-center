import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { diffTaskItems } from "@/lib/runtime/task-mutations";
import { OrderedSaveQueue } from "@/lib/runtime/ordered-save-queue";
import { completeTaskItems, cleanTaskItems } from "@/lib/tasks";
import type { TaskItem } from "@/lib/types";
import { LocalTaskMutationRepository } from "@/lib/server/local-task-mutation-repository";
import { createTaskHandlers } from "@/lib/server/task-service";
import { createReminderHandler } from "@/lib/server/reminder-service";
import { initializeWorkspaceStore, readWorkspaceState, writeWorkspaceState } from "@/lib/workspace-store";

const now = "2026-09-11T12:00:00.000Z";
function task(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return cleanTaskItems([{ id, title: `Task ${id}`, description: "Details", due: "2026-09-12", recurrence: "One-time", priority: "MEDIUM", primaryWorkspaceId: "personal", done: false, ...extra }])[0];
}
function setup(tasks: TaskItem[] = [task("one")]) {
  const database = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  writeWorkspaceState(database, { reminders: [{ id: "r", title: "Reminder", type: "Saved", source: "Manual", note: "Note", accent: "teal" }], tasks });
  return { database, repository: new LocalTaskMutationRepository(() => database) };
}

test("task diff is deterministic for identical, create, update, and delete snapshots", () => {
  const one = task("one");
  assert.deepEqual(diffTaskItems([one], structuredClone([one])), []);
  assert.deepEqual(diffTaskItems([], [one]), [{ kind: "CREATE", task: one }]);
  const edited = { ...one, title: "Edited" };
  assert.deepEqual(diffTaskItems([one], [edited]), [{ kind: "UPDATE", taskId: "one", task: edited }]);
  assert.deepEqual(diffTaskItems([one], []), [{ kind: "DELETE", taskId: "one" }]);
});

test("recurring completion is one CREATE plus UPDATE batch and roll-up edits stay UPDATE", () => {
  const series = task("series", { recurrence: "Weekly", type: "RECURRING", primaryWorkspaceId: "indelitech" });
  const completed = completeTaskItems([series], series.id, { now: new Date(now), occurrenceId: "occurrence" });
  assert.deepEqual(diffTaskItems([series], completed).map((item) => item.kind), ["CREATE", "UPDATE"]);
  const rolledUpEdit = { ...series, title: "Edited from Personal" };
  assert.equal(diffTaskItems([series], [rolledUpEdit])[0].kind, "UPDATE");
});

test("ordinary diff cannot delete protected recurring history", () => {
  const occurrence = task("history", { done: true, status: "DONE", seriesId: "series", completedAt: now });
  assert.deepEqual(diffTaskItems([occurrence], []), []);
});

test("task batches validate identity and immutable ownership atomically", async () => {
  const { database, repository } = setup();
  const invalidOwner = { ...task("new"), primaryWorkspaceId: "invalid" } as unknown as TaskItem;
  await assert.rejects(repository.apply([{ kind: "CREATE", task: invalidOwner }], now), /owner is invalid/);
  await assert.rejects(repository.apply([{ kind: "UPDATE", taskId: "one", task: task("two") }], now), /change the task ID/);
  await assert.rejects(repository.apply([{ kind: "UPDATE", taskId: "one", task: { ...task("one"), primaryWorkspaceId: "indelitech" } }], now), /ownership is immutable/);
  await assert.rejects(repository.apply([
    { kind: "UPDATE", taskId: "one", task: { ...task("one"), title: "First" } },
    { kind: "DELETE", taskId: "one" },
  ], now), /only appear once/);
  assert.equal(readWorkspaceState(database).tasks[0].title, "Task one");
  database.close();
});

test("task CREATE initializes the tasks row without creating or changing reminders", async () => {
  const database = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  const repository = new LocalTaskMutationRepository(() => database);

  await repository.apply([{ kind: "CREATE", task: task("first") }], now);

  assert.deepEqual((await repository.read()).map(({ id }) => id), ["first"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM workspace_state WHERE state_key = 'reminders'").get()?.count, 0);
  database.close();
});

test("ordered save queue retries a failed head before later jobs and never replays successes", async () => {
  const queue = new OrderedSaveQueue();
  const calls: string[] = [];
  let attempts = 0;
  let rejectFirst!: (error: Error) => void;
  const firstFailure = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  const first = async () => {
    calls.push(`A${++attempts}`);
    if (attempts === 1) await firstFailure;
  };

  const firstDrain = queue.enqueue(first);
  const queuedBehindIt = queue.enqueue(async () => { calls.push("B"); });
  rejectFirst(new Error("temporary failure"));
  await assert.rejects(firstDrain, /temporary failure/);
  await assert.rejects(queuedBehindIt, /temporary failure/);
  assert.deepEqual(calls, ["A1"]);

  await queue.retry();
  assert.deepEqual(calls, ["A1", "A2", "B"]);
  assert.equal(queue.hasPending, false);

  await queue.retry();
  assert.deepEqual(calls, ["A1", "A2", "B"]);
});

test("a failed later operation rolls back the whole task batch without touching reminders", async () => {
  const { database, repository } = setup();
  const remindersBefore = database.prepare("SELECT payload_json FROM workspace_state WHERE state_key='reminders'").get() as { payload_json: string };
  await assert.rejects(repository.apply([
    { kind: "CREATE", task: task("new") },
    { kind: "DELETE", taskId: "missing" },
  ], now), /does not exist/);
  assert.deepEqual(readWorkspaceState(database).tasks.map(({ id }) => id), ["one"]);
  const remindersAfter = database.prepare("SELECT payload_json FROM workspace_state WHERE state_key='reminders'").get() as { payload_json: string };
  assert.equal(remindersAfter.payload_json, remindersBefore.payload_json);
  database.close();
});

test("active series deletion preserves history and protected history cannot mutate", async () => {
  const series = task("series", { recurrence: "Weekly", type: "RECURRING" });
  const history = task("history", { done: true, status: "DONE", seriesId: "series", completedAt: now });
  const { database, repository } = setup([series, history]);
  const result = await repository.apply([{ kind: "DELETE", taskId: "series" }], now);
  assert.deepEqual(result.map(({ id }) => id), ["history"]);
  await assert.rejects(repository.apply([{ kind: "DELETE", taskId: "history" }], now), /history is immutable/);
  database.close();
});

test("task handlers normalize GET, return mutations, and reject malformed payloads", async () => {
  const { database, repository } = setup();
  const handlers = createTaskHandlers(repository, { now: () => new Date(now) });
  const getBody = await (await handlers.GET()).json() as { tasks: TaskItem[] };
  assert.equal(getBody.tasks[0].priority, "MEDIUM");
  const response = await handlers.POST(new Request("http://local/api/tasks/mutations", { method: "POST", body: JSON.stringify({ mutations: [{ kind: "CREATE", task: task("new") }] }) }));
  assert.deepEqual((await response.json() as { tasks: TaskItem[] }).tasks.map(({ id }) => id), ["one", "new"]);
  const before = readWorkspaceState(database).tasks;
  const malformed = await handlers.POST(new Request("http://local/api/tasks/mutations", { method: "POST", body: JSON.stringify({ mutations: [{ kind: "BOGUS" }] }) }));
  assert.equal(malformed.status, 400);
  assert.deepEqual(readWorkspaceState(database).tasks, before);
  database.close();
});

test("reminder-only handler never rewrites tasks", async () => {
  const { database } = setup();
  const tasksBefore = database.prepare("SELECT payload_json FROM workspace_state WHERE state_key='tasks'").get() as { payload_json: string };
  const put = createReminderHandler(() => database, { now: () => new Date(now) }, { generate: () => "generated" });
  const response = await put(new Request("http://local/api/reminders", { method: "PUT", body: JSON.stringify({ reminders: [{ title: "Changed" }] }) }));
  assert.equal(response.status, 200);
  assert.equal(readWorkspaceState(database).reminders[0].title, "Changed");
  const tasksAfter = database.prepare("SELECT payload_json FROM workspace_state WHERE state_key='tasks'").get() as { payload_json: string };
  assert.equal(tasksAfter.payload_json, tasksBefore.payload_json);
  database.close();
});

test("post-bootstrap client saves use narrow ordered task and reminder paths", async () => {
  const source = await readFile(new URL("../components/control-center.tsx", import.meta.url), "utf8");
  const persistenceStart = source.indexOf("const workspace = { reminders, tasks } satisfies WorkspaceState;");
  assert.notEqual(persistenceStart, -1);
  const persistence = source.slice(persistenceStart, source.indexOf("if (!toast)"));
  assert.match(persistence, /const mutationEndpoint = taskMutationEndpoint\(runtimeMode, mutationWorkspaceId\)/);
  assert.match(persistence, /fetchHostedWithSessionRefresh\(fetch, mutationEndpoint/);
  assert.match(persistence, /: await fetch\(mutationEndpoint/);
  assert.match(persistence, /body: JSON\.stringify\(\{ mutations \}\)/);
  assert.match(persistence, /fetch\("\/api\/reminders"/);
  assert.match(persistence, /body: JSON\.stringify\(\{ reminders \}\)/);
  assert.doesNotMatch(persistence, /fetch\("\/api\/workspace"/);
  assert.match(persistence, /taskSaveQueue\.current\.enqueue\(save\)/);
  assert.match(source, /Retry saves/);
});

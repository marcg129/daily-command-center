import assert from "node:assert/strict";
import test from "node:test";
import { cancelTask, cleanTaskItems, completeTaskItems, markTaskWaiting, resumeTask, setTaskReminder, sortTaskAttention, taskHorizon, taskIsActive, updateTaskItem } from "../lib/tasks";
import { isoToProductWallClock, productWallClockToIso, reminderPresetIso } from "../lib/product-time";
import type { TaskItem } from "../lib/types";

const now = new Date("2026-09-11T16:00:00.000Z");
function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return { id: "task", title: "Task", description: "Details", due: "2026-09-12", recurrence: "One-time", priority: "MEDIUM", primaryWorkspaceId: "personal", done: false, status: "OPEN", type: "DEADLINE", createdAt: "2026-09-01T00:00:00.000Z", ...overrides };
}

test("legacy state and type normalization follows compatible deterministic rules", () => {
  const [done, open, recurring, dated] = cleanTaskItems([
    { id: 1, title: "done", done: true }, { id: 2, title: "open", done: false, due: "" },
    { id: 3, title: "repeat", recurrence: "Monthly" }, { id: 4, title: "dated", due: "2026-10-01" },
  ]);
  assert.equal(done.status, "DONE"); assert.equal(open.status, "OPEN");
  assert.equal(recurring.type, "RECURRING"); assert.equal(dated.type, "DEADLINE");
});

test("due dates and manual reminders are independent in both directions", () => {
  const original = task({ remindAt: "2026-09-12T13:00:00.000Z" });
  const snoozed = setTaskReminder([original], original.id, "2026-09-13T13:00:00Z", now)[0];
  assert.equal(snoozed.due, original.due); assert.equal(snoozed.remindAt, "2026-09-13T13:00:00.000Z");
  const dueChanged = updateTaskItem([snoozed], original.id, { due: "2026-09-20" }, now)[0];
  assert.equal(dueChanged.remindAt, snoozed.remindAt);
});

test("waiting validates required fields, stays out of attention until due, and resume restores open type", () => {
  assert.throws(() => markTaskWaiting([task()], "task", "", "2026-09-12T13:00:00Z", now));
  assert.throws(() => markTaskWaiting([task()], "task", "Alex", "invalid", now));
  const waiting = markTaskWaiting([task()], "task", " Alex ", "2026-09-12T13:00:00Z", now)[0];
  assert.equal(waiting.status, "WAITING"); assert.equal(waiting.type, "WAITING"); assert.equal(waiting.person, "Alex");
  assert.deepEqual(sortTaskAttention([waiting], now), []);
  assert.deepEqual(sortTaskAttention([{ ...waiting, due: "2026-09-10" }], now), []);
  assert.equal(sortTaskAttention([waiting], new Date("2026-09-12T13:00:00Z"))[0].id, "task");
  const resumed = resumeTask([waiting], "task", now)[0];
  assert.equal(resumed.status, "OPEN"); assert.equal(resumed.type, "DEADLINE");
  assert.equal(resumed.followUpAt, undefined); assert.equal(resumed.person, "Alex");
  const recurringWaiting = markTaskWaiting([task({ recurrence: "Monthly", type: "RECURRING" })], "task", "Alex", "2026-09-12T13:00:00Z", now)[0];
  assert.equal(resumeTask([recurringWaiting], "task", now)[0].type, "RECURRING");
});

test("waiting tasks remain in the due-driven horizon before follow-up is due", () => {
  const waiting = markTaskWaiting([task({ due: "2026-09-18" })], "task", "Alex", "2026-09-20T13:00:00Z", now)[0];
  assert.deepEqual(sortTaskAttention([waiting], now), []);
  assert.deepEqual(taskHorizon([waiting], now).get("NEXT_7_DAYS")?.map(({ id }) => id), ["task"]);
});

test("cancel preserves the record but removes it from attention and horizon; deletion remains removal", () => {
  const cancelled = cancelTask([task()], "task", now);
  assert.equal(cancelled.length, 1); assert.equal(cancelled[0].status, "CANCELLED"); assert.equal(cancelled[0].done, false);
  assert.deepEqual(sortTaskAttention(cancelled, now), []); assert.equal([...taskHorizon(cancelled, now).values()].flat().length, 0);
  assert.deepEqual(cancelled.filter(({ id }) => id !== "task"), []);
});

test("active task semantics exclude done and cancelled while retaining open and waiting", () => {
  assert.equal(taskIsActive(task({ status: "OPEN" })), true);
  assert.equal(taskIsActive(task({ status: "WAITING" })), true);
  assert.equal(taskIsActive(task({ status: "DONE", done: true })), false);
  assert.equal(taskIsActive(task({ status: "CANCELLED", done: false })), false);
});

test("attention ordering is overdue, due follow-up, due reminder, then stored priority", () => {
  const values = [
    task({ id: "high", priority: "HIGH", due: "" }),
    task({ id: "future", priority: "LOW", due: "", remindAt: "2026-09-12T13:00:00Z" }),
    task({ id: "reminder", priority: "LOW", due: "", remindAt: "2026-09-11T15:00:00Z" }),
    task({ id: "follow", status: "WAITING", priority: "LOW", followUpAt: "2026-09-11T14:00:00Z" }),
    task({ id: "overdue", priority: "LOW", due: "2026-09-10" }),
    task({ id: "done", done: true, status: "DONE" }), task({ id: "cancelled", status: "CANCELLED" }),
  ];
  assert.deepEqual(sortTaskAttention(values, now).map(({ id }) => id), ["overdue", "follow", "reminder", "high", "future"]);
  assert.equal([...taskHorizon(values, now).values()].flat().some(({ id }) => id === "done" || id === "cancelled"), false);
});

test("recurring completion retains ownership and rich status semantics", () => {
  const values = completeTaskItems([task({ recurrence: "Monthly", primaryWorkspaceId: "indelitech" })], "task", { now, occurrenceId: "occurrence" });
  assert.deepEqual(values.map(({ primaryWorkspaceId }) => primaryWorkspaceId), ["indelitech", "indelitech"]);
  assert.equal(values.find(({ id }) => id === "occurrence")?.status, "DONE");
  assert.equal(values.find(({ id }) => id === "task")?.status, "OPEN");
  assert.equal(values.find(({ id }) => id === "task")?.type, "RECURRING");
});

test("New York wall-clock conversion is deterministic across DST boundaries", () => {
  assert.equal(productWallClockToIso("2026-03-08T01:30"), "2026-03-08T06:30:00.000Z");
  assert.throws(() => productWallClockToIso("2026-03-08T02:30"), /does not exist/);
  assert.equal(productWallClockToIso("2026-03-08T03:30"), "2026-03-08T07:30:00.000Z");
  assert.equal(productWallClockToIso("2026-11-01T01:30"), "2026-11-01T05:30:00.000Z");
  assert.equal(isoToProductWallClock("2026-11-01T06:30:00.000Z"), "2026-11-01T01:30");
  assert.equal(reminderPresetIso("TOMORROW_MORNING", new Date("2026-03-07T17:00:00Z")), "2026-03-08T13:00:00.000Z");
  assert.equal(reminderPresetIso("NEXT_BUSINESS_DAY", new Date("2026-09-11T16:00:00Z")), "2026-09-14T13:00:00.000Z");
});

test("primary navigation does not contain a Reminders destination", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../lib/workspace-ui.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /pageId:\s*["']reminders["']/i);
});

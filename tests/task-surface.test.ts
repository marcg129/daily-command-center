import assert from "node:assert/strict";
import test from "node:test";
import { INDELITECH_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, taskVisibleInWorkspace } from "../lib/runtime/context";
import { cleanTaskItems, completeTaskItems, createTaskItem, nextRecurringDue, normalizeTaskPriority, recurringTaskRequiresDue, sortTaskAttention, taskHorizon, taskIsOverdue, visibleTaskItems } from "../lib/tasks";
import type { TaskItem } from "../lib/types";

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return { id: "task", title: "Task", description: "Details", due: "2026-09-11", recurrence: "One-time", priority: "MEDIUM", primaryWorkspaceId: "personal", done: false, createdAt: "2026-09-01T00:00:00Z", ...overrides };
}

test("legacy ownership and priority normalize safely", () => {
  const [missing, invalid] = cleanTaskItems([item({ primaryWorkspaceId: undefined, priority: "Normal" }), { ...item({ id: "bad" }), primaryWorkspaceId: "other", priority: "unknown" }]);
  assert.equal(missing.primaryWorkspaceId, PERSONAL_WORKSPACE_ID); assert.equal(invalid.primaryWorkspaceId, PERSONAL_WORKSPACE_ID);
  assert.equal(missing.priority, "MEDIUM"); assert.equal(invalid.priority, "MEDIUM");
  assert.deepEqual(["High", "Medium", "Normal", "Low"].map(normalizeTaskPriority), ["HIGH", "MEDIUM", "MEDIUM", "LOW"]);
});

test("one shared visibility policy implements the Personal roll-up", () => {
  assert.equal(taskVisibleInWorkspace("personal", "personal"), true);
  assert.equal(taskVisibleInWorkspace("personal", "indelitech"), false);
  assert.equal(taskVisibleInWorkspace("indelitech", "indelitech"), true);
  assert.equal(taskVisibleInWorkspace("indelitech", "personal"), true);
  const business = item({ id: "business", primaryWorkspaceId: "indelitech" });
  const tasks = [item({ id: "personal" }), business];
  assert.deepEqual(visibleTaskItems(tasks, "personal").map(({ id }) => id), ["personal", "business"]);
  assert.deepEqual(visibleTaskItems(tasks, "indelitech").map(({ id }) => id), ["business"]);
  assert.equal(visibleTaskItems(tasks, "personal").filter(({ id }) => id === "business").length, 1);
});

test("completing a rolled-up task mutates its same id and preserves recurring ownership", () => {
  const task = item({ id: "business", primaryWorkspaceId: "indelitech", recurrence: "Weekly" });
  const visible = visibleTaskItems([task], "personal");
  const result = completeTaskItems([task], visible[0].id, { now: new Date("2026-09-11T16:00:00Z"), occurrenceId: "occurrence" });
  assert.equal(result.find(({ id }) => id === "business")?.primaryWorkspaceId, INDELITECH_WORKSPACE_ID);
  assert.equal(result.find(({ id }) => id === "occurrence")?.primaryWorkspaceId, INDELITECH_WORKSPACE_ID);
  assert.equal(result.find(({ id }) => id === "occurrence")?.done, true);
  assert.equal(result.filter(({ id }) => id === "business").length, 1);
});

test("quick-add ownership follows its active workspace and due date remains optional", () => {
  const personal = createTaskItem({ title: "Personal", due: "", priority: "MEDIUM" }, "personal", "p", new Date(0));
  const business = createTaskItem({ title: "Business", due: "", priority: "HIGH" }, "indelitech", "b", new Date(0));
  assert.equal(personal.primaryWorkspaceId, "personal"); assert.equal(business.primaryWorkspaceId, "indelitech"); assert.equal(personal.due, "");
});

test("overdue attention is computed above HIGH without changing priority", () => {
  const now = new Date("2026-09-11T16:00:00Z");
  const overdue = item({ id: "overdue", due: "2026-09-10", priority: "LOW" });
  const high = item({ id: "high", due: "2026-09-11", priority: "HIGH" });
  assert.equal(taskIsOverdue(high, now), false); assert.equal(taskIsOverdue(overdue, now), true);
  assert.deepEqual(sortTaskAttention([high, overdue], now).map(({ id }) => id), ["overdue", "high"]);
  assert.equal(overdue.priority, "LOW");
});

test("45-day horizon honors every boundary and excludes completed, unscheduled, and later tasks", () => {
  const now = new Date("2026-09-11T16:00:00Z");
  const dates = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-18", "2026-09-19", "2026-09-25", "2026-09-26", "2026-10-11", "2026-10-12", "2026-10-26", "2026-10-27"];
  const horizon = taskHorizon(dates.map((due, index) => item({ id: String(index), due })), now);
  assert.deepEqual([...horizon].map(([group, tasks]) => [group, tasks.length]), [["OVERDUE",1],["TODAY",1],["NEXT_7_DAYS",2],["DAYS_8_14",2],["DAYS_15_30",2],["DAYS_31_45",2]]);
  const excluded = taskHorizon([item({ due: "2026-10-27" }), item({ id: "none", due: "" }), item({ id: "done", done: true })], now);
  assert.equal([...excluded.values()].flat().length, 0);
});

test("legacy Today due values remain in the product day's horizon", () => {
  const now = new Date("2026-09-12T01:00:00Z");
  const [legacy] = cleanTaskItems([{ id: "legacy", title: "Legacy task" }]);
  assert.equal(legacy.due, "Today");
  assert.deepEqual(taskHorizon([legacy], now).get("TODAY")?.map(({ id }) => id), ["legacy"]);
  assert.equal(taskIsOverdue(legacy, now), false);
});

test("recurrence advances from the New York product date at a UTC boundary", () => {
  const beforeNewYorkMidnight = new Date("2026-09-12T01:00:00Z");
  assert.equal(nextRecurringDue("2026-09-11", "Daily", beforeNewYorkMidnight), "2026-09-12");
});

test("only recurring schedules require a due date", () => {
  assert.equal(recurringTaskRequiresDue("One-time"), false);
  for (const recurrence of ["Daily", "Weekly", "Monthly"])
    assert.equal(recurringTaskRequiresDue(recurrence), true);
});

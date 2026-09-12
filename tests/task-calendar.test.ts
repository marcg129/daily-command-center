import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { monthCalendarDays, shiftCalendarMonth, taskCalendarEntries } from "../lib/task-calendar";
import type { TaskItem } from "../lib/types";

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return { id: "task", title: "Canonical task", description: "Details", due: "2026-09-15", recurrence: "One-time", priority: "HIGH", primaryWorkspaceId: "personal", done: false, status: "OPEN", ...overrides };
}

test("projects due dates, reminders, and follow-ups without creating task records", () => {
  const source = task({ remindAt: "2026-09-14T13:00:00Z", followUpAt: "2026-09-16T14:00:00Z", status: "WAITING" });
  const entries = taskCalendarEntries([source], "personal", new Date("2026-09-12T16:00:00Z"));
  assert.deepEqual(entries.map(({ kind, date }) => [kind, date]), [["REMINDER", "2026-09-14"], ["DUE", "2026-09-15"], ["FOLLOW_UP", "2026-09-16"]]);
  assert.ok(entries.every((entry) => entry.task === source && entry.taskId === source.id));
});

test("uses the existing Personal roll-up and Indelitech-only visibility", () => {
  const personal = task({ id: "personal", primaryWorkspaceId: "personal" });
  const business = task({ id: "business", primaryWorkspaceId: "indelitech" });
  assert.deepEqual(taskCalendarEntries([personal, business], "personal").map(({ taskId }) => taskId), ["business", "personal"]);
  assert.deepEqual(taskCalendarEntries([personal, business], "indelitech").map(({ taskId }) => taskId), ["business"]);
});

test("shows only active canonical series rows and preserves their identity", () => {
  const series = task({ id: "series", recurrence: "Weekly", type: "RECURRING" });
  const occurrence = task({ id: "occurrence", done: true, status: "DONE", seriesId: "series" });
  const cancelled = task({ id: "cancelled", status: "CANCELLED" });
  const entries = taskCalendarEntries([occurrence, series, cancelled], "personal");
  assert.deepEqual(entries.map(({ taskId }) => taskId), ["series"]);
});

test("marks past due, reminder, and follow-up entries as overdue", () => {
  const now = new Date("2026-09-15T16:00:00Z");
  const entries = taskCalendarEntries([task({ due: "2026-09-14", remindAt: "2026-09-15T15:00:00Z", followUpAt: "2026-09-15T14:00:00Z", status: "WAITING" })], "personal", now);
  assert.ok(entries.every(({ overdue }) => overdue));
});

test("builds stable six-week month grids across year boundaries", () => {
  const december = monthCalendarDays("2026-12");
  assert.equal(december.length, 42);
  assert.equal(december[0], "2026-11-29");
  assert.equal(december.at(-1), "2027-01-09");
  assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(shiftCalendarMonth("2026-01", -1), "2025-12");
});

test("calendar activation opens and focuses the canonical Tasks row", async () => {
  const [control, surface] = await Promise.all([
    readFile(new URL("../components/control-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(control, /onOpenTask=\{\(taskId\) => \{ setFocusedTaskId\(taskId\); goTo\("tasks"\); \}\}/);
  assert.match(control, /focused=\{task\.id === focusedTaskId\}/);
  assert.match(surface, /rowRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

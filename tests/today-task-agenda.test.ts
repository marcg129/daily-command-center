import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { taskCalendarEntriesForToday } from "../lib/task-calendar";
import type { TaskItem } from "../lib/types";

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task",
    title: "Task",
    description: "Details",
    due: "2026-09-13",
    recurrence: "One-time",
    priority: "MEDIUM",
    primaryWorkspaceId: "personal",
    done: false,
    status: "OPEN",
    ...overrides,
  };
}

const now = new Date("2026-09-12T16:00:00Z");

test("Today agenda reuses canonical calendar projection and workspace visibility", () => {
  const personalDue = task({ id: "personal-due", due: "2026-09-12", priority: "HIGH" });
  const businessReminder = task({
    id: "business-reminder",
    primaryWorkspaceId: "indelitech",
    remindAt: "2026-09-12T13:00:00Z",
  });
  const tomorrow = task({ id: "tomorrow", due: "2026-09-13" });
  const completed = task({ id: "done", due: "2026-09-12", done: true, status: "DONE" });
  const tasks = [personalDue, businessReminder, tomorrow, completed];

  const personal = taskCalendarEntriesForToday(tasks, "personal", now);
  assert.deepEqual(personal.map(({ taskId, kind }) => [taskId, kind]), [
    ["business-reminder", "REMINDER"],
    ["personal-due", "DUE"],
  ]);
  assert.equal(personal[0].task, businessReminder);
  assert.equal(personal[1].task, personalDue);

  const indelitech = taskCalendarEntriesForToday(tasks, "indelitech", now);
  assert.deepEqual(indelitech.map(({ taskId, kind }) => [taskId, kind]), [["business-reminder", "REMINDER"]]);
});

test("Today agenda keeps timed ordering and current-day overdue state", () => {
  const source = task({
    id: "waiting",
    due: "2026-09-12",
    status: "WAITING",
    remindAt: "2026-09-12T13:00:00Z",
    followUpAt: "2026-09-12T15:00:00Z",
  });
  const entries = taskCalendarEntriesForToday([source], "personal", now);
  assert.deepEqual(entries.map(({ kind }) => kind), ["REMINDER", "FOLLOW_UP", "DUE"]);
  assert.equal(entries[0].overdue, true);
  assert.equal(entries[1].overdue, true);
  assert.equal(entries[2].overdue, false);
  assert.ok(entries.every((entry) => entry.task === source && entry.taskId === source.id));
});

test("Today UI opens canonical tasks and does not create a parallel record", async () => {
  const [agenda, surface] = await Promise.all([
    readFile(new URL("../components/today-task-agenda.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(agenda, /taskCalendarEntriesForToday\(tasks, workspaceId\)/);
  assert.match(agenda, /visibleEntries = entries\.slice\(0, 6\)/);
  assert.match(agenda, /aria-label="Today's task schedule"/);
  assert.match(agenda, /onClick=\{\(\) => onOpenTask\(entry\.taskId\)\}/);
  assert.match(agenda, /Due dates, reminders &amp; follow-ups/);
  assert.doesNotMatch(agenda, /createTask|cloneTask|duplicateTask|fetch\(/);
  assert.match(surface, /<TodayTaskAgenda tasks=\{tasks\} workspaceId=\{workspaceId\} onOpenTask=\{onOpenTask\} \/>/);
});

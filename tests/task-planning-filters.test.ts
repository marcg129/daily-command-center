import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  taskPlanningDueBucket,
  taskPlanningDurationBucket,
  taskPlanningItems,
  type TaskPlanningFilters,
} from "../lib/task-planning";
import type { TaskItem } from "../lib/types";

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task",
    title: "Task",
    description: "Details",
    due: "2026-09-12",
    recurrence: "One-time",
    priority: "MEDIUM",
    primaryWorkspaceId: "personal",
    done: false,
    status: "OPEN",
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-09-12T16:00:00Z");

test("planning due buckets reuse the canonical task horizon boundaries", () => {
  assert.equal(taskPlanningDueBucket(item({ due: "2026-09-11" }), now), "OVERDUE");
  assert.equal(taskPlanningDueBucket(item({ due: "2026-09-12" }), now), "TODAY");
  assert.equal(taskPlanningDueBucket(item({ due: "2026-09-13" }), now), "NEXT_7_DAYS");
  assert.equal(taskPlanningDueBucket(item({ due: "2026-09-20" }), now), "LATER");
  assert.equal(taskPlanningDueBucket(item({ due: "" }), now), "UNSCHEDULED");
});

test("planning duration buckets preserve the six canonical estimate values", () => {
  for (const value of ["5m", "15m", "30m"] as const)
    assert.equal(taskPlanningDurationBucket(item({ estimatedDuration: value })), "QUICK");
  assert.equal(taskPlanningDurationBucket(item({ estimatedDuration: "1h" })), "ONE_HOUR");
  assert.equal(taskPlanningDurationBucket(item({ estimatedDuration: "2h+" })), "LONG");
  assert.equal(taskPlanningDurationBucket(item({ estimatedDuration: "Project" })), "LONG");
  assert.equal(taskPlanningDurationBucket(item({ estimatedDuration: undefined })), "UNESTIMATED");
});

test("planning filters run after workspace visibility and cannot bypass Personal/Indelitech boundaries", () => {
  const tasks = [
    item({ id: "personal-high", priority: "HIGH", estimatedDuration: "15m" }),
    item({ id: "personal-low", priority: "LOW", estimatedDuration: "1h" }),
    item({ id: "business-high", primaryWorkspaceId: "indelitech", priority: "HIGH", estimatedDuration: "15m" }),
    item({ id: "business-done", primaryWorkspaceId: "indelitech", priority: "HIGH", done: true, status: "DONE" }),
  ];
  const filters: TaskPlanningFilters = { priority: "HIGH", due: "TODAY", duration: "QUICK" };

  assert.deepEqual(taskPlanningItems(tasks, "personal", filters, now).map(({ id }) => id), ["personal-high", "business-high"]);
  assert.deepEqual(taskPlanningItems(tasks, "indelitech", filters, now).map(({ id }) => id), ["business-high"]);
  assert.deepEqual(taskPlanningItems(tasks, "indelitech", { ...filters, priority: "LOW", duration: "ONE_HOUR" }, now), []);
});

test("task surface exposes accessible planning controls and row buckets without replacing canonical rows", async () => {
  const source = await readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/task-planning-filters.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label="Task planning filters"/);
  assert.match(source, /aria-label="Filter tasks by priority"/);
  assert.match(source, /aria-label="Filter tasks by due window"/);
  assert.match(source, /aria-label="Filter tasks by estimated duration"/);
  assert.match(source, /data-planning-due=\{planningFilterValue\(taskPlanningDueBucket\(task\)\)\}/);
  assert.match(source, /data-planning-duration=\{planningFilterValue\(taskPlanningDurationBucket\(task\)\)\}/);
  assert.match(css, /\.task-list \.task-row:not\(\[data-priority="high"\]\)/);
  assert.match(css, /data-planning-due="next-7-days"/);
  assert.match(css, /data-planning-duration="unestimated"/);
  assert.match(layout, /import "\.\/task-planning-filters\.css"/);
  assert.doesNotMatch(source, /cloneTask|copyTask|duplicateTask/);
});

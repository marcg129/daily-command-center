import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { taskOverdueAgeDays, taskOverdueBadgeLabel } from "@/lib/task-overdue-ui";
import type { TaskItem } from "@/lib/types";

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task",
    title: "Task",
    description: "Details",
    due: "2026-09-12",
    recurrence: "One-time",
    priority: "LOW",
    primaryWorkspaceId: "personal",
    done: false,
    status: "OPEN",
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-09-13T16:00:00Z");

test("overdue age labels use product calendar days with correct singular and plural copy", () => {
  assert.equal(taskOverdueAgeDays(item(), now), 1);
  assert.equal(taskOverdueBadgeLabel(item(), now), "OVERDUE · 1 DAY");
  assert.equal(taskOverdueBadgeLabel(item({ due: "2026-09-10" }), now), "OVERDUE · 3 DAYS");
  assert.equal(taskOverdueBadgeLabel(item({ due: "2026-09-13" }), now), null);
});

test("same-day overdue timestamps are explicit without inventing a full calendar day", () => {
  const timestamp = item({ due: "2026-09-13T10:00:00-04:00" });
  assert.equal(taskOverdueAgeDays(timestamp, now), 0);
  assert.equal(taskOverdueBadgeLabel(timestamp, now), "OVERDUE · TODAY");
});

test("Today and task rows expose overdue badges, count, horizon treatment, and separate priority", async () => {
  const surface = await readFile(new URL("../components/task-surface.tsx", import.meta.url), "utf8");
  assert.match(surface, /const overdueCount = attention\.filter\(\(task\) => taskIsOverdue\(task\)\)\.length/);
  assert.match(surface, /className="overdue-count-badge"/);
  assert.match(surface, /className="overdue-badge"/);
  assert.match(surface, /className={overdue \? "is-overdue" : undefined}/);
  assert.match(surface, /group === "OVERDUE" \? "is-overdue" : undefined/);
  assert.match(surface, /<PriorityBadge priority={task\.priority} \/>/);
  assert.match(surface, /taskOverdueBadgeLabel\(task\)/);
});

test("overdue styles are explicit in both themes, restrained, and motion-free", async () => {
  const [layout, css] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/overdue-visibility.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /import "\.\/overdue-visibility\.css"/);
  assert.match(css, /:root \{[\s\S]*--overdue-bg:[\s\S]*--overdue-border:[\s\S]*--overdue-ink:/);
  assert.match(css, /\[data-theme="dark"\] \{[\s\S]*--overdue-bg:[\s\S]*--overdue-border:[\s\S]*--overdue-ink:/);
  assert.match(css, /\.attention-list button\.is-overdue \{[\s\S]*border-left: 4px solid var\(--overdue-border\);[\s\S]*background:/);
  assert.match(css, /\.horizon-groups button\.is-overdue \{[\s\S]*background: var\(--overdue-bg\);/);
  assert.match(css, /\.task-row\.is-overdue \{[\s\S]*border-left: 4px solid var\(--overdue-border\);/);
  assert.doesNotMatch(css, /@keyframes|animation(?:-name)?\s*:/i);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  const url = new URL(`../${path}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("Calendar has a distinct hosted EVENT projection and Upcoming 45-day view", () => {
  const calendar = source("components/task-calendar.tsx");
  const hook = source("components/use-projected-events.ts");
  const eventItem = source("components/calendar-event-item.tsx");

  assert.match(calendar, /source:\s*"EVENT"/);
  assert.match(calendar, /"month"\s*\|\s*"agenda"\s*\|\s*"upcoming"/);
  assert.match(calendar, />Upcoming</);
  assert.match(calendar, /useProjectedEvents/);

  assert.match(hook, /45/);
  assert.match(hook, /workspaceId=personal/);
  assert.match(hook, /workspaceId=indelitech/);
  assert.doesNotMatch(hook, /workspaceId=all/i);

  assert.match(eventItem, /Primary Calendar/);
  assert.match(eventItem, /Family Calendar/);
  assert.match(eventItem, /seriesId/);
  assert.doesNotMatch(eventItem, /priority-/);
  assert.doesNotMatch(eventItem, /is-overdue/);
});

test("Upcoming groups events by date and keeps Personal, Indelitech, and All explicit", () => {
  const calendar = source("components/task-calendar.tsx");
  assert.match(calendar, /Map\.groupBy/);
  for (const label of ["Personal", "Indelitech", "All"]) assert.match(calendar, new RegExp(`>${label}<`));
  assert.match(calendar, /resolvedWorkspaceId/);
});

test("event workspace correction defaults recurring events to the whole series and offers occurrence-only", () => {
  const eventItem = source("components/calendar-event-item.tsx");
  const hook = source("components/use-projected-events.ts");

  assert.match(eventItem, /seriesId[^\n]*"SERIES"/);
  assert.match(eventItem, /OCCURRENCE/);
  assert.match(eventItem, /This occurrence only|Occurrence only/i);
  assert.match(hook, /method:\s*"PATCH"/);
  assert.match(hook, /\/api\/hosted\/events/);
});

test("related Intake and approved Task targets stay linked to the projected event", () => {
  const eventItem = source("components/calendar-event-item.tsx");
  assert.match(eventItem, /relatedIntake/);
  assert.match(eventItem, /approvedTargetKind\s*===\s*"TASK"/);
  assert.match(eventItem, /approvedTargetId/);
  assert.match(eventItem, /onOpenTask/);
});

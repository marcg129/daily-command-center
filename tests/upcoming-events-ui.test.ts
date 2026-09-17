import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("projected event hook reads only authorized logical workspaces across a bounded 45-day window", () => {
  const hook = source("components/use-projected-events.ts");
  assert.match(hook, /ProductWorkspaceId \| "all"/);
  assert.match(hook, /\/api\/hosted\/events\?workspaceId=/);
  assert.match(hook, /fromDate=/);
  assert.match(hook, /throughDate=/);
  assert.match(hook, /45-day|45 day|addCalendarDays\([^,]+, 44\)/i);
  assert.match(hook, /authorizedWorkspaceIds/);
  assert.doesNotMatch(hook, /workspaceId=all/i);
});

test("Calendar projection adds EVENT without borrowing task completion, priority, or overdue semantics", () => {
  const calendar = source("components/task-calendar.tsx");
  const eventItem = source("components/calendar-event-item.tsx");
  assert.match(calendar, /source: "EVENT"/);
  assert.match(calendar, /eventEntry:/);
  assert.match(calendar, /<CalendarEventItem/);
  assert.doesNotMatch(eventItem, /priority-/);
  assert.doesNotMatch(eventItem, /is-overdue/);
  assert.doesNotMatch(eventItem, /checkbox|done|complete/i);
});

test("Upcoming is a dedicated 45-day event view with Personal, Indelitech, and All filters", () => {
  const calendar = source("components/task-calendar.tsx");
  assert.match(calendar, /"month" \| "agenda" \| "upcoming"/);
  assert.match(calendar, />Upcoming</);
  assert.match(calendar, />Personal</);
  assert.match(calendar, />Indelitech</);
  assert.match(calendar, />All</);
  assert.match(calendar, /Map\.groupBy\(.*event/i);
});

test("event cards identify source calendar and recurrence and expose related Intake and approved Tasks", () => {
  const eventItem = source("components/calendar-event-item.tsx");
  assert.match(eventItem, /Primary Calendar/);
  assert.match(eventItem, /Family Calendar/);
  assert.match(eventItem, /seriesId/);
  assert.match(eventItem, /relatedIntake/);
  assert.match(eventItem, /approvedTargetKind === "TASK"/);
  assert.match(eventItem, /onOpenTask/);
  assert.match(eventItem, /onOpenIntake/);
});

test("workspace correction defaults recurring events to SERIES while keeping OCCURRENCE explicit", () => {
  const eventItem = source("components/calendar-event-item.tsx");
  const hook = source("components/use-projected-events.ts");
  assert.match(eventItem, /seriesId \? "SERIES" : "OCCURRENCE"/);
  assert.match(eventItem, />Whole series</);
  assert.match(eventItem, />This occurrence only</);
  assert.match(hook, /method: "PATCH"/);
  assert.match(hook, /scope/);
  assert.match(hook, /clear/);
});

test("month and agenda retain canonical Tasks and Bills while including projected Google events", () => {
  const calendar = source("components/task-calendar.tsx");
  assert.match(calendar, /source: "TASK"/);
  assert.match(calendar, /source: "BILL"/);
  assert.match(calendar, /source: "EVENT"/);
  assert.match(calendar, /projectedEvents\.events/);
  assert.match(calendar, /Calendar items do not create separate records/);
});

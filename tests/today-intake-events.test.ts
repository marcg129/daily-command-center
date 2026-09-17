import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Today Events stays lightweight with today's events and a compact seven-day preview", () => {
  const view = source("components/today-events.tsx");
  assert.match(view, /useProjectedEvents\("all"\)/);
  assert.match(view, /Today['’]s Events/);
  assert.match(view, /Next 7 days/);
  assert.match(view, /projectedCalendarEventDate/);
  assert.match(view, /addCalendarDays\(today, 7\)/);
  assert.match(view, /\.toSorted\(/);
  assert.match(view, /\.slice\(0, [1-9]\d*\)/);
  assert.doesNotMatch(view, /45-day|45 day/i);
});

test("Today event cards remain projections without task completion or overdue treatment", () => {
  const view = source("components/today-events.tsx");
  assert.match(view, /resolvedWorkspaceId/);
  assert.match(view, /Primary Calendar/);
  assert.match(view, /Family Calendar/);
  assert.doesNotMatch(view, /checkbox/i);
  assert.doesNotMatch(view, /is-overdue|overdue/i);
  assert.doesNotMatch(view, /completeTask|done\s*=/i);
});

test("Today Intake summary reports the current workspace pending count and opens Intake", () => {
  const view = source("components/today-intake-summary.tsx");
  assert.match(view, /useIntake\(/);
  assert.match(view, /viewMode:\s*"PENDING"/);
  assert.match(view, /scope:\s*workspaceId/);
  assert.match(view, /onOpenIntake/);
  assert.match(view, /items\.length/);
  assert.match(view, /Personal|Indelitech/);
});

test("Today Intake discloses failed or unknown source freshness without hiding the review count", () => {
  const view = source("components/today-intake-summary.tsx");
  assert.match(view, /source\.state === "FAILED"/);
  assert.match(view, /source\.state === "UNKNOWN"/);
  assert.match(view, /freshnessError/);
  assert.match(view, /error/);
  assert.match(view, /items\.length/);
});

test("Today mounts focused event and Intake components without moving provider logic into control-center", () => {
  const control = source("components/control-center.tsx");
  assert.match(control, /import \{ TodayEvents \} from "@\/components\/today-events"/);
  assert.match(control, /import \{ TodayIntakeSummary \} from "@\/components\/today-intake-summary"/);
  assert.match(control, /<TodayEvents[^>]*workspaceId=\{workspaceId\}/);
  assert.match(control, /<TodayIntakeSummary[^>]*workspaceId=\{workspaceId\}/);
  assert.match(control, /onOpenIntake=\{\(\) => goTo\("intake"\)\}/);
  assert.doesNotMatch(control, /fetch\("\/api\/hosted\/events/);
  assert.doesNotMatch(control, /fetch\("\/api\/hosted\/intake/);
});

test("Today event and Intake styles are responsive and keep their own component boundaries", () => {
  const eventsCss = source("components/today-events.module.css");
  const intakeCss = source("components/today-intake-summary.module.css");
  assert.match(eventsCss, /@media \(max-width:/);
  assert.match(intakeCss, /@media \(max-width:/);
  assert.doesNotMatch(eventsCss, /outline:\s*none/);
  assert.doesNotMatch(intakeCss, /outline:\s*none/);
});

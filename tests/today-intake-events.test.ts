import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const eventsUrl = new URL("../components/today-events.tsx", import.meta.url);
const eventsCssUrl = new URL("../components/today-events.module.css", import.meta.url);
const intakeUrl = new URL("../components/today-intake-summary.tsx", import.meta.url);
const intakeCssUrl = new URL("../components/today-intake-summary.module.css", import.meta.url);
const controlCenter = readFileSync(new URL("../components/control-center.tsx", import.meta.url), "utf8");

function source(url: URL): string {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("Today events stay lightweight, ordered through the canonical event projection, and bounded to seven days", () => {
  assert.equal(existsSync(eventsUrl), true, "Today events component must exist");
  assert.equal(existsSync(eventsCssUrl), true, "Today events styles must exist");
  const events = source(eventsUrl);

  assert.match(events, /useProjectedEvents/);
  assert.match(events, /calendarEventEntries/);
  assert.match(events, /Today(?:&apos;|')s Events/);
  assert.match(events, /Next 7 days/);
  assert.match(events, /entry\.date === today/);
  assert.match(events, /entry\.date > today/);
  assert.match(events, /entry\.date <= throughDate/);
  assert.match(events, /slice\(0, 5\)/);
  assert.match(events, /event\.startAt/);
  assert.doesNotMatch(events, /type="checkbox"/);
  assert.doesNotMatch(events, /is-overdue/);
  assert.doesNotMatch(events, /priority-/);
});

test("Today events preserve visible Personal and Indelitech scope without requesting an all workspace", () => {
  const events = source(eventsUrl);
  assert.match(events, /workspaceId === "personal" && canShowAll \? "all" : workspaceId/);
  assert.match(events, /resolvedWorkspaceId === "indelitech"/);
  assert.match(events, /Primary Calendar/);
  assert.match(events, /Family Calendar/);
  assert.match(events, /onOpenCalendar/);
  assert.doesNotMatch(events, /workspaceId=all/);
});

test("Today Intake shows the review count, workspace breakdown, and source freshness failures", () => {
  assert.equal(existsSync(intakeUrl), true, "Today Intake summary component must exist");
  assert.equal(existsSync(intakeCssUrl), true, "Today Intake summary styles must exist");
  const intake = source(intakeUrl);

  assert.match(intake, /useIntake/);
  assert.match(intake, /viewMode:\s*"PENDING"/);
  assert.match(intake, /workspaceId === "personal" && canShowAll \? "all" : workspaceId/);
  assert.match(intake, /Personal/);
  assert.match(intake, /Indelitech/);
  assert.match(intake, /onOpenIntake/);
  assert.match(intake, /FAILED/);
  assert.match(intake, /UNKNOWN/);
  assert.match(intake, /freshnessError/);
  assert.match(intake, /intake\.error/);
});

test("Today mounts focused Event and Intake summaries without replacing Tasks, Financial Pulse, or Intel", () => {
  assert.match(controlCenter, /<TodayEvents/);
  assert.match(controlCenter, /<TodayIntakeSummary/);
  assert.match(controlCenter, /authorizedWorkspaceIds=\{authorizedWorkspaceIds\}/);
  assert.match(controlCenter, /enabled=\{runtimeMode === "hosted"\}/);
  assert.match(controlCenter, /onOpenCalendar=\{\(\) => goTo\("calendar"\)\}/);
  assert.match(controlCenter, /onOpenIntake=\{\(\) => goTo\("intake"\)\}/);
  assert.match(controlCenter, /<TaskAttentionPanel/);
  assert.match(controlCenter, /<TaskHorizon/);
  assert.match(controlCenter, /<TodayFinancialPulse workspaceId=\{workspaceId\} \/>/);
  assert.match(controlCenter, /<HostedIntelTodayPanel/);
});

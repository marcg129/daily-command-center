import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function text(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Todoist Worker dispatches versioned Daily Intake envelopes without adding an HTTP write route", () => {
  const worker = text("../workers/todoist-task-ingress.ts");
  assert.match(worker, /D1IntakeRepository/);
  assert.match(worker, /D1CalendarProjectionRepository/);
  assert.match(worker, /D1SourceFreshnessRepository/);
  assert.match(worker, /createDailyIntakeIngressService/);
  assert.match(worker, /createTodoistIngressDispatcher/);
  assert.match(worker, /createTodoistTaskIngressService/);
  assert.match(worker, /runTodoistIngressBatch/);
  assert.doesNotMatch(worker, /\bfetch\s*\(/);
});

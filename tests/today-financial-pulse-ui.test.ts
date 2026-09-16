import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const componentUrl = new URL("../components/today-financial-pulse.tsx", import.meta.url);
const controlCenter = readFileSync(new URL("../components/control-center.tsx", import.meta.url), "utf8");

test("hosted Today has a dedicated Financial Pulse component", () => {
  assert.equal(existsSync(componentUrl), true, "Today Financial Pulse component must exist");
  assert.match(controlCenter, /TodayFinancialPulse/);
});

test("Financial Pulse remains workspace-scoped and read-only", () => {
  if (!existsSync(componentUrl)) {
    assert.fail("Today Financial Pulse component must exist before its contract can be verified");
  }
  const component = readFileSync(componentUrl, "utf8");
  assert.match(component, /api\/hosted\/income\?workspaceId=/);
  assert.match(component, /api\/hosted\/bills\?workspaceId=/);
  assert.match(component, /api\/hosted\/cashflow\/baseline\?workspaceId=/);
  assert.match(component, /buildTodayFinancialPulseForecast/);
  assert.match(component, /loadedWorkspaceId !== workspaceId/);
  assert.match(component, /\/cash-flow\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}/);
  assert.doesNotMatch(component, /safe to spend/i);
});

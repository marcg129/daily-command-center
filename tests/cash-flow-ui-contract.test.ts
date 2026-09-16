import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cashFlow = readFileSync(new URL("../components/cash-flow-view.tsx", import.meta.url), "utf8");
const switcher = readFileSync(new URL("../components/workspace-switcher.tsx", import.meta.url), "utf8");

test("Cash Flow loads canonical financial records for only the selected workspace", () => {
  assert.match(cashFlow, /api\/hosted\/income\?workspaceId=/);
  assert.match(cashFlow, /api\/hosted\/bills\?workspaceId=/);
  assert.match(cashFlow, /api\/hosted\/cashflow\/baseline\?workspaceId=/);
  assert.match(cashFlow, /buildPaydayForecast\(/);
  assert.match(cashFlow, /Personal and Indelitech cash are calculated separately/);
  assert.doesNotMatch(cashFlow, /authorized Personal \+ Indelitech|roll.?up.*cash/i);
});

test("Cash Flow keeps same-day obligations separate and does not invent bank certainty", () => {
  assert.match(cashFlow, /Due before payday/);
  assert.match(cashFlow, /Due on payday/);
  assert.match(cashFlow, /same-day bills are shown separately because deposit and charge timing is not assumed/);
  assert.match(cashFlow, /Manual · not bank verified/);
  assert.match(cashFlow, /planning forecast, not a bank balance or spending recommendation/);
  assert.doesNotMatch(cashFlow, /safe to spend/i);
});

test("workspace switcher exposes Cash Flow while preserving the active logical workspace", () => {
  assert.match(switcher, /\/cash-flow\?workspaceId=\$\{encodeURIComponent\(value\)\}/);
  assert.match(switcher, /showCashFlowLink/);
});

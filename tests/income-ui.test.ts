import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import { incomeOccurrenceShapeChanged, incomeRecurrenceLabel } from "@/lib/income-ui";

function income(overrides: Partial<IncomeDefinitionCore> = {}): IncomeDefinitionCore {
  return {
    name: "Paycheck",
    payer: "Employer",
    amountMode: "FIXED",
    defaultNetAmountMinor: 150_000,
    currency: "USD",
    scheduleStartDate: "2026-09-18",
    recurrenceUnit: "WEEK",
    recurrenceInterval: 2,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
    status: "ACTIVE",
    ...overrides,
  };
}

test("Income UI detects only occurrence-shaping changes", () => {
  const original = income();
  assert.equal(incomeOccurrenceShapeChanged(original, { ...original, name: "Salary" }), false);
  assert.equal(incomeOccurrenceShapeChanged(original, { ...original, status: "PAUSED" }), false);
  assert.equal(incomeOccurrenceShapeChanged(original, { ...original, defaultNetAmountMinor: 160_000 }), true);
  assert.equal(incomeOccurrenceShapeChanged(original, { ...original, recurrenceInterval: 1 }), true);
  assert.equal(incomeOccurrenceShapeChanged(original, {
    ...original,
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  }), true);
});

test("Income recurrence labels remain readable for common schedules", () => {
  assert.equal(incomeRecurrenceLabel(income() as never), "Every 2 weeks");
  assert.equal(incomeRecurrenceLabel(income({ recurrenceInterval: 1 }) as never), "Weekly");
  assert.equal(incomeRecurrenceLabel(income({ recurrenceUnit: "NONE", recurrenceInterval: 1 }) as never), "One-time");
  assert.equal(incomeRecurrenceLabel(income({
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  }) as never), "Twice monthly · days 15 & 31");
});

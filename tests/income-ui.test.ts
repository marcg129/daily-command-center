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

function occurrenceShape(source: IncomeDefinitionCore) {
  return {
    amountMode: source.amountMode,
    defaultNetAmountMinor: source.defaultNetAmountMinor,
    currency: source.currency,
    scheduleStartDate: source.scheduleStartDate,
    recurrenceUnit: source.recurrenceUnit,
    recurrenceInterval: source.recurrenceInterval,
    recurrenceDayMode: source.recurrenceDayMode,
    semimonthDayOne: source.semimonthDayOne,
    semimonthDayTwo: source.semimonthDayTwo,
  };
}

function recurrenceShape(source: IncomeDefinitionCore) {
  return {
    recurrenceUnit: source.recurrenceUnit,
    recurrenceInterval: source.recurrenceInterval,
    recurrenceDayMode: source.recurrenceDayMode,
    semimonthDayOne: source.semimonthDayOne,
    semimonthDayTwo: source.semimonthDayTwo,
  };
}

test("Income UI detects only occurrence-shaping changes", () => {
  const original = income();
  assert.equal(incomeOccurrenceShapeChanged(occurrenceShape(original), occurrenceShape(income({ name: "Salary" }))), false);
  assert.equal(incomeOccurrenceShapeChanged(occurrenceShape(original), occurrenceShape(income({ status: "PAUSED" }))), false);
  assert.equal(incomeOccurrenceShapeChanged(occurrenceShape(original), occurrenceShape(income({ defaultNetAmountMinor: 160_000 }))), true);
  assert.equal(incomeOccurrenceShapeChanged(occurrenceShape(original), occurrenceShape(income({ recurrenceInterval: 1 }))), true);
  assert.equal(incomeOccurrenceShapeChanged(occurrenceShape(original), occurrenceShape(income({
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  }))), true);
});

test("Income recurrence labels remain readable for common schedules", () => {
  assert.equal(incomeRecurrenceLabel(recurrenceShape(income())), "Every 2 weeks");
  assert.equal(incomeRecurrenceLabel(recurrenceShape(income({ recurrenceInterval: 1 }))), "Weekly");
  assert.equal(incomeRecurrenceLabel(recurrenceShape(income({ recurrenceUnit: "NONE", recurrenceInterval: 1 }))), "One-time");
  assert.equal(incomeRecurrenceLabel(recurrenceShape(income({
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  }))), "Twice monthly · days 15 & 31");
});

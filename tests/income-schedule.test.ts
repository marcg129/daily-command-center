import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_INCOME_PAY_DATES_PER_RANGE,
  incomePayDatesInRange,
} from "@/lib/runtime/income-schedule";
import {
  validateIncomeDefinitionCore,
  validateIncomeSchedule,
  type IncomeSchedule,
} from "@/lib/runtime/income";

function schedule(overrides: Partial<IncomeSchedule> = {}): IncomeSchedule {
  return {
    scheduleStartDate: "2026-09-18",
    recurrenceUnit: "WEEK",
    recurrenceInterval: 2,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
    ...overrides,
  };
}

test("income validation rejects impossible dates and invalid schedule combinations", () => {
  assert.throws(() => validateIncomeSchedule(schedule({ scheduleStartDate: "2026-02-30" })), /Invalid calendar date/);
  assert.throws(() => validateIncomeSchedule(schedule({ recurrenceUnit: "NONE", recurrenceInterval: 2 })), /One-time/);
  assert.throws(() => validateIncomeSchedule(schedule({ recurrenceUnit: "WEEK", recurrenceDayMode: "ANCHOR_DATE" })), /Weekly/);
  assert.throws(() => validateIncomeSchedule(schedule({
    scheduleStartDate: "2026-09-15",
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 28,
    semimonthDayTwo: 31,
  })), /first day/);
  assert.throws(() => validateIncomeSchedule(schedule({
    scheduleStartDate: "2026-09-20",
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  })), /start date/);
  assert.throws(() => validateIncomeSchedule(schedule({
    scheduleStartDate: "2026-09-29",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "LAST_DAY",
  })), /LAST_DAY/);
});

test("income definition validates fixed/variable amount semantics", () => {
  assert.doesNotThrow(() => validateIncomeDefinitionCore({
    ...schedule(),
    name: "Salary",
    payer: "Employer",
    amountMode: "FIXED",
    defaultNetAmountMinor: 250_000,
    currency: "USD",
    status: "ACTIVE",
  }));
  assert.doesNotThrow(() => validateIncomeDefinitionCore({
    ...schedule(),
    name: "Commission",
    payer: null,
    amountMode: "VARIABLE",
    defaultNetAmountMinor: null,
    currency: "USD",
    status: "ACTIVE",
  }));
  assert.throws(() => validateIncomeDefinitionCore({
    ...schedule(),
    name: "Salary",
    payer: null,
    amountMode: "FIXED",
    defaultNetAmountMinor: null,
    currency: "USD",
    status: "ACTIVE",
  }), /require/);
});

test("biweekly schedules remain date-only and deterministic", () => {
  assert.deepEqual(incomePayDatesInRange(schedule(), {
    startDate: "2026-09-01",
    endDate: "2026-10-31",
  }), ["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30"]);
});

test("monthly anchor dates clamp short months without drift", () => {
  const monthly = schedule({
    scheduleStartDate: "2027-01-31",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
  });
  assert.deepEqual(incomePayDatesInRange(monthly, {
    startDate: "2027-01-01",
    endDate: "2027-04-30",
  }), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("yearly Feb-29 income rebounds in leap years", () => {
  const annual = schedule({
    scheduleStartDate: "2024-02-29",
    recurrenceUnit: "YEAR",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
  });
  assert.deepEqual(incomePayDatesInRange(annual, {
    startDate: "2024-01-01",
    endDate: "2028-12-31",
  }), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
});

test("semimonthly schedules support 15th/last-day style clamping without duplicates", () => {
  const semimonthly = schedule({
    scheduleStartDate: "2027-01-15",
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  });
  assert.deepEqual(incomePayDatesInRange(semimonthly, {
    startDate: "2027-01-01",
    endDate: "2027-03-31",
  }), [
    "2027-01-15", "2027-01-31",
    "2027-02-15", "2027-02-28",
    "2027-03-15", "2027-03-31",
  ]);
});

test("semimonthly start on the second configured payday does not backfill the first", () => {
  const semimonthly = schedule({
    scheduleStartDate: "2026-09-30",
    recurrenceUnit: "SEMIMONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: 15,
    semimonthDayTwo: 31,
  });
  assert.deepEqual(incomePayDatesInRange(semimonthly, {
    startDate: "2026-09-01",
    endDate: "2026-10-31",
  }), ["2026-09-30", "2026-10-15", "2026-10-31"]);
});

test("one-time income respects inclusive range boundaries", () => {
  const once = schedule({
    scheduleStartDate: "2026-09-16",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
  });
  assert.deepEqual(incomePayDatesInRange(once, { startDate: "2026-09-16", endDate: "2026-09-16" }), ["2026-09-16"]);
  assert.deepEqual(incomePayDatesInRange(once, { startDate: "2026-09-17", endDate: "2026-09-30" }), []);
});

test("old anchors seek near the requested range and generation remains bounded", () => {
  const oldWeekly = schedule({ scheduleStartDate: "2000-01-07", recurrenceInterval: 1 });
  const dates = incomePayDatesInRange(oldWeekly, { startDate: "2026-09-01", endDate: "2026-09-30" });
  assert.equal(dates.length, 4);
  assert.equal(dates[0], "2026-09-04");

  assert.throws(() => incomePayDatesInRange(oldWeekly, {
    startDate: "2026-01-01",
    endDate: "2040-12-31",
  }), new RegExp(String(MAX_INCOME_PAY_DATES_PER_RANGE)));
});

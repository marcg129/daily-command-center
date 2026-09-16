import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPaydayForecast,
  type ForecastBillOccurrence,
  type ForecastIncomeOccurrence,
} from "@/lib/runtime/cashflow-forecast";

function income(overrides: Partial<ForecastIncomeOccurrence> = {}): ForecastIncomeOccurrence {
  return {
    occurrenceId: "income-1",
    payDate: "2026-09-18",
    expectedAmountMinor: 250_000,
    amountMode: "FIXED",
    currency: "USD",
    status: "EXPECTED",
    ...overrides,
  };
}

function bill(overrides: Partial<ForecastBillOccurrence> = {}): ForecastBillOccurrence {
  return {
    occurrenceId: "bill-1",
    dueDate: "2026-09-17",
    expectedAmountMinor: 10_000,
    amountMode: "FIXED",
    currency: "USD",
    status: "OPEN",
    ...overrides,
  };
}

test("forecast groups overdue/before-payday and same-day bills while preserving uncertainty", () => {
  const forecast = buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [income()],
    billOccurrences: [
      bill({ occurrenceId: "overdue", dueDate: "2026-09-14", expectedAmountMinor: 10_000 }),
      bill({ occurrenceId: "estimated", dueDate: "2026-09-17", expectedAmountMinor: 1_234, amountMode: "VARIABLE" }),
      bill({ occurrenceId: "unknown", dueDate: "2026-09-17", expectedAmountMinor: null, amountMode: "VARIABLE" }),
      bill({ occurrenceId: "same-day", dueDate: "2026-09-18", expectedAmountMinor: 5_000 }),
      bill({ occurrenceId: "later", dueDate: "2026-09-20", expectedAmountMinor: 99_999 }),
    ],
    baseline: { amountMinor: 100_000, currency: "USD", asOfDate: "2026-09-16" },
  });

  assert.equal(forecast.nextPayday?.date, "2026-09-18");
  assert.deepEqual(forecast.nextPayday?.billsBeforePayday, {
    itemCount: 3,
    exactKnownMinor: 10_000,
    estimatedKnownMinor: 1_234,
    knownTotalMinor: 11_234,
    unknownAmountCount: 1,
  });
  assert.deepEqual(forecast.nextPayday?.billsOnPayday, {
    itemCount: 1,
    exactKnownMinor: 5_000,
    estimatedKnownMinor: 0,
    knownTotalMinor: 5_000,
    unknownAmountCount: 0,
  });
  assert.equal(forecast.nextPayday?.projectedKnownBeforePaydayMinor, 88_766);
  assert.equal(forecast.nextPayday?.projectedKnownAfterPaydayMinor, 333_766);
  assert.equal(forecast.nextPayday?.beforeProjectionHasUncertainty, true);
  assert.equal(forecast.nextPayday?.afterProjectionHasUncertainty, true);
});

test("next payday aggregates all expected income on the earliest date", () => {
  const forecast = buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [
      income({ occurrenceId: "salary", expectedAmountMinor: 200_000 }),
      income({ occurrenceId: "commission", expectedAmountMinor: 50_000, amountMode: "VARIABLE" }),
      income({ occurrenceId: "unknown-bonus", expectedAmountMinor: null, amountMode: "VARIABLE" }),
      income({ occurrenceId: "later-pay", payDate: "2026-10-02", expectedAmountMinor: 200_000 }),
    ],
    billOccurrences: [],
    baseline: { amountMinor: -5_000, currency: "USD", asOfDate: "2026-09-15" },
  });

  assert.deepEqual(forecast.nextPayday?.income, {
    itemCount: 3,
    exactKnownMinor: 200_000,
    estimatedKnownMinor: 50_000,
    knownTotalMinor: 250_000,
    unknownAmountCount: 1,
  });
  assert.equal(forecast.nextPayday?.projectedKnownBeforePaydayMinor, -5_000);
  assert.equal(forecast.nextPayday?.projectedKnownAfterPaydayMinor, 245_000);
  assert.equal(forecast.nextPayday?.afterProjectionHasUncertainty, true);
});

test("without a manual baseline the product does not fabricate projected balances", () => {
  const forecast = buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [income()],
    billOccurrences: [bill()],
    baseline: null,
  });

  assert.equal(forecast.nextPayday?.projectedKnownBeforePaydayMinor, null);
  assert.equal(forecast.nextPayday?.projectedKnownAfterPaydayMinor, null);
});

test("resolved Bills and Income occurrences do not affect the forecast", () => {
  const forecast = buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [
      income({ occurrenceId: "received", status: "RECEIVED", payDate: "2026-09-16" }),
      income({ occurrenceId: "expected", payDate: "2026-09-18" }),
    ],
    billOccurrences: [
      bill({ occurrenceId: "paid", status: "PAID", dueDate: "2026-09-17", expectedAmountMinor: 90_000 }),
      bill({ occurrenceId: "open", dueDate: "2026-09-17", expectedAmountMinor: 10_000 }),
    ],
    baseline: { amountMinor: 50_000, currency: "USD", asOfDate: "2026-09-16" },
  });

  assert.equal(forecast.nextPayday?.date, "2026-09-18");
  assert.equal(forecast.nextPayday?.billsBeforePayday.knownTotalMinor, 10_000);
  assert.equal(forecast.nextPayday?.projectedKnownBeforePaydayMinor, 40_000);
});

test("no future expected income returns no payday window", () => {
  const forecast = buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [income({ payDate: "2026-09-15" })],
    billOccurrences: [bill()],
    baseline: null,
  });
  assert.equal(forecast.nextPayday, null);
});

test("forecast rejects cross-currency netting and future-dated manual baselines", () => {
  assert.throws(() => buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [income()],
    billOccurrences: [bill({ currency: "EUR" })],
    baseline: null,
  }), /multiple currencies/);

  assert.throws(() => buildPaydayForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeOccurrences: [income()],
    billOccurrences: [],
    baseline: { amountMinor: 1_000, currency: "USD", asOfDate: "2026-09-17" },
  }), /after the forecast date/);
});

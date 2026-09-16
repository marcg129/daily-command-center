import assert from "node:assert/strict";
import { test } from "node:test";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";
import type {
  HostedCashflowBaseline,
  HostedIncomeOccurrence,
  HostedIncomeSource,
} from "@/lib/runtime/hosted-income";
import { buildTodayFinancialPulseForecast } from "@/lib/today-financial-pulse";

function incomeSource(
  incomeSourceId: string,
  amountMode: "FIXED" | "VARIABLE",
  currency = "USD",
): HostedIncomeSource {
  return {
    incomeSourceId,
    primaryWorkspaceId: "personal",
    createdByUserId: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    name: incomeSourceId,
    payer: null,
    amountMode,
    defaultNetAmountMinor: null,
    currency,
    scheduleStartDate: "2026-09-18",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    semimonthDayOne: null,
    semimonthDayTwo: null,
    status: "ACTIVE",
  };
}

function incomeOccurrence(
  occurrenceId: string,
  incomeSourceId: string,
  payDate: string,
  expectedAmountMinor: number | null,
  currency = "USD",
): HostedIncomeOccurrence {
  return {
    occurrenceId,
    incomeSourceId,
    payDate,
    expectedAmountMinor,
    currency,
    status: "EXPECTED",
    receivedAmountMinor: null,
    receivedOn: null,
    resolvedByUserId: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

function bill(billId: string, amountMode: "FIXED" | "VARIABLE", currency = "USD"): HostedBill {
  return {
    billId,
    primaryWorkspaceId: "personal",
    createdByUserId: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    name: billId,
    payee: null,
    category: null,
    amountMode,
    defaultAmountMinor: null,
    currency,
    autopay: false,
    paymentUrl: null,
    notes: null,
    reminderDaysBefore: null,
    scheduleStartDate: "2026-09-17",
    recurrenceUnit: "NONE",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
    status: "ACTIVE",
  };
}

function billOccurrence(
  occurrenceId: string,
  billId: string,
  dueDate: string,
  expectedAmountMinor: number | null,
  currency = "USD",
): HostedBillOccurrence {
  return {
    occurrenceId,
    billId,
    dueDate,
    expectedAmountMinor,
    currency,
    status: "OPEN",
    paidAmountMinor: null,
    paidOn: null,
    resolvedByUserId: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

test("Today Financial Pulse delegates payday grouping and uncertainty to the canonical forecast", () => {
  const baseline: HostedCashflowBaseline = {
    primaryWorkspaceId: "personal",
    amountMinor: 50_000,
    currency: "USD",
    asOfDate: "2026-09-16",
    updatedByUserId: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };

  const forecast = buildTodayFinancialPulseForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeSources: [incomeSource("pay", "FIXED"), incomeSource("eur-pay", "FIXED", "EUR")],
    incomeOccurrences: [
      incomeOccurrence("pay-1", "pay", "2026-09-18", 100_000),
      incomeOccurrence("eur-1", "eur-pay", "2026-09-17", 90_000, "EUR"),
    ],
    bills: [bill("before", "FIXED"), bill("unknown", "VARIABLE"), bill("same-day", "FIXED")],
    billOccurrences: [
      billOccurrence("before-1", "before", "2026-09-17", 10_000),
      billOccurrence("unknown-1", "unknown", "2026-09-17", null),
      billOccurrence("same-day-1", "same-day", "2026-09-18", 5_000),
    ],
    baseline,
  });

  assert.equal(forecast.nextPayday?.date, "2026-09-18");
  assert.equal(forecast.nextPayday?.income.knownTotalMinor, 100_000);
  assert.equal(forecast.nextPayday?.billsBeforePayday.knownTotalMinor, 10_000);
  assert.equal(forecast.nextPayday?.billsBeforePayday.unknownAmountCount, 1);
  assert.equal(forecast.nextPayday?.billsOnPayday.knownTotalMinor, 5_000);
  assert.equal(forecast.nextPayday?.projectedKnownAfterPaydayMinor, 135_000);
  assert.equal(forecast.nextPayday?.afterProjectionHasUncertainty, true);
});

test("Today Financial Pulse preserves a missing baseline instead of inventing zero", () => {
  const forecast = buildTodayFinancialPulseForecast({
    today: "2026-09-16",
    currency: "USD",
    incomeSources: [incomeSource("pay", "FIXED")],
    incomeOccurrences: [incomeOccurrence("pay-1", "pay", "2026-09-18", 100_000)],
    bills: [],
    billOccurrences: [],
    baseline: null,
  });

  assert.equal(forecast.nextPayday?.baseline, null);
  assert.equal(forecast.nextPayday?.projectedKnownBeforePaydayMinor, null);
  assert.equal(forecast.nextPayday?.projectedKnownAfterPaydayMinor, null);
});

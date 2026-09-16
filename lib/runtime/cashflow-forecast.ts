import { parseDateOnlyParts, type BillAmountMode, type BillOccurrenceStatus } from "@/lib/runtime/bills";
import type { IncomeAmountMode, IncomeOccurrenceStatus } from "@/lib/runtime/income";

export type ForecastBillOccurrence = Readonly<{
  occurrenceId: string;
  dueDate: string;
  expectedAmountMinor: number | null;
  amountMode: BillAmountMode;
  currency: string;
  status: BillOccurrenceStatus;
}>;

export type ForecastIncomeOccurrence = Readonly<{
  occurrenceId: string;
  payDate: string;
  expectedAmountMinor: number | null;
  amountMode: IncomeAmountMode;
  currency: string;
  status: IncomeOccurrenceStatus;
}>;

export type ForecastCashBaseline = Readonly<{
  amountMinor: number;
  currency: string;
  asOfDate: string;
}>;

export type ForecastAmountSummary = Readonly<{
  itemCount: number;
  exactKnownMinor: number;
  estimatedKnownMinor: number;
  knownTotalMinor: number;
  unknownAmountCount: number;
}>;

export type PaydayForecast = Readonly<{
  today: string;
  currency: string;
  nextPayday: null | Readonly<{
    date: string;
    income: ForecastAmountSummary;
    billsBeforePayday: ForecastAmountSummary;
    billsOnPayday: ForecastAmountSummary;
    baseline: ForecastCashBaseline | null;
    projectedKnownBeforePaydayMinor: number | null;
    projectedKnownAfterPaydayMinor: number | null;
    beforeProjectionHasUncertainty: boolean;
    afterProjectionHasUncertainty: boolean;
  }>;
}>;

export type PaydayForecastInput = Readonly<{
  today: string;
  currency: string;
  incomeOccurrences: readonly ForecastIncomeOccurrence[];
  billOccurrences: readonly ForecastBillOccurrence[];
  baseline: ForecastCashBaseline | null;
}>;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_SAFE_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER;

function assertCurrency(value: string): void {
  if (!CURRENCY_PATTERN.test(value)) throw new Error("Forecast currency must be an uppercase three-letter code");
}

function assertUnsignedMinor(value: number | null, field: string): void {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MINOR_AMOUNT) {
    throw new Error(`${field} must be null or a non-negative JavaScript safe integer`);
  }
}

function assertSignedMinor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_SAFE_MINOR_AMOUNT) {
    throw new Error(`${field} must be a signed JavaScript safe integer`);
  }
}

function safeAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${field} exceeds JavaScript safe-integer range`);
  return result;
}

function safeSubtract(left: number, right: number, field: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new Error(`${field} exceeds JavaScript safe-integer range`);
  return result;
}

function summarizeAmounts(
  items: readonly Readonly<{ expectedAmountMinor: number | null; amountMode: "FIXED" | "VARIABLE" }>[],
): ForecastAmountSummary {
  let exactKnownMinor = 0;
  let estimatedKnownMinor = 0;
  let unknownAmountCount = 0;

  for (const item of items) {
    if (item.expectedAmountMinor === null) {
      unknownAmountCount += 1;
      continue;
    }

    if (item.amountMode === "FIXED") {
      exactKnownMinor = safeAdd(exactKnownMinor, item.expectedAmountMinor, "Exact forecast total");
    } else {
      estimatedKnownMinor = safeAdd(estimatedKnownMinor, item.expectedAmountMinor, "Estimated forecast total");
    }
  }

  return {
    itemCount: items.length,
    exactKnownMinor,
    estimatedKnownMinor,
    knownTotalMinor: safeAdd(exactKnownMinor, estimatedKnownMinor, "Known forecast total"),
    unknownAmountCount,
  };
}

function hasUncertainty(summary: ForecastAmountSummary): boolean {
  return summary.estimatedKnownMinor !== 0 || summary.unknownAmountCount !== 0;
}

export function buildPaydayForecast(input: PaydayForecastInput): PaydayForecast {
  parseDateOnlyParts(input.today);
  assertCurrency(input.currency);

  const expectedIncome = input.incomeOccurrences.filter((occurrence) => occurrence.status === "EXPECTED");
  const openBills = input.billOccurrences.filter((occurrence) => occurrence.status === "OPEN");

  for (const occurrence of expectedIncome) {
    parseDateOnlyParts(occurrence.payDate);
    assertUnsignedMinor(occurrence.expectedAmountMinor, "Expected income amount");
    if (occurrence.currency !== input.currency) throw new Error("Forecast cannot combine multiple currencies");
  }
  for (const occurrence of openBills) {
    parseDateOnlyParts(occurrence.dueDate);
    assertUnsignedMinor(occurrence.expectedAmountMinor, "Expected bill amount");
    if (occurrence.currency !== input.currency) throw new Error("Forecast cannot combine multiple currencies");
  }

  if (input.baseline !== null) {
    parseDateOnlyParts(input.baseline.asOfDate);
    assertSignedMinor(input.baseline.amountMinor, "Cash-flow baseline");
    if (input.baseline.currency !== input.currency) throw new Error("Forecast baseline currency must match forecast currency");
    if (input.baseline.asOfDate > input.today) throw new Error("Cash-flow baseline as-of date cannot be after the forecast date");
  }

  const futureIncome = expectedIncome
    .filter((occurrence) => occurrence.payDate >= input.today)
    .sort((left, right) => left.payDate.localeCompare(right.payDate) || left.occurrenceId.localeCompare(right.occurrenceId));

  if (futureIncome.length === 0) {
    return { today: input.today, currency: input.currency, nextPayday: null };
  }

  const payday = futureIncome[0].payDate;
  const incomeOnPayday = futureIncome.filter((occurrence) => occurrence.payDate === payday);
  const billsBeforePayday = openBills.filter((occurrence) => occurrence.dueDate < payday);
  const billsOnPayday = openBills.filter((occurrence) => occurrence.dueDate === payday);

  const income = summarizeAmounts(incomeOnPayday);
  const before = summarizeAmounts(billsBeforePayday);
  const onPayday = summarizeAmounts(billsOnPayday);

  let projectedKnownBeforePaydayMinor: number | null = null;
  let projectedKnownAfterPaydayMinor: number | null = null;

  if (input.baseline !== null) {
    projectedKnownBeforePaydayMinor = safeSubtract(
      input.baseline.amountMinor,
      before.knownTotalMinor,
      "Projected known balance before payday",
    );
    const afterIncome = safeAdd(
      projectedKnownBeforePaydayMinor,
      income.knownTotalMinor,
      "Projected known balance after payday income",
    );
    projectedKnownAfterPaydayMinor = safeSubtract(
      afterIncome,
      onPayday.knownTotalMinor,
      "Projected known balance after payday obligations",
    );
  }

  const beforeProjectionHasUncertainty = hasUncertainty(before);
  const afterProjectionHasUncertainty = beforeProjectionHasUncertainty || hasUncertainty(income) || hasUncertainty(onPayday);

  return {
    today: input.today,
    currency: input.currency,
    nextPayday: {
      date: payday,
      income,
      billsBeforePayday: before,
      billsOnPayday: onPayday,
      baseline: input.baseline,
      projectedKnownBeforePaydayMinor,
      projectedKnownAfterPaydayMinor,
      beforeProjectionHasUncertainty,
      afterProjectionHasUncertainty,
    },
  };
}

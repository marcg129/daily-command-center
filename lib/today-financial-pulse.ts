import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";
import type {
  HostedCashflowBaseline,
  HostedIncomeOccurrence,
  HostedIncomeSource,
} from "@/lib/runtime/hosted-income";
import {
  buildPaydayForecast,
  type ForecastAmountSummary,
  type PaydayForecast,
} from "@/lib/runtime/cashflow-forecast";

export type TodayFinancialPulseInput = Readonly<{
  today: string;
  currency: string;
  incomeSources: readonly HostedIncomeSource[];
  incomeOccurrences: readonly HostedIncomeOccurrence[];
  bills: readonly HostedBill[];
  billOccurrences: readonly HostedBillOccurrence[];
  baseline: HostedCashflowBaseline | null;
}>;

export function buildTodayFinancialPulseForecast(input: TodayFinancialPulseInput): PaydayForecast {
  const incomeById = new Map(input.incomeSources.map((source) => [source.incomeSourceId, source] as const));
  const billById = new Map(input.bills.map((bill) => [bill.billId, bill] as const));

  return buildPaydayForecast({
    today: input.today,
    currency: input.currency,
    incomeOccurrences: input.incomeOccurrences.flatMap((occurrence) => {
      const source = incomeById.get(occurrence.incomeSourceId);
      if (!source || occurrence.currency !== input.currency) return [];
      return [{
        occurrenceId: occurrence.occurrenceId,
        payDate: occurrence.payDate,
        expectedAmountMinor: occurrence.expectedAmountMinor,
        amountMode: source.amountMode,
        currency: occurrence.currency,
        status: occurrence.status,
      }];
    }),
    billOccurrences: input.billOccurrences.flatMap((occurrence) => {
      const bill = billById.get(occurrence.billId);
      if (!bill || occurrence.currency !== input.currency) return [];
      return [{
        occurrenceId: occurrence.occurrenceId,
        dueDate: occurrence.dueDate,
        expectedAmountMinor: occurrence.expectedAmountMinor,
        amountMode: bill.amountMode,
        currency: occurrence.currency,
        status: occurrence.status,
      }];
    }),
    baseline: input.baseline?.currency === input.currency
      ? {
          amountMinor: input.baseline.amountMinor,
          currency: input.baseline.currency,
          asOfDate: input.baseline.asOfDate,
        }
      : null,
  });
}

export function formatPulseCurrencyMinor(value: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatPulseAmountSummary(summary: ForecastAmountSummary, currency = "USD"): string {
  const known = formatPulseCurrencyMinor(summary.knownTotalMinor, currency);
  return summary.unknownAmountCount === 0
    ? known
    : `${known} + ${summary.unknownAmountCount} unknown`;
}

export function pulseAmountQualifier(summary: ForecastAmountSummary, currency = "USD"): string {
  const parts: string[] = [];
  if (summary.exactKnownMinor) parts.push(`${formatPulseCurrencyMinor(summary.exactKnownMinor, currency)} exact`);
  if (summary.estimatedKnownMinor) parts.push(`${formatPulseCurrencyMinor(summary.estimatedKnownMinor, currency)} estimated`);
  if (summary.unknownAmountCount) parts.push(`${summary.unknownAmountCount} unknown`);
  return parts.join(" · ") || "No known amount";
}

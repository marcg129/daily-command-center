import type { IncomeDefinitionCore } from "@/lib/runtime/income";
import type { HostedIncomeSource } from "@/lib/runtime/hosted-income";

export function incomeOccurrenceShapeChanged(
  previous: Pick<IncomeDefinitionCore,
    "amountMode" | "defaultNetAmountMinor" | "currency" | "scheduleStartDate" | "recurrenceUnit" |
    "recurrenceInterval" | "recurrenceDayMode" | "semimonthDayOne" | "semimonthDayTwo">,
  next: Pick<IncomeDefinitionCore,
    "amountMode" | "defaultNetAmountMinor" | "currency" | "scheduleStartDate" | "recurrenceUnit" |
    "recurrenceInterval" | "recurrenceDayMode" | "semimonthDayOne" | "semimonthDayTwo">,
): boolean {
  return previous.amountMode !== next.amountMode ||
    previous.defaultNetAmountMinor !== next.defaultNetAmountMinor ||
    previous.currency !== next.currency ||
    previous.scheduleStartDate !== next.scheduleStartDate ||
    previous.recurrenceUnit !== next.recurrenceUnit ||
    previous.recurrenceInterval !== next.recurrenceInterval ||
    previous.recurrenceDayMode !== next.recurrenceDayMode ||
    previous.semimonthDayOne !== next.semimonthDayOne ||
    previous.semimonthDayTwo !== next.semimonthDayTwo;
}

export function incomeRecurrenceLabel(
  source: Pick<HostedIncomeSource,
    "recurrenceUnit" | "recurrenceInterval" | "recurrenceDayMode" | "semimonthDayOne" | "semimonthDayTwo">,
): string {
  if (source.recurrenceUnit === "NONE") return "One-time";
  if (source.recurrenceUnit === "SEMIMONTH") {
    return `Twice monthly · days ${source.semimonthDayOne} & ${source.semimonthDayTwo}`;
  }
  const unit = source.recurrenceUnit.toLowerCase();
  const base = source.recurrenceInterval === 1
    ? ({ week: "Weekly", month: "Monthly", year: "Yearly" } as const)[unit as "week" | "month" | "year"]
    : `Every ${source.recurrenceInterval} ${unit}${source.recurrenceInterval === 1 ? "" : "s"}`;
  return source.recurrenceDayMode === "LAST_DAY" ? `${base} · last day` : base;
}

export function formatIncomeAmount(
  source: Pick<HostedIncomeSource, "amountMode" | "defaultNetAmountMinor" | "currency">,
  expectedAmountMinor: number | null = source.defaultNetAmountMinor,
): Readonly<{ label: string; qualifier: "Exact" | "Estimated" | "Amount unknown" }> {
  if (expectedAmountMinor === null) return { label: "Amount unknown", qualifier: "Amount unknown" };
  const label = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: source.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(expectedAmountMinor / 100);
  return { label, qualifier: source.amountMode === "FIXED" ? "Exact" : "Estimated" };
}

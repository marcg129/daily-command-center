import { parseDateOnlyParts, type BillDefinitionCore } from "@/lib/runtime/bills";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";

export type BillOccurrenceDisplayState = "OVERDUE" | "TODAY" | "UPCOMING" | "RESOLVED";

export type BillAmountPresentation = Readonly<{
  label: string;
  qualifier: "Exact" | "Estimated" | "Amount unknown";
  unknown: boolean;
}>;

export type BillOccurrenceSummary = Readonly<{
  count: number;
  knownTotalMinor: number;
  unknownCount: number;
  estimatedCount: number;
}>;

function dateDayNumber(value: string): number {
  const parts = parseDateOnlyParts(value);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return Math.trunc(date.getTime() / 86_400_000);
}

function dateOnlyFromDayNumber(dayNumber: number): string {
  const date = new Date(dayNumber * 86_400_000);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) throw new Error("Date is outside the supported calendar range");
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDateOnlyDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Date offset must be an integer number of days");
  return dateOnlyFromDayNumber(dateDayNumber(value) + days);
}

export function daysBetweenDateOnly(fromDate: string, throughDate: string): number {
  return dateDayNumber(throughDate) - dateDayNumber(fromDate);
}

export function billOccurrenceDisplayState(
  occurrence: HostedBillOccurrence,
  today: string,
): BillOccurrenceDisplayState {
  parseDateOnlyParts(today);
  if (occurrence.status !== "OPEN") return "RESOLVED";
  if (occurrence.dueDate < today) return "OVERDUE";
  if (occurrence.dueDate === today) return "TODAY";
  return "UPCOMING";
}

export function billOccurrenceShapeChanged(
  previous: Pick<BillDefinitionCore, "amountMode" | "defaultAmountMinor" | "currency" | "scheduleStartDate" | "recurrenceUnit" | "recurrenceInterval" | "recurrenceDayMode">,
  next: Pick<BillDefinitionCore, "amountMode" | "defaultAmountMinor" | "currency" | "scheduleStartDate" | "recurrenceUnit" | "recurrenceInterval" | "recurrenceDayMode">,
): boolean {
  return previous.amountMode !== next.amountMode ||
    previous.defaultAmountMinor !== next.defaultAmountMinor ||
    previous.currency !== next.currency ||
    previous.scheduleStartDate !== next.scheduleStartDate ||
    previous.recurrenceUnit !== next.recurrenceUnit ||
    previous.recurrenceInterval !== next.recurrenceInterval ||
    previous.recurrenceDayMode !== next.recurrenceDayMode;
}

export function dollarsInputToMinor(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Amount must be a non-negative dollar value with at most two decimal places");
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const result = whole * 100 + cents;
  if (!Number.isSafeInteger(result)) throw new Error("Amount is too large");
  return result;
}

export function minorToDollarsInput(value: number | null): string {
  if (value === null) return "";
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Minor amount must be a non-negative safe integer");
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export function formatMinorCurrency(amountMinor: number, currency = "USD"): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Minor amount must be a non-negative safe integer");
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function billAmountPresentation(
  bill: Pick<HostedBill, "amountMode" | "defaultAmountMinor" | "currency">,
  occurrence?: Pick<HostedBillOccurrence, "expectedAmountMinor" | "currency"> | null,
): BillAmountPresentation {
  const amount = occurrence ? occurrence.expectedAmountMinor : bill.defaultAmountMinor;
  const currency = occurrence?.currency ?? bill.currency;
  if (amount === null) return { label: "Amount unknown", qualifier: "Amount unknown", unknown: true };
  return {
    label: formatMinorCurrency(amount, currency),
    qualifier: bill.amountMode === "VARIABLE" ? "Estimated" : "Exact",
    unknown: false,
  };
}

export function recurrenceLabel(
  bill: Pick<HostedBill, "recurrenceUnit" | "recurrenceInterval" | "recurrenceDayMode">,
): string {
  if (bill.recurrenceUnit === "NONE") return "One-time";
  const unit = bill.recurrenceUnit.toLowerCase();
  const base = bill.recurrenceInterval === 1
    ? ({ week: "Weekly", month: "Monthly", year: "Yearly" } as const)[unit as "week" | "month" | "year"]
    : `Every ${bill.recurrenceInterval} ${unit}${bill.recurrenceInterval === 1 ? "" : "s"}`;
  return bill.recurrenceDayMode === "LAST_DAY" ? `${base} · last day` : base;
}

export function summarizeOpenOccurrences(
  occurrences: readonly HostedBillOccurrence[],
  bills: readonly HostedBill[],
  fromDate: string,
  throughDate: string,
): BillOccurrenceSummary {
  parseDateOnlyParts(fromDate);
  parseDateOnlyParts(throughDate);
  if (throughDate < fromDate) throw new Error("Summary end date must not precede start date");
  const billById = new Map(bills.map((bill) => [bill.billId, bill] as const));
  let count = 0;
  let knownTotalMinor = 0;
  let unknownCount = 0;
  let estimatedCount = 0;
  for (const occurrence of occurrences) {
    if (occurrence.status !== "OPEN" || occurrence.dueDate < fromDate || occurrence.dueDate > throughDate) continue;
    const bill = billById.get(occurrence.billId);
    if (!bill) continue;
    count += 1;
    if (occurrence.expectedAmountMinor === null) unknownCount += 1;
    else {
      knownTotalMinor += occurrence.expectedAmountMinor;
      if (bill.amountMode === "VARIABLE") estimatedCount += 1;
    }
  }
  return { count, knownTotalMinor, unknownCount, estimatedCount };
}

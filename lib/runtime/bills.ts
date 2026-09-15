export const BILL_AMOUNT_MODES = ["FIXED", "VARIABLE"] as const;
export const BILL_RECURRENCE_UNITS = ["NONE", "WEEK", "MONTH", "YEAR"] as const;
export const BILL_RECURRENCE_DAY_MODES = ["ANCHOR_DATE", "LAST_DAY"] as const;
export const BILL_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const BILL_OCCURRENCE_STATUSES = ["OPEN", "PAID", "SKIPPED", "CANCELLED"] as const;

export type BillAmountMode = (typeof BILL_AMOUNT_MODES)[number];
export type BillRecurrenceUnit = (typeof BILL_RECURRENCE_UNITS)[number];
export type BillRecurrenceDayMode = (typeof BILL_RECURRENCE_DAY_MODES)[number];
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillOccurrenceStatus = (typeof BILL_OCCURRENCE_STATUSES)[number];

export type BillSchedule = Readonly<{
  scheduleStartDate: string;
  recurrenceUnit: BillRecurrenceUnit;
  recurrenceInterval: number;
  recurrenceDayMode: BillRecurrenceDayMode | null;
}>;

export type BillDefinitionCore = BillSchedule & Readonly<{
  name: string;
  payee: string | null;
  category: string | null;
  amountMode: BillAmountMode;
  defaultAmountMinor: number | null;
  currency: string;
  autopay: boolean;
  paymentUrl: string | null;
  notes: string | null;
  reminderDaysBefore: number | null;
  status: BillStatus;
}>;

export type DateOnlyParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_SAFE_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER;

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

function assertOptionalString(value: unknown, field: string, maxLength: number): void {
  if (value === null) return;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${field} must be null or a string up to ${maxLength} characters`);
  }
}

function assertMinorAmount(value: unknown, field: string, nullable: boolean): void {
  if (value === null && nullable) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MINOR_AMOUNT) {
    throw new Error(`${field} must be a non-negative JavaScript safe integer${nullable ? " or null" : ""}`);
  }
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid calendar year/month");
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseDateOnlyParts(value: unknown): DateOnlyParts {
  if (typeof value !== "string") throw new Error("Date must be an exact YYYY-MM-DD string");
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error("Date must be an exact YYYY-MM-DD string");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) throw new Error(`Invalid calendar date: ${value}`);
  if (day < 1 || day > daysInMonth(year, month)) throw new Error(`Invalid calendar date: ${value}`);
  return { year, month, day };
}

export function isDateOnly(value: unknown): value is string {
  try {
    parseDateOnlyParts(value);
    return true;
  } catch {
    return false;
  }
}

export function validateBillSchedule(schedule: BillSchedule): void {
  const anchor = parseDateOnlyParts(schedule.scheduleStartDate);
  if (!includes(BILL_RECURRENCE_UNITS, schedule.recurrenceUnit)) {
    throw new Error("Invalid bill recurrence unit");
  }
  if (!Number.isInteger(schedule.recurrenceInterval) || schedule.recurrenceInterval < 1 || schedule.recurrenceInterval > 120) {
    throw new Error("Bill recurrence interval must be an integer from 1 through 120");
  }
  if (schedule.recurrenceDayMode !== null && !includes(BILL_RECURRENCE_DAY_MODES, schedule.recurrenceDayMode)) {
    throw new Error("Invalid bill recurrence day mode");
  }

  if (schedule.recurrenceUnit === "NONE") {
    if (schedule.recurrenceInterval !== 1 || schedule.recurrenceDayMode !== null) {
      throw new Error("One-time bills require interval 1 and no recurrence day mode");
    }
    return;
  }

  if (schedule.recurrenceUnit === "WEEK") {
    if (schedule.recurrenceDayMode !== null) throw new Error("Weekly bills cannot use a recurrence day mode");
    return;
  }

  if (schedule.recurrenceDayMode === null) {
    throw new Error("Monthly and yearly bills require a recurrence day mode");
  }
  if (schedule.recurrenceDayMode === "LAST_DAY" && anchor.day !== daysInMonth(anchor.year, anchor.month)) {
    throw new Error("LAST_DAY schedules must start on the last day of the anchor month");
  }
}

export function validateBillDefinitionCore(value: BillDefinitionCore): void {
  validateBillSchedule(value);

  if (typeof value.name !== "string" || value.name.trim().length < 1 || value.name.length > 200) {
    throw new Error("Bill name must contain non-whitespace text and be at most 200 characters");
  }
  assertOptionalString(value.payee, "Bill payee", 200);
  assertOptionalString(value.category, "Bill category", 100);
  assertOptionalString(value.paymentUrl, "Bill payment URL", 2048);
  assertOptionalString(value.notes, "Bill notes", 10000);

  if (!includes(BILL_AMOUNT_MODES, value.amountMode)) throw new Error("Invalid bill amount mode");
  assertMinorAmount(value.defaultAmountMinor, "Bill default amount", true);
  if (value.amountMode === "FIXED" && value.defaultAmountMinor === null) {
    throw new Error("FIXED bills require a default amount");
  }
  if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
    throw new Error("Bill currency must be an uppercase three-letter code");
  }
  if (typeof value.autopay !== "boolean") throw new Error("Bill autopay must be boolean");
  if (value.reminderDaysBefore !== null &&
      (!Number.isInteger(value.reminderDaysBefore) || value.reminderDaysBefore < 0 || value.reminderDaysBefore > 365)) {
    throw new Error("Bill reminder lead time must be null or an integer from 0 through 365");
  }
  if (!includes(BILL_STATUSES, value.status)) throw new Error("Invalid bill status");
}

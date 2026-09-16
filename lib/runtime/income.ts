import { daysInMonth, parseDateOnlyParts } from "@/lib/runtime/bills";

export const INCOME_AMOUNT_MODES = ["FIXED", "VARIABLE"] as const;
export const INCOME_RECURRENCE_UNITS = ["NONE", "WEEK", "MONTH", "YEAR", "SEMIMONTH"] as const;
export const INCOME_RECURRENCE_DAY_MODES = ["ANCHOR_DATE", "LAST_DAY"] as const;
export const INCOME_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const INCOME_OCCURRENCE_STATUSES = ["EXPECTED", "RECEIVED", "SKIPPED", "CANCELLED"] as const;

export type IncomeAmountMode = (typeof INCOME_AMOUNT_MODES)[number];
export type IncomeRecurrenceUnit = (typeof INCOME_RECURRENCE_UNITS)[number];
export type IncomeRecurrenceDayMode = (typeof INCOME_RECURRENCE_DAY_MODES)[number];
export type IncomeStatus = (typeof INCOME_STATUSES)[number];
export type IncomeOccurrenceStatus = (typeof INCOME_OCCURRENCE_STATUSES)[number];

export type IncomeSchedule = Readonly<{
  scheduleStartDate: string;
  recurrenceUnit: IncomeRecurrenceUnit;
  recurrenceInterval: number;
  recurrenceDayMode: IncomeRecurrenceDayMode | null;
  semimonthDayOne: number | null;
  semimonthDayTwo: number | null;
}>;

export type IncomeDefinitionCore = IncomeSchedule & Readonly<{
  name: string;
  payer: string | null;
  amountMode: IncomeAmountMode;
  defaultNetAmountMinor: number | null;
  currency: string;
  status: IncomeStatus;
}>;

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

export function validateIncomeSchedule(schedule: IncomeSchedule): void {
  const anchor = parseDateOnlyParts(schedule.scheduleStartDate);

  if (!includes(INCOME_RECURRENCE_UNITS, schedule.recurrenceUnit)) {
    throw new Error("Invalid income recurrence unit");
  }
  if (!Number.isInteger(schedule.recurrenceInterval) || schedule.recurrenceInterval < 1 || schedule.recurrenceInterval > 120) {
    throw new Error("Income recurrence interval must be an integer from 1 through 120");
  }
  if (schedule.recurrenceDayMode !== null && !includes(INCOME_RECURRENCE_DAY_MODES, schedule.recurrenceDayMode)) {
    throw new Error("Invalid income recurrence day mode");
  }

  if (schedule.recurrenceUnit === "NONE") {
    if (schedule.recurrenceInterval !== 1 || schedule.recurrenceDayMode !== null ||
        schedule.semimonthDayOne !== null || schedule.semimonthDayTwo !== null) {
      throw new Error("One-time income requires interval 1 and no recurrence day/semimonth fields");
    }
    return;
  }

  if (schedule.recurrenceUnit === "WEEK") {
    if (schedule.recurrenceDayMode !== null || schedule.semimonthDayOne !== null || schedule.semimonthDayTwo !== null) {
      throw new Error("Weekly income cannot use recurrence day or semimonth fields");
    }
    return;
  }

  if (schedule.recurrenceUnit === "SEMIMONTH") {
    if (schedule.recurrenceInterval !== 1 || schedule.recurrenceDayMode !== null) {
      throw new Error("Semimonthly income requires interval 1 and no recurrence day mode");
    }
    if (!Number.isInteger(schedule.semimonthDayOne) || schedule.semimonthDayOne! < 1 || schedule.semimonthDayOne! > 27) {
      throw new Error("Semimonthly first day must be an integer from 1 through 27");
    }
    if (!Number.isInteger(schedule.semimonthDayTwo) || schedule.semimonthDayTwo! <= schedule.semimonthDayOne! || schedule.semimonthDayTwo! > 31) {
      throw new Error("Semimonthly second day must be after the first day and no later than 31");
    }

    const lastDay = daysInMonth(anchor.year, anchor.month);
    const first = Math.min(schedule.semimonthDayOne!, lastDay);
    const second = Math.min(schedule.semimonthDayTwo!, lastDay);
    if (anchor.day !== first && anchor.day !== second) {
      throw new Error("Semimonthly schedule start date must match one configured payday in its anchor month");
    }
    return;
  }

  if (schedule.semimonthDayOne !== null || schedule.semimonthDayTwo !== null) {
    throw new Error("Monthly/yearly income cannot use semimonth fields");
  }
  if (schedule.recurrenceDayMode === null) {
    throw new Error("Monthly and yearly income require a recurrence day mode");
  }
  if (schedule.recurrenceDayMode === "LAST_DAY" && anchor.day !== daysInMonth(anchor.year, anchor.month)) {
    throw new Error("LAST_DAY income schedules must start on the last day of the anchor month");
  }
}

export function validateIncomeDefinitionCore(value: IncomeDefinitionCore): void {
  validateIncomeSchedule(value);

  if (typeof value.name !== "string" || value.name.trim().length < 1 || value.name.length > 200) {
    throw new Error("Income source name must contain non-whitespace text and be at most 200 characters");
  }
  assertOptionalString(value.payer, "Income payer", 200);

  if (!includes(INCOME_AMOUNT_MODES, value.amountMode)) throw new Error("Invalid income amount mode");
  assertMinorAmount(value.defaultNetAmountMinor, "Income default net amount", true);
  if (value.amountMode === "FIXED" && value.defaultNetAmountMinor === null) {
    throw new Error("FIXED income requires a default net amount");
  }
  if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
    throw new Error("Income currency must be an uppercase three-letter code");
  }
  if (!includes(INCOME_STATUSES, value.status)) throw new Error("Invalid income status");
}

import {
  daysInMonth,
  parseDateOnlyParts,
  validateBillSchedule,
  type BillSchedule,
  type DateOnlyParts,
} from "@/lib/runtime/bills";

export type BillDateRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export const MAX_BILL_DUE_DATES_PER_RANGE = 512;
const MAX_EXTRA_CANDIDATE_STEPS = 4;
const DAY_MS = 86_400_000;

function formatDateOnly(parts: DateOnlyParts): string {
  if (parts.year < 1 || parts.year > 9999) throw new Error("Bill recurrence exceeded supported calendar range");
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dayNumber(parts: DateOnlyParts): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return Math.trunc(date.getTime() / DAY_MS);
}

function partsFromDayNumber(value: number): DateOnlyParts | null {
  const date = new Date(value * DAY_MS);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  return { year, month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dueDateForIndex(schedule: BillSchedule, index: number): string | null {
  const anchor = parseDateOnlyParts(schedule.scheduleStartDate);
  if (index < 0 || !Number.isInteger(index)) throw new Error("Bill occurrence index must be a non-negative integer");

  if (schedule.recurrenceUnit === "NONE") return index === 0 ? schedule.scheduleStartDate : null;

  if (schedule.recurrenceUnit === "WEEK") {
    const target = partsFromDayNumber(dayNumber(anchor) + index * schedule.recurrenceInterval * 7);
    return target ? formatDateOnly(target) : null;
  }

  if (schedule.recurrenceUnit === "MONTH") {
    const absoluteAnchorMonth = anchor.year * 12 + (anchor.month - 1);
    const targetAbsoluteMonth = absoluteAnchorMonth + index * schedule.recurrenceInterval;
    const year = Math.floor(targetAbsoluteMonth / 12);
    if (year < 1 || year > 9999) return null;
    const month = (targetAbsoluteMonth % 12) + 1;
    const lastDay = daysInMonth(year, month);
    const day = schedule.recurrenceDayMode === "LAST_DAY" ? lastDay : Math.min(anchor.day, lastDay);
    return formatDateOnly({ year, month, day });
  }

  const year = anchor.year + index * schedule.recurrenceInterval;
  if (year < 1 || year > 9999) return null;
  const lastDay = daysInMonth(year, anchor.month);
  const day = schedule.recurrenceDayMode === "LAST_DAY" ? lastDay : Math.min(anchor.day, lastDay);
  return formatDateOnly({ year, month: anchor.month, day });
}

function estimatedStartIndex(schedule: BillSchedule, rangeStartDate: string): number {
  if (rangeStartDate <= schedule.scheduleStartDate || schedule.recurrenceUnit === "NONE") return 0;

  const anchor = parseDateOnlyParts(schedule.scheduleStartDate);
  const start = parseDateOnlyParts(rangeStartDate);
  let estimate = 0;

  if (schedule.recurrenceUnit === "WEEK") {
    const differenceDays = dayNumber(start) - dayNumber(anchor);
    estimate = Math.floor(differenceDays / (schedule.recurrenceInterval * 7));
  } else if (schedule.recurrenceUnit === "MONTH") {
    const differenceMonths = (start.year - anchor.year) * 12 + (start.month - anchor.month);
    estimate = Math.floor(differenceMonths / schedule.recurrenceInterval);
  } else {
    estimate = Math.floor((start.year - anchor.year) / schedule.recurrenceInterval);
  }

  return Math.max(0, estimate - 1);
}

export function billDueDatesInRange(schedule: BillSchedule, range: BillDateRange): string[] {
  validateBillSchedule(schedule);
  parseDateOnlyParts(range.startDate);
  parseDateOnlyParts(range.endDate);
  if (range.endDate < range.startDate) throw new Error("Bill date range end must not precede start");

  if (schedule.scheduleStartDate > range.endDate) return [];
  if (schedule.recurrenceUnit === "NONE") {
    return schedule.scheduleStartDate >= range.startDate && schedule.scheduleStartDate <= range.endDate
      ? [schedule.scheduleStartDate]
      : [];
  }

  const results: string[] = [];
  let index = estimatedStartIndex(schedule, range.startDate);
  let candidateSteps = 0;

  while (true) {
    candidateSteps += 1;
    if (candidateSteps > MAX_BILL_DUE_DATES_PER_RANGE + MAX_EXTRA_CANDIDATE_STEPS) {
      throw new Error(`Bill recurrence range exceeds ${MAX_BILL_DUE_DATES_PER_RANGE} supported due dates`);
    }

    const candidate = dueDateForIndex(schedule, index);
    if (candidate === null || candidate > range.endDate) break;

    if (candidate >= range.startDate) {
      results.push(candidate);
      if (results.length > MAX_BILL_DUE_DATES_PER_RANGE) {
        throw new Error(`Bill recurrence range exceeds ${MAX_BILL_DUE_DATES_PER_RANGE} supported due dates`);
      }
    }
    index += 1;
  }

  return results;
}

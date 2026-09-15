import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDateOnly,
  validateBillDefinitionCore,
  validateBillSchedule,
  type BillDefinitionCore,
  type BillSchedule,
} from "@/lib/runtime/bills";
import { billDueDatesInRange, MAX_BILL_DUE_DATES_PER_RANGE } from "@/lib/runtime/bill-schedule";

function schedule(overrides: Partial<BillSchedule> = {}): BillSchedule {
  return {
    scheduleStartDate: "2027-01-31",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
    ...overrides,
  };
}

function definition(overrides: Partial<BillDefinitionCore> = {}): BillDefinitionCore {
  return {
    ...schedule(),
    name: "Electric bill",
    payee: null,
    category: "Utilities",
    amountMode: "FIXED",
    defaultAmountMinor: 12_345,
    currency: "USD",
    autopay: false,
    paymentUrl: null,
    notes: null,
    reminderDaysBefore: 3,
    status: "ACTIVE",
    ...overrides,
  };
}

test("date-only validation rejects malformed and impossible calendar dates", () => {
  for (const value of ["2026-2-03", "2026-02-3", "2026-02-30", "2026-13-01", "0000-01-01", "2026-01-01T00:00:00Z", null]) {
    assert.equal(isDateOnly(value), false, String(value));
  }
  assert.equal(isDateOnly("2024-02-29"), true);
  assert.equal(isDateOnly("2025-02-28"), true);
});

test("bill definition validation enforces schedule, money, currency, and fixed/variable rules", () => {
  assert.doesNotThrow(() => validateBillDefinitionCore(definition()));
  assert.doesNotThrow(() => validateBillDefinitionCore(definition({ amountMode: "VARIABLE", defaultAmountMinor: null })));
  assert.throws(() => validateBillDefinitionCore(definition({ name: "   " })), /name/i);
  assert.throws(() => validateBillDefinitionCore(definition({ defaultAmountMinor: null })), /FIXED/);
  assert.throws(() => validateBillDefinitionCore(definition({ defaultAmountMinor: Number.MAX_SAFE_INTEGER + 1 })), /safe integer/);
  assert.throws(() => validateBillDefinitionCore(definition({ currency: "usd" })), /currency/i);
  assert.throws(() => validateBillDefinitionCore(definition({ reminderDaysBefore: 366 })), /reminder/i);
});

test("schedule validation enforces recurrence shape and LAST_DAY anchor semantics", () => {
  assert.doesNotThrow(() => validateBillSchedule(schedule()));
  assert.doesNotThrow(() => validateBillSchedule(schedule({ recurrenceUnit: "NONE", recurrenceInterval: 1, recurrenceDayMode: null })));
  assert.doesNotThrow(() => validateBillSchedule(schedule({ recurrenceUnit: "WEEK", recurrenceInterval: 4, recurrenceDayMode: null })));
  assert.throws(() => validateBillSchedule(schedule({ recurrenceInterval: 0 })), /interval/i);
  assert.throws(() => validateBillSchedule(schedule({ recurrenceInterval: 121 })), /interval/i);
  assert.throws(() => validateBillSchedule(schedule({ recurrenceUnit: "NONE", recurrenceInterval: 2, recurrenceDayMode: null })), /One-time/);
  assert.throws(() => validateBillSchedule(schedule({ recurrenceUnit: "WEEK", recurrenceDayMode: "ANCHOR_DATE" })), /Weekly/);
  assert.throws(() => validateBillSchedule(schedule({ recurrenceUnit: "MONTH", recurrenceDayMode: null })), /require a recurrence day mode/);
  assert.throws(() => validateBillSchedule(schedule({ scheduleStartDate: "2027-01-30", recurrenceDayMode: "LAST_DAY" })), /last day/i);
});

test("monthly anchor recurrence clamps short months without permanent drift", () => {
  assert.deepEqual(
    billDueDatesInRange(schedule(), { startDate: "2027-01-01", endDate: "2027-05-31" }),
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"],
  );
  assert.deepEqual(
    billDueDatesInRange(schedule({ scheduleStartDate: "2028-01-31" }), { startDate: "2028-01-01", endDate: "2028-03-31" }),
    ["2028-01-31", "2028-02-29", "2028-03-31"],
  );
});

test("yearly Feb-29 recurrence returns to Feb-29 in the next leap year", () => {
  const leap = schedule({ scheduleStartDate: "2024-02-29", recurrenceUnit: "YEAR", recurrenceInterval: 1 });
  assert.deepEqual(
    billDueDatesInRange(leap, { startDate: "2024-01-01", endDate: "2028-12-31" }),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
});

test("LAST_DAY and multi-month intervals preserve explicit calendar semantics", () => {
  const lastDay = schedule({ recurrenceDayMode: "LAST_DAY" });
  assert.deepEqual(
    billDueDatesInRange(lastDay, { startDate: "2027-01-31", endDate: "2027-04-30" }),
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
  );

  assert.deepEqual(
    billDueDatesInRange(schedule({ scheduleStartDate: "2027-01-15", recurrenceInterval: 2 }), { startDate: "2027-01-01", endDate: "2027-08-01" }),
    ["2027-01-15", "2027-03-15", "2027-05-15", "2027-07-15"],
  );
  assert.deepEqual(
    billDueDatesInRange(schedule({ scheduleStartDate: "2027-01-15", recurrenceInterval: 3 }), { startDate: "2027-01-01", endDate: "2027-12-31" }),
    ["2027-01-15", "2027-04-15", "2027-07-15", "2027-10-15"],
  );
  assert.deepEqual(
    billDueDatesInRange(schedule({ scheduleStartDate: "2027-01-15", recurrenceInterval: 6 }), { startDate: "2027-01-01", endDate: "2028-01-14" }),
    ["2027-01-15", "2027-07-15"],
  );
});

test("four-week recurrence is date-only and unaffected by daylight-saving transitions", () => {
  const everyFourWeeks = schedule({
    scheduleStartDate: "2026-02-15",
    recurrenceUnit: "WEEK",
    recurrenceInterval: 4,
    recurrenceDayMode: null,
  });
  assert.deepEqual(
    billDueDatesInRange(everyFourWeeks, { startDate: "2026-02-01", endDate: "2026-05-31" }),
    ["2026-02-15", "2026-03-15", "2026-04-12", "2026-05-10"],
  );
});

test("one-time and inclusive-range semantics are deterministic", () => {
  const oneTime = schedule({ recurrenceUnit: "NONE", recurrenceInterval: 1, recurrenceDayMode: null });
  assert.deepEqual(billDueDatesInRange(oneTime, { startDate: "2027-01-31", endDate: "2027-01-31" }), ["2027-01-31"]);
  assert.deepEqual(billDueDatesInRange(oneTime, { startDate: "2027-02-01", endDate: "2027-12-31" }), []);
  assert.deepEqual(
    billDueDatesInRange(schedule({ scheduleStartDate: "2027-01-15" }), { startDate: "2027-02-15", endDate: "2027-04-15" }),
    ["2027-02-15", "2027-03-15", "2027-04-15"],
  );
  assert.throws(() => billDueDatesInRange(schedule(), { startDate: "2027-03-01", endDate: "2027-02-01" }), /end must not precede start/);
});

test("old anchors seek near a current range instead of replaying history", () => {
  const old = schedule({ scheduleStartDate: "1900-01-31" });
  assert.deepEqual(
    billDueDatesInRange(old, { startDate: "2026-09-01", endDate: "2026-12-31" }),
    ["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"],
  );
});

test("generation rejects ranges containing more than the supported occurrence bound", () => {
  const weekly = schedule({
    scheduleStartDate: "2020-01-05",
    recurrenceUnit: "WEEK",
    recurrenceInterval: 1,
    recurrenceDayMode: null,
  });
  assert.equal(MAX_BILL_DUE_DATES_PER_RANGE, 512);
  assert.throws(
    () => billDueDatesInRange(weekly, { startDate: "2020-01-05", endDate: "2030-12-31" }),
    /512 supported due dates/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  addDateOnlyDays,
  billAmountPresentation,
  billOccurrenceDisplayState,
  billOccurrenceShapeChanged,
  dollarsInputToMinor,
  minorToDollarsInput,
  recurrenceLabel,
  summarizeOpenOccurrences,
} from "@/lib/bill-ui";
import type { HostedBill, HostedBillOccurrence } from "@/lib/runtime/hosted-bills";

function bill(overrides: Partial<HostedBill> = {}): HostedBill {
  return {
    billId: "bill-1",
    primaryWorkspaceId: "personal",
    name: "Internet",
    payee: "Provider",
    category: "Utilities",
    amountMode: "FIXED",
    defaultAmountMinor: 7500,
    currency: "USD",
    autopay: true,
    paymentUrl: "https://example.com/pay",
    notes: null,
    scheduleStartDate: "2026-09-20",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
    reminderDaysBefore: 3,
    status: "ACTIVE",
    createdByUserId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function occurrence(overrides: Partial<HostedBillOccurrence> = {}): HostedBillOccurrence {
  return {
    occurrenceId: "bill-1:2026-09-20",
    billId: "bill-1",
    dueDate: "2026-09-20",
    expectedAmountMinor: 7500,
    currency: "USD",
    status: "OPEN",
    paidAmountMinor: null,
    paidOn: null,
    resolvedByUserId: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("dollar input converts exactly to integer minor units", () => {
  assert.equal(dollarsInputToMinor("12"), 1200);
  assert.equal(dollarsInputToMinor("12.3"), 1230);
  assert.equal(dollarsInputToMinor("12.34"), 1234);
  assert.equal(dollarsInputToMinor(""), null);
  assert.equal(minorToDollarsInput(1234), "12.34");
  assert.throws(() => dollarsInputToMinor("12.345"));
  assert.throws(() => dollarsInputToMinor("-1"));
});

test("occurrence display state is date-only and resolved-safe", () => {
  assert.equal(billOccurrenceDisplayState(occurrence({ dueDate: "2026-09-14" }), "2026-09-15"), "OVERDUE");
  assert.equal(billOccurrenceDisplayState(occurrence({ dueDate: "2026-09-15" }), "2026-09-15"), "TODAY");
  assert.equal(billOccurrenceDisplayState(occurrence({ dueDate: "2026-09-16" }), "2026-09-15"), "UPCOMING");
  assert.equal(billOccurrenceDisplayState(occurrence({ status: "PAID" }), "2026-09-15"), "RESOLVED");
});

test("shape change matches the repository occurrence-affecting contract", () => {
  const original = bill();
  assert.equal(billOccurrenceShapeChanged(original, { ...original, name: "Fiber Internet" }), false);
  assert.equal(billOccurrenceShapeChanged(original, { ...original, status: "PAUSED" }), false);
  assert.equal(billOccurrenceShapeChanged(original, { ...original, defaultAmountMinor: 7600 }), true);
  assert.equal(billOccurrenceShapeChanged(original, { ...original, scheduleStartDate: "2026-09-21" }), true);
  assert.equal(billOccurrenceShapeChanged(original, { ...original, recurrenceInterval: 2 }), true);
});

test("amount presentation keeps variable estimates and unknowns explicit", () => {
  assert.deepEqual(billAmountPresentation(bill(), occurrence()), {
    label: "$75.00",
    qualifier: "Exact",
    unknown: false,
  });
  assert.deepEqual(billAmountPresentation(bill({ amountMode: "VARIABLE" }), occurrence({ expectedAmountMinor: 8200 })), {
    label: "$82.00",
    qualifier: "Estimated",
    unknown: false,
  });
  assert.deepEqual(billAmountPresentation(bill({ amountMode: "VARIABLE", defaultAmountMinor: null }), occurrence({ expectedAmountMinor: null })), {
    label: "Amount unknown",
    qualifier: "Amount unknown",
    unknown: true,
  });
});

test("summary never treats unknown amounts as zero dollars", () => {
  const bills = [bill(), bill({ billId: "bill-2", name: "Electric", amountMode: "VARIABLE", defaultAmountMinor: null })];
  const occurrences = [
    occurrence(),
    occurrence({ occurrenceId: "bill-2:2026-09-18", billId: "bill-2", dueDate: "2026-09-18", expectedAmountMinor: null }),
    occurrence({ occurrenceId: "outside", dueDate: "2026-10-10" }),
    occurrence({ occurrenceId: "paid", dueDate: "2026-09-17", status: "PAID", paidOn: "2026-09-17", resolvedAt: "2026-09-17T12:00:00.000Z" }),
  ];
  assert.deepEqual(summarizeOpenOccurrences(occurrences, bills, "2026-09-15", "2026-09-21"), {
    count: 2,
    knownTotalMinor: 7500,
    unknownCount: 1,
    estimatedCount: 0,
  });
});

test("date and recurrence labels remain stable across month boundaries", () => {
  assert.equal(addDateOnlyDays("2026-09-30", 1), "2026-10-01");
  assert.equal(recurrenceLabel(bill()), "Monthly");
  assert.equal(recurrenceLabel(bill({ recurrenceInterval: 3 })), "Every 3 months");
  assert.equal(recurrenceLabel(bill({ recurrenceDayMode: "LAST_DAY", scheduleStartDate: "2026-09-30" })), "Monthly · last day");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  billOccurrenceIsOverdue,
  billOccurrencesNeedingAttentionToday,
  billProjectionWorkspaceIds,
  projectOpenBillOccurrences,
  type BillWorkspaceSummary,
} from "../lib/bill-projections";
import type { ProductWorkspaceId } from "../lib/runtime/context";
import type { HostedBill, HostedBillOccurrence } from "../lib/runtime/hosted-bills";

function bill(workspaceId: ProductWorkspaceId, overrides: Partial<HostedBill> = {}): HostedBill {
  return {
    billId: `${workspaceId}-bill`,
    primaryWorkspaceId: workspaceId,
    name: workspaceId === "personal" ? "Personal bill" : "Business bill",
    payee: null,
    category: "Utilities",
    amountMode: "FIXED",
    defaultAmountMinor: 1234,
    currency: "USD",
    autopay: false,
    paymentUrl: null,
    notes: null,
    scheduleStartDate: "2026-09-15",
    recurrenceUnit: "MONTH",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
    reminderDaysBefore: 3,
    status: "ACTIVE",
    createdByUserId: "user",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function occurrence(source: HostedBill, dueDate: string, overrides: Partial<HostedBillOccurrence> = {}): HostedBillOccurrence {
  return {
    occurrenceId: `${source.billId}:${dueDate}`,
    billId: source.billId,
    dueDate,
    expectedAmountMinor: source.defaultAmountMinor,
    currency: source.currency,
    status: "OPEN",
    paidAmountMinor: null,
    paidOn: null,
    resolvedByUserId: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function summary(workspaceId: ProductWorkspaceId, bills: HostedBill[], occurrences: HostedBillOccurrence[]): BillWorkspaceSummary {
  return { workspaceId, bills, occurrences };
}

test("uses Personal roll-up only across authorized logical workspaces", () => {
  assert.deepEqual(billProjectionWorkspaceIds("personal", ["personal", "indelitech"]), ["personal", "indelitech"]);
  assert.deepEqual(billProjectionWorkspaceIds("personal", ["personal"]), ["personal"]);
  assert.deepEqual(billProjectionWorkspaceIds("indelitech", ["personal", "indelitech"]), ["indelitech"]);
  assert.deepEqual(billProjectionWorkspaceIds("indelitech", ["personal"]), []);
});

test("projects only open occurrences for active canonical bills and preserves identity", () => {
  const personal = bill("personal");
  const paused = bill("personal", { billId: "paused", status: "PAUSED" });
  const open = occurrence(personal, "2026-09-15");
  const paid = occurrence(personal, "2026-10-15", { occurrenceId: "paid", status: "PAID", paidOn: "2026-10-15", paidAmountMinor: 1234 });
  const pausedOccurrence = occurrence(paused, "2026-09-16");

  const projected = projectOpenBillOccurrences([summary("personal", [personal, paused], [open, paid, pausedOccurrence])]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].bill, personal);
  assert.equal(projected[0].occurrence, open);
  assert.equal(projected[0].workspaceId, "personal");
});

test("sorts cross-workspace bill occurrences deterministically", () => {
  const personal = bill("personal");
  const business = bill("indelitech");
  const projected = projectOpenBillOccurrences([
    summary("indelitech", [business], [occurrence(business, "2026-09-20")]),
    summary("personal", [personal], [occurrence(personal, "2026-09-19")]),
  ]);
  assert.deepEqual(projected.map(({ workspaceId, occurrence: item }) => [workspaceId, item.dueDate]), [
    ["personal", "2026-09-19"],
    ["indelitech", "2026-09-20"],
  ]);
});

test("Today includes overdue and due-today bills but not future obligations", () => {
  const personal = bill("personal");
  const projected = projectOpenBillOccurrences([summary("personal", [personal], [
    occurrence(personal, "2026-09-14", { occurrenceId: "overdue" }),
    occurrence(personal, "2026-09-15", { occurrenceId: "today" }),
    occurrence(personal, "2026-09-16", { occurrenceId: "future" }),
  ])]);
  const attention = billOccurrencesNeedingAttentionToday(projected, "2026-09-15");
  assert.deepEqual(attention.map(({ occurrence: item }) => item.occurrenceId), ["overdue", "today"]);
  assert.equal(billOccurrenceIsOverdue(attention[0], "2026-09-15"), true);
  assert.equal(billOccurrenceIsOverdue(attention[1], "2026-09-15"), false);
});

test("Today and Calendar use canonical bill occurrences instead of synthetic tasks", async () => {
  const [today, calendar] = await Promise.all([
    readFile(new URL("../components/today-task-agenda.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/task-calendar.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(today, /useProjectedBills\(workspaceId\)/);
  assert.match(today, /router\.push\(`\/bills\?workspaceId=/);
  assert.match(today, /WalletCards/);
  assert.match(calendar, /useProjectedBills\(workspaceId\)/);
  assert.match(calendar, /Derived from canonical tasks and bill occurrences/);
  assert.match(calendar, /router\.push\(`\/bills\?workspaceId=/);
  assert.doesNotMatch(today, /createTaskItem/);
  assert.doesNotMatch(calendar, /createTaskItem/);
});

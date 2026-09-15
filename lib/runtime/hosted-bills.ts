import type { ProductWorkspaceId } from "@/lib/runtime/context";
import {
  isDateOnly,
  validateBillDefinitionCore,
  type BillDefinitionCore,
  type BillOccurrenceStatus,
} from "@/lib/runtime/bills";

export type HostedBill = BillDefinitionCore & Readonly<{
  billId: string;
  primaryWorkspaceId: ProductWorkspaceId;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type HostedBillOccurrence = Readonly<{
  occurrenceId: string;
  billId: string;
  dueDate: string;
  expectedAmountMinor: number | null;
  currency: string;
  status: BillOccurrenceStatus;
  paidAmountMinor: number | null;
  paidOn: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type BillOccurrenceResolutionAction = "PAID" | "SKIPPED" | "CANCELLED";

export type BillOccurrenceResolutionInput = Readonly<{
  action: BillOccurrenceResolutionAction;
  paidOn?: string | null;
  paidAmountMinor?: number | null;
  resolutionNote?: string | null;
}>;

function validateMinorAmount(value: unknown, field: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative JavaScript safe integer or null`);
  }
}

export function validateHostedBillDefinition(value: BillDefinitionCore): void {
  validateBillDefinitionCore(value);
  if (value.paymentUrl === null) return;

  let parsed: URL;
  try {
    parsed = new URL(value.paymentUrl);
  } catch {
    throw new Error("Bill payment URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Bill payment URL must be HTTPS and must not contain credentials");
  }
}

export function validateBillOccurrenceResolutionInput(value: BillOccurrenceResolutionInput): void {
  if (!(["PAID", "SKIPPED", "CANCELLED"] as const).includes(value.action)) {
    throw new Error("Invalid bill occurrence resolution action");
  }
  if (value.resolutionNote !== undefined && value.resolutionNote !== null &&
      (typeof value.resolutionNote !== "string" || value.resolutionNote.length > 2000)) {
    throw new Error("Bill resolution note must be null or a string up to 2000 characters");
  }

  validateMinorAmount(value.paidAmountMinor, "Paid amount");
  if (value.action === "PAID") {
    if (!isDateOnly(value.paidOn)) throw new Error("Paid occurrences require a valid paidOn date");
    return;
  }
  if (value.paidOn !== undefined && value.paidOn !== null) {
    throw new Error("Skipped or cancelled occurrences cannot have a paidOn date");
  }
  if (value.paidAmountMinor !== undefined && value.paidAmountMinor !== null) {
    throw new Error("Skipped or cancelled occurrences cannot have a paid amount");
  }
}

import type { ProductWorkspaceId } from "@/lib/runtime/context";
import { isDateOnly } from "@/lib/runtime/bills";
import {
  validateIncomeDefinitionCore,
  type IncomeDefinitionCore,
  type IncomeOccurrenceStatus,
} from "@/lib/runtime/income";

export type HostedIncomeSource = IncomeDefinitionCore & Readonly<{
  incomeSourceId: string;
  primaryWorkspaceId: ProductWorkspaceId;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type HostedIncomeOccurrence = Readonly<{
  occurrenceId: string;
  incomeSourceId: string;
  payDate: string;
  expectedAmountMinor: number | null;
  currency: string;
  status: IncomeOccurrenceStatus;
  receivedAmountMinor: number | null;
  receivedOn: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type IncomeOccurrenceResolutionAction = "RECEIVED" | "SKIPPED" | "CANCELLED";

export type IncomeOccurrenceResolutionInput = Readonly<{
  action: IncomeOccurrenceResolutionAction;
  receivedOn?: string | null;
  receivedAmountMinor?: number | null;
  resolutionNote?: string | null;
}>;

export type CashflowBaselineInput = Readonly<{
  amountMinor: number;
  currency: string;
  asOfDate: string;
}>;

export type HostedCashflowBaseline = CashflowBaselineInput & Readonly<{
  primaryWorkspaceId: ProductWorkspaceId;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_SAFE_MINOR_AMOUNT = Number.MAX_SAFE_INTEGER;

function validateUnsignedMinor(value: unknown, field: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MINOR_AMOUNT) {
    throw new Error(`${field} must be a non-negative JavaScript safe integer or null`);
  }
}

export function validateHostedIncomeDefinition(value: IncomeDefinitionCore): void {
  validateIncomeDefinitionCore(value);
}

export function validateIncomeOccurrenceResolutionInput(value: IncomeOccurrenceResolutionInput): void {
  if (!(["RECEIVED", "SKIPPED", "CANCELLED"] as const).includes(value.action)) {
    throw new Error("Invalid income occurrence resolution action");
  }
  if (value.resolutionNote !== undefined && value.resolutionNote !== null &&
      (typeof value.resolutionNote !== "string" || value.resolutionNote.length > 2000)) {
    throw new Error("Income resolution note must be null or a string up to 2000 characters");
  }

  validateUnsignedMinor(value.receivedAmountMinor, "Received amount");
  if (value.action === "RECEIVED") {
    if (!isDateOnly(value.receivedOn)) throw new Error("Received income requires a valid receivedOn date");
    return;
  }
  if (value.receivedOn !== undefined && value.receivedOn !== null) {
    throw new Error("Skipped or cancelled income cannot have a receivedOn date");
  }
  if (value.receivedAmountMinor !== undefined && value.receivedAmountMinor !== null) {
    throw new Error("Skipped or cancelled income cannot have a received amount");
  }
}

export function validateCashflowBaselineInput(value: CashflowBaselineInput): void {
  if (typeof value.amountMinor !== "number" || !Number.isSafeInteger(value.amountMinor) ||
      Math.abs(value.amountMinor) > MAX_SAFE_MINOR_AMOUNT) {
    throw new Error("Cash-flow baseline amount must be a signed JavaScript safe integer");
  }
  if (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency)) {
    throw new Error("Cash-flow baseline currency must be an uppercase three-letter code");
  }
  if (!isDateOnly(value.asOfDate)) throw new Error("Cash-flow baseline as-of date must be a valid calendar date");
}

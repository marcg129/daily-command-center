import { isDateOnly, validateBillSchedule, type BillSchedule } from "./bills";
import { isProductWorkspaceId, type ProductWorkspaceId } from "./context";

export const INTAKE_TYPES = ["TASK", "FOLLOW_UP", "BILL", "AWARENESS"] as const;
export const INTAKE_STATUSES = ["PENDING", "DEFERRED", "APPROVED", "DISMISSED", "ARCHIVED"] as const;
export const DAILY_INTAKE_SOURCE_KEYS = [
  "personal_gmail",
  "professional_gmail",
  "indelitech_gmail",
  "primary_calendar",
  "family_calendar",
] as const;

export const GMAIL_INTAKE_SOURCE_KEYS = ["personal_gmail", "professional_gmail", "indelitech_gmail"] as const;
export const CALENDAR_INTAKE_SOURCE_KEYS = ["primary_calendar", "family_calendar"] as const;
export const INTAKE_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export type IntakeType = (typeof INTAKE_TYPES)[number];
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
export type DailyIntakeSourceKey = (typeof DAILY_INTAKE_SOURCE_KEYS)[number];
export type GmailIntakeSourceKey = (typeof GMAIL_INTAKE_SOURCE_KEYS)[number];
export type CalendarIntakeSourceKey = (typeof CALENDAR_INTAKE_SOURCE_KEYS)[number];
export type IntakePriority = (typeof INTAKE_PRIORITIES)[number];
export type IntakeSourceType = "gmail" | "calendar";
export type BillProposalRecurrence = BillSchedule;

export type IntakeProposalInput = Readonly<{
  scanRunId: string;
  workspaceId: ProductWorkspaceId;
  sourceKey: DailyIntakeSourceKey;
  sourceType: IntakeSourceType;
  messageId?: string;
  threadId?: string;
  eventId?: string;
  seriesId?: string;
  proposalOrdinal: number;
  sourceTimestamp: string;
  sender?: string;
  subject?: string;
  sourceUrl?: string;
  intakeType: IntakeType;
  title: string;
  summary: string;
  classificationReason: string;
  dueDate?: string;
  followUpAt?: string;
  priority?: IntakePriority;
  amountMinor?: number;
  currency?: string;
  recurrence?: BillProposalRecurrence;
}>;

export type IntakeEditablePatch = Readonly<{
  workspaceId?: ProductWorkspaceId;
  title?: string;
  dueDate?: string | null;
  followUpAt?: string | null;
  priority?: IntakePriority | null;
  amountMinor?: number | null;
  currency?: string | null;
  recurrence?: BillProposalRecurrence | null;
}>;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY = /^[A-Z]{3}$/;

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

function assertBoundedText(value: unknown, field: string, maxLength: number, required = false): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength || (required && value.trim().length === 0)) {
    throw new Error(`${field} must be ${required ? "nonblank " : ""}text up to ${maxLength} characters`);
  }
}

function assertOptionalBoundedText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return;
  assertBoundedText(value, field, maxLength);
}

export function isExactInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function assertExactInstant(value: unknown, field: string): asserts value is string {
  if (!isExactInstant(value)) throw new Error(`${field} timestamp must be an ISO-8601 instant with a timezone`);
}

export function isGoogleSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" &&
      !parsed.username && !parsed.password &&
      (hostname === "google.com" || hostname.endsWith(".google.com"));
  } catch {
    return false;
  }
}

function sourceTypeMatches(sourceKey: DailyIntakeSourceKey, sourceType: IntakeSourceType): boolean {
  return sourceType === "gmail"
    ? includes(GMAIL_INTAKE_SOURCE_KEYS, sourceKey)
    : includes(CALENDAR_INTAKE_SOURCE_KEYS, sourceKey);
}

export function validateIntakeProposalInput(value: IntakeProposalInput): void {
  if (!value || typeof value !== "object") throw new Error("Intake proposal is required");

  assertBoundedText(value.scanRunId, "Scan run ID", 200, true);
  if (!isProductWorkspaceId(value.workspaceId)) throw new Error("Intake workspace must be personal or indelitech");
  if (!includes(DAILY_INTAKE_SOURCE_KEYS, value.sourceKey)) throw new Error("Intake source key is not supported");
  if (value.sourceType !== "gmail" && value.sourceType !== "calendar") throw new Error("Intake source type is not supported");
  if (!sourceTypeMatches(value.sourceKey, value.sourceType)) throw new Error("Intake source type does not match its source key");

  if (!Number.isSafeInteger(value.proposalOrdinal) || value.proposalOrdinal < 1 || value.proposalOrdinal > 10_000) {
    throw new Error("Proposal ordinal must be an integer from 1 through 10000");
  }
  assertExactInstant(value.sourceTimestamp, "Source");

  if (value.sourceType === "gmail") {
    assertBoundedText(value.messageId, "Gmail message ID", 1024, true);
    assertOptionalBoundedText(value.threadId, "Gmail thread ID", 1024);
    if (value.eventId !== undefined || value.seriesId !== undefined) {
      throw new Error("Gmail sources cannot supply Calendar event identity");
    }
  } else {
    assertBoundedText(value.eventId, "Calendar event ID", 1024, true);
    assertOptionalBoundedText(value.seriesId, "Calendar series ID", 1024);
    if (value.messageId !== undefined || value.threadId !== undefined) {
      throw new Error("Calendar sources cannot supply Gmail message identity");
    }
  }

  assertOptionalBoundedText(value.sender, "Source sender", 500);
  assertOptionalBoundedText(value.subject, "Source subject", 1000);
  if (value.sourceUrl !== undefined && !isGoogleSourceUrl(value.sourceUrl)) {
    throw new Error("Source URL must be a credential-free HTTPS Google URL");
  }

  if (!includes(INTAKE_TYPES, value.intakeType)) throw new Error("Intake type is not supported");
  assertBoundedText(value.title, "Intake title", 300, true);
  assertBoundedText(value.summary, "Intake summary", 4000, true);
  assertBoundedText(value.classificationReason, "Classification reason", 3000, true);

  if (value.dueDate !== undefined && !isDateOnly(value.dueDate)) {
    throw new Error("Intake due date must be an exact calendar date");
  }
  if (value.followUpAt !== undefined) assertExactInstant(value.followUpAt, "Follow-up");
  if (value.priority !== undefined && !includes(INTAKE_PRIORITIES, value.priority)) {
    throw new Error("Intake priority must be LOW, MEDIUM, or HIGH");
  }

  const hasAmount = value.amountMinor !== undefined;
  const hasCurrency = value.currency !== undefined;
  if (hasAmount && (!Number.isSafeInteger(value.amountMinor) || value.amountMinor! < 0)) {
    throw new Error("Intake amount must be a non-negative JavaScript safe integer");
  }
  if (hasCurrency && (typeof value.currency !== "string" || !CURRENCY.test(value.currency))) {
    throw new Error("Intake currency must be an uppercase three-letter code");
  }
  if (hasAmount !== hasCurrency) throw new Error("Intake amount and currency must be supplied together");

  if (value.recurrence !== undefined) validateBillSchedule(value.recurrence);
  if ((hasAmount || hasCurrency || value.recurrence !== undefined) && value.intakeType !== "BILL") {
    throw new Error("Only Bill proposals may include amount, currency, or recurrence");
  }
}

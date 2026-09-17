import {
  validateScanStatusInput,
  validateIntakeProposalInput,
  type IntakeProposalInput,
  type ScanStatusInput,
} from "./daily-intake";
import {
  validateCalendarSyncInput,
  type CalendarSyncInput,
} from "./calendar-projections";
import {
  TodoistTaskIngressValidationError,
  validateTodoistRelayTaskId,
  type TodoistRelayTask,
} from "./todoist-task-ingress";

export const TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES = 8192;

export type ParsedDccEnvelope =
  | Readonly<{ kind: "intake_proposal"; payload: IntakeProposalInput }>
  | Readonly<{ kind: "calendar_sync"; payload: CalendarSyncInput }>
  | Readonly<{ kind: "scan_status"; payload: ScanStatusInput }>;

const INTAKE_KEYS = new Set([
  "scanRunId", "workspaceId", "sourceKey", "sourceType", "messageId", "threadId", "eventId", "seriesId",
  "proposalOrdinal", "sourceTimestamp", "sender", "subject", "sourceUrl", "intakeType", "title", "summary",
  "classificationReason", "dueDate", "followUpAt", "priority", "amountMinor", "currency", "recurrence",
]);
const RECURRENCE_KEYS = new Set(["scheduleStartDate", "recurrenceUnit", "recurrenceInterval", "recurrenceDayMode"]);
const CALENDAR_SYNC_KEYS = new Set(["scanRunId", "sourceKey", "windowStart", "windowEnd", "batchIndex", "batchCount", "events"]);
const CALENDAR_EVENT_KEYS = new Set([
  "eventId", "seriesId", "occurrenceId", "title", "start", "end", "allDay", "location", "sourceUrl",
  "automaticWorkspaceId", "cancelled",
]);
const SCAN_STATUS_KEYS = new Set(["scanRunId", "sources"]);
const SCAN_SOURCE_KEYS = new Set(["sourceKey", "state", "attemptedAt", "completedAt", "diagnostic"]);

function fail(message: string): never {
  throw new TodoistTaskIngressValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} payload must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`Unsupported ${label} field: ${key}.`);
  }
}

function validateStrictIntake(value: unknown): IntakeProposalInput {
  assertOnlyKeys(value, INTAKE_KEYS, "intake proposal");
  if (value.recurrence !== undefined) assertOnlyKeys(value.recurrence, RECURRENCE_KEYS, "intake recurrence");
  try {
    validateIntakeProposalInput(value as IntakeProposalInput);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid intake proposal payload.");
  }
  return value as IntakeProposalInput;
}

function validateStrictCalendar(value: unknown): CalendarSyncInput {
  assertOnlyKeys(value, CALENDAR_SYNC_KEYS, "calendar sync");
  if (!Array.isArray(value.events)) fail("Calendar sync events must be an array.");
  for (const event of value.events) assertOnlyKeys(event, CALENDAR_EVENT_KEYS, "calendar event");
  try {
    validateCalendarSyncInput(value as CalendarSyncInput);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid calendar sync payload.");
  }
  return value as CalendarSyncInput;
}

function validateStrictScanStatus(value: unknown): ScanStatusInput {
  assertOnlyKeys(value, SCAN_STATUS_KEYS, "scan status");
  if (!Array.isArray(value.sources)) fail("Scan status sources must be an array.");
  for (const source of value.sources) assertOnlyKeys(source, SCAN_SOURCE_KEYS, "scan source status");
  try {
    validateScanStatusInput(value as ScanStatusInput);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid scan status payload.");
  }
  return value as ScanStatusInput;
}

export function isVersionedDccEnvelope(task: TodoistRelayTask): boolean {
  return /^dccEnvelopeVersion:/m.test(task.description ?? "");
}

export function parseTodoistIngressEnvelope(task: TodoistRelayTask): ParsedDccEnvelope {
  validateTodoistRelayTaskId(task.id);
  const description = task.description ?? "";
  const lines = description.split(/\r?\n/);
  if (lines.length !== 3) fail("DCC envelope must contain exactly three metadata lines.");

  const versionMatch = /^dccEnvelopeVersion:\s*(\S+)\s*$/.exec(lines[0]);
  const kindMatch = /^kind:\s*(\S+)\s*$/.exec(lines[1]);
  const payloadMatch = /^payload:\s*(.*)$/.exec(lines[2]);
  if (!versionMatch || !kindMatch || !payloadMatch) {
    fail("DCC envelope must contain exactly the version, kind, and single-line payload metadata.");
  }
  if (versionMatch[1] !== "1") fail("Unsupported DCC envelope version.");

  const payloadText = payloadMatch[1];
  if (!payloadText || /[\r\n]/.test(payloadText)) fail("DCC envelope payload must be single-line JSON.");
  if (new TextEncoder().encode(payloadText).byteLength > TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES) {
    fail(`DCC envelope payload exceeds the ${TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES}-byte size limit.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    fail("DCC envelope payload must be valid JSON.");
  }

  switch (kindMatch[1]) {
    case "intake_proposal":
      return { kind: "intake_proposal", payload: validateStrictIntake(payload) };
    case "calendar_sync":
      return { kind: "calendar_sync", payload: validateStrictCalendar(payload) };
    case "scan_status":
      return { kind: "scan_status", payload: validateStrictScanStatus(payload) };
    default:
      fail("Unsupported DCC envelope kind.");
  }
}

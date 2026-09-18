import {
  parseStructuredTaskCapture,
  type StructuredTaskCapture,
} from "./task-capture";

export type TodoistRelayDue = Readonly<{
  date: string;
  timezone?: string | null;
  isRecurring?: boolean;
}>;

export type TodoistRelayTask = Readonly<{
  id: string;
  content: string;
  description?: string | null;
  addedAt?: string;
  priority?: number | null;
  due?: TodoistRelayDue | null;
}>;

const TODOIST_TASK_ID = /^[A-Za-z0-9_-]{1,96}$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;
const FLOATING_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const OFFSET_DATETIME = /(?:Z|[+-]\d{2}:\d{2})$/i;
const TRANSPORT_ONLY_KEYS = new Set(["source", "requestId"]);
const CAPTURE_METADATA_KEYS = new Map<string, keyof StructuredTaskCapture>([
  ["workspace", "workspaceId"],
  ["context", "context"],
  ["category", "category"],
  ["project", "project"],
  ["person", "person"],
  ["type", "type"],
  ["priority", "priority"],
  ["due", "due"],
  ["remindAt", "remindAt"],
  ["followUpAt", "followUpAt"],
  ["estimatedDuration", "estimatedDuration"],
  ["recurrence", "recurrence"],
  ["dependency", "dependency"],
  ["sourceContext", "sourceContext"],
]);
const ALL_METADATA_KEYS = new Set([
  ...TRANSPORT_ONLY_KEYS,
  ...CAPTURE_METADATA_KEYS.keys(),
]);

export class TodoistTaskIngressValidationError extends Error {}

function fail(message: string): never {
  throw new TodoistTaskIngressValidationError(message);
}

export function validateTodoistRelayTaskId(value: string): string {
  const id = value.trim();
  if (!TODOIST_TASK_ID.test(id)) fail("Todoist task id is invalid.");
  return id;
}

function looksLikeRelayMetadata(description: string): boolean {
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const keyMatch = /^([A-Za-z][A-Za-z0-9]*):/.exec(line);
    if (keyMatch && ALL_METADATA_KEYS.has(keyMatch[1])) return true;
    if (/^workspace\s+/i.test(line)) return true;
  }
  return false;
}

function relayMetadata(description: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) fail("Todoist relay metadata must use `key: value` lines.");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) fail("Todoist relay metadata must use `key: value` lines.");
    if (result.has(key)) fail(`Duplicate metadata field: ${key}.`);
    if (!TRANSPORT_ONLY_KEYS.has(key) && !CAPTURE_METADATA_KEYS.has(key)) {
      fail(`Unsupported metadata field: ${key}.`);
    }
    result.set(key, value);
  }
  return result;
}

function todoistPriority(value: number | null | undefined): StructuredTaskCapture["priority"] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 4) fail("Todoist priority is invalid.");
  if (value >= 3) return "HIGH";
  if (value === 2) return "MEDIUM";
  return "LOW";
}

function zonedParts(timestampMs: number, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    fail("Todoist due timezone is invalid.");
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestampMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function floatingTodoistTimeToIso(value: string, timeZone: string): string {
  const match = FLOATING_DATETIME.exec(value);
  if (!match) fail("Todoist due time is invalid.");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((fractionText + "000").slice(0, 3));
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (!Number.isFinite(localAsUtc)) fail("Todoist due time is invalid.");

  let instant = localAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedParts(instant, timeZone);
    const renderedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      millisecond,
    );
    const next = localAsUtc - (renderedAsUtc - instant);
    if (next === instant) break;
    instant = next;
  }

  const verified = zonedParts(instant, timeZone);
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== minute ||
    verified.second !== second
  ) {
    fail("Todoist due time is invalid for its timezone.");
  }
  return new Date(instant).toISOString();
}

function nativeDue(due: TodoistRelayDue | null | undefined): { due?: string; remindAt?: string } {
  if (due === null || due === undefined) return {};
  if (typeof due.date !== "string") fail("Todoist due date is invalid.");
  const dateMatch = DATE_PREFIX.exec(due.date);
  if (!dateMatch) fail("Todoist due date is invalid.");
  const date = dateMatch[1];

  if (!due.date.includes("T")) return { due: date };
  if (OFFSET_DATETIME.test(due.date)) {
    const parsed = Date.parse(due.date);
    if (!Number.isFinite(parsed)) fail("Todoist due time is invalid.");
    return { due: date, remindAt: new Date(parsed).toISOString() };
  }
  if (due.timezone) {
    return { due: date, remindAt: floatingTodoistTimeToIso(due.date, due.timezone) };
  }
  return { due: date };
}

/**
 * Converts one task from the dedicated Todoist relay project into the existing
 * canonical DCC structured-capture contract.
 *
 * Structured descriptions continue to use the explicit metadata contract.
 * A normal Todoist task is a supported fallback: it defaults to Personal,
 * preserves prose as context, and uses native Todoist priority/due data.
 *
 * Todoist's task ID is always authoritative for idempotency. A description may
 * contain the conversation's requestId for diagnostics, but it can never select
 * or overwrite the DCC requestId.
 */
export function parseTodoistRelayTask(task: TodoistRelayTask): StructuredTaskCapture {
  const id = validateTodoistRelayTaskId(task.id);
  const title = task.content.trim();
  if (!title) fail("title is required.");

  const description = task.description ?? "";
  const structured = looksLikeRelayMetadata(description);
  const metadata = structured ? relayMetadata(description) : new Map<string, string>();
  if (task.due?.isRecurring && !metadata.has("recurrence")) {
    fail("Recurring Todoist relay tasks require explicit recurrence metadata.");
  }

  const capture: Record<string, unknown> = {
    requestId: `todoist:${id}`,
    workspaceId: "personal",
    title,
  };

  if (!structured && description.trim()) capture.context = description.trim();

  for (const [transportKey, captureKey] of CAPTURE_METADATA_KEYS) {
    if (!metadata.has(transportKey)) continue;
    capture[captureKey] = metadata.get(transportKey);
  }

  if (!metadata.has("priority")) {
    const priority = todoistPriority(task.priority);
    if (priority !== undefined) capture.priority = priority;
  }

  if (!metadata.has("due")) {
    const due = nativeDue(task.due);
    if (due.due !== undefined) capture.due = due.due;
    if (!metadata.has("remindAt") && due.remindAt !== undefined) capture.remindAt = due.remindAt;
  }

  const parsed = parseStructuredTaskCapture(capture);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  ) as StructuredTaskCapture;
}

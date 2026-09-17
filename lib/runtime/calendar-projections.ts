import { isDateOnly } from "./bills";
import { isProductWorkspaceId, type ProductWorkspaceId } from "./context";
import { isExactInstant, isGoogleSourceUrl } from "./daily-intake";

export const CALENDAR_SOURCE_KEYS = ["primary_calendar", "family_calendar"] as const;
export const CALENDAR_OVERRIDE_SCOPES = ["SERIES", "OCCURRENCE"] as const;
export const CALENDAR_PROJECTION_STATUSES = ["ACTIVE", "REMOVED", "CANCELLED"] as const;

export type CalendarSourceKey = (typeof CALENDAR_SOURCE_KEYS)[number];
export type CalendarOverrideScope = (typeof CALENDAR_OVERRIDE_SCOPES)[number];
export type CalendarProjectionStatus = (typeof CALENDAR_PROJECTION_STATUSES)[number];

export type CalendarEventInput = Readonly<{
  eventId: string;
  seriesId?: string;
  occurrenceId?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  sourceUrl?: string;
  automaticWorkspaceId?: ProductWorkspaceId;
  cancelled: boolean;
}>;

export type CalendarSyncInput = Readonly<{
  scanRunId: string;
  sourceKey: CalendarSourceKey;
  windowStart: string;
  windowEnd: string;
  batchIndex: number;
  batchCount: number;
  events: readonly CalendarEventInput[];
}>;

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

function assertText(value: unknown, field: string, maxLength: number, required = false): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength || (required && value.trim().length === 0)) {
    throw new Error(`${field} must be ${required ? "nonblank " : ""}text up to ${maxLength} characters`);
  }
}

function assertOptionalText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return;
  assertText(value, field, maxLength);
}

function validateEventTime(event: CalendarEventInput): void {
  if (event.allDay) {
    if (!isDateOnly(event.start) || !isDateOnly(event.end)) {
      throw new Error("All-day Calendar events require exact date values");
    }
    if (event.end <= event.start) throw new Error("All-day Calendar event end date must follow its start date");
    return;
  }

  if (!isExactInstant(event.start) || !isExactInstant(event.end)) {
    throw new Error("Timed Calendar events require timestamp values with timezones");
  }
  if (Date.parse(event.end) <= Date.parse(event.start)) {
    throw new Error("Timed Calendar event end timestamp must follow its start timestamp");
  }
}

export function validateCalendarSyncInput(value: CalendarSyncInput): void {
  if (!value || typeof value !== "object") throw new Error("Calendar sync input is required");
  assertText(value.scanRunId, "Calendar scan run ID", 200, true);
  if (!includes(CALENDAR_SOURCE_KEYS, value.sourceKey)) throw new Error("Calendar source is not supported");
  if (!isExactInstant(value.windowStart) || !isExactInstant(value.windowEnd)) {
    throw new Error("Calendar sync window must use exact timestamp values with timezones");
  }
  const startMs = Date.parse(value.windowStart);
  const endMs = Date.parse(value.windowEnd);
  if (endMs <= startMs) throw new Error("Calendar sync window end must follow its start");
  if (endMs - startMs > 46 * 24 * 60 * 60 * 1000) {
    throw new Error("Calendar sync window exceeds the supported 45-day horizon");
  }

  if (!Number.isSafeInteger(value.batchCount) || value.batchCount < 1 || value.batchCount > 1000) {
    throw new Error("Calendar batch count must be an integer from 1 through 1000");
  }
  if (!Number.isSafeInteger(value.batchIndex) || value.batchIndex < 1 || value.batchIndex > value.batchCount) {
    throw new Error("Calendar batch index must be within the declared batch count");
  }
  if (!Array.isArray(value.events) || value.events.length > 500) {
    throw new Error("Calendar batch events must be an array containing at most 500 events");
  }

  const seenEventIds = new Set<string>();
  for (const event of value.events) {
    if (!event || typeof event !== "object") throw new Error("Calendar event must be an object");
    assertText(event.eventId, "Calendar event ID", 1024, true);
    if (seenEventIds.has(event.eventId)) throw new Error("Calendar event IDs must be unique within a batch");
    seenEventIds.add(event.eventId);

    assertOptionalText(event.seriesId, "Calendar series ID", 1024);
    assertOptionalText(event.occurrenceId, "Calendar occurrence ID", 1024);
    assertText(event.title, "Calendar event title", 500, true);
    if (typeof event.allDay !== "boolean") throw new Error("Calendar event allDay must be boolean");
    if (typeof event.cancelled !== "boolean") throw new Error("Calendar event cancelled must be boolean");
    validateEventTime(event);
    assertOptionalText(event.location, "Calendar event location", 1000);
    if (event.sourceUrl !== undefined && !isGoogleSourceUrl(event.sourceUrl)) {
      throw new Error("Calendar source URL must be a credential-free HTTPS Google URL");
    }
    if (event.automaticWorkspaceId !== undefined && !isProductWorkspaceId(event.automaticWorkspaceId)) {
      throw new Error("Calendar automatic workspace must be personal or indelitech");
    }
  }
}

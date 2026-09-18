import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAILY_INTAKE_SOURCE_KEYS,
  INTAKE_SOURCE_KEYS,
  INTAKE_STATUSES,
  INTAKE_TYPES,
  SCAN_STATUS_STATES,
  validateIntakeProposalInput,
  validateScanStatusInput,
  type IntakeProposalInput,
  type ScanStatusInput,
} from "@/lib/runtime/daily-intake";
import {
  CALENDAR_OVERRIDE_SCOPES,
  validateCalendarSyncInput,
  validateCalendarWorkspaceOverrideInput,
  type CalendarSyncInput,
  type CalendarWorkspaceOverrideInput,
} from "@/lib/runtime/calendar-projections";

const validIntake: IntakeProposalInput = {
  scanRunId: "scan-2026-09-17-morning",
  workspaceId: "personal",
  sourceKey: "personal_gmail",
  sourceType: "gmail",
  messageId: "msg-123",
  threadId: "thread-456",
  proposalOrdinal: 1,
  sourceTimestamp: "2026-09-17T11:00:00-04:00",
  sender: "Billing <billing@example.com>",
  subject: "Your renewal is due",
  sourceUrl: "https://mail.google.com/mail/u/0/#inbox/msg-123",
  intakeType: "BILL",
  title: "Review annual renewal bill",
  summary: "The message states that the annual renewal is due on September 30.",
  classificationReason: "The message contains an explicit payment obligation and due date.",
  dueDate: "2026-09-30",
  amountMinor: 14900,
  currency: "USD",
  recurrence: {
    scheduleStartDate: "2026-09-30",
    recurrenceUnit: "YEAR",
    recurrenceInterval: 1,
    recurrenceDayMode: "ANCHOR_DATE",
  },
};

const validCalendarSync: CalendarSyncInput = {
  scanRunId: "scan-2026-09-17-morning",
  sourceKey: "primary_calendar",
  windowStart: "2026-09-17T00:00:00-04:00",
  windowEnd: "2026-11-01T00:00:00-04:00",
  batchIndex: 1,
  batchCount: 1,
  events: [{
    eventId: "evt-123",
    seriesId: "series-9",
    occurrenceId: "2026-09-20T14:00:00-04:00",
    title: "Indelitech prospect call",
    start: "2026-09-20T14:00:00-04:00",
    end: "2026-09-20T14:30:00-04:00",
    allDay: false,
    location: "Google Meet",
    sourceUrl: "https://calendar.google.com/calendar/event?eid=evt-123",
    automaticWorkspaceId: "indelitech",
    cancelled: false,
  }],
};

const validScanStatus: ScanStatusInput = {
  scanRunId: "scan-2026-09-17-morning",
  sources: [
    { sourceKey: "personal_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:00:05-04:00" },
    { sourceKey: "professional_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:05-04:00", completedAt: "2026-09-17T11:00:10-04:00" },
    { sourceKey: "indelitech_gmail", state: "FAILED", attemptedAt: "2026-09-17T11:00:10-04:00", diagnostic: "Mailbox read failed." },
    { sourceKey: "primary_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:15-04:00", completedAt: "2026-09-17T11:00:20-04:00" },
    { sourceKey: "family_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:20-04:00", completedAt: "2026-09-17T11:00:25-04:00" },
  ],
};

test("1G-H domain constants expose only the approved v1 values", () => {
  assert.deepEqual(INTAKE_TYPES, ["TASK", "FOLLOW_UP", "BILL", "AWARENESS"]);
  assert.deepEqual(INTAKE_STATUSES, ["PENDING", "DEFERRED", "APPROVED", "DISMISSED", "ARCHIVED"]);
  assert.deepEqual(DAILY_INTAKE_SOURCE_KEYS, [
    "personal_gmail",
    "professional_gmail",
    "indelitech_gmail",
    "primary_calendar",
    "family_calendar",
  ]);
  assert.deepEqual(INTAKE_SOURCE_KEYS, [
    "personal_gmail",
    "professional_gmail",
    "indelitech_gmail",
    "primary_calendar",
    "family_calendar",
    "chat_history",
  ]);
  assert.deepEqual(SCAN_STATUS_STATES, ["SUCCESS", "FAILED"]);
  assert.deepEqual(CALENDAR_OVERRIDE_SCOPES, ["SERIES", "OCCURRENCE"]);
});

test("valid intake proposals preserve source-supported values without inventing optional fields", () => {
  assert.doesNotThrow(() => validateIntakeProposalInput(validIntake));
  const sparse: IntakeProposalInput = {
    scanRunId: "scan-2",
    workspaceId: "personal",
    sourceKey: "professional_gmail",
    sourceType: "gmail",
    messageId: "msg-sparse",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-17T15:00:00Z",
    intakeType: "TASK",
    title: "Reply to recruiter",
    summary: "The recruiter asked for a response.",
    classificationReason: "A direct response was requested.",
  };
  assert.doesNotThrow(() => validateIntakeProposalInput(sparse));
  assert.equal("dueDate" in sparse, false);
  assert.equal("priority" in sparse, false);
  assert.equal("amountMinor" in sparse, false);
});

test("intake validation fails closed on bad source identity, workspace, ordinal, dates, URLs, and money", () => {
  const invalid = (patch: Record<string, unknown>) => ({ ...validIntake, ...patch }) as IntakeProposalInput;

  assert.throws(() => validateIntakeProposalInput(invalid({ workspaceId: "personal:marc" })), /workspace/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ sourceKey: "harvest_fire_gmail" })), /source/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ sourceType: "calendar" })), /source/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ proposalOrdinal: 0 })), /ordinal/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ sourceTimestamp: "2026-09-17" })), /timestamp/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ dueDate: "09/30/2026" })), /date/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ sourceUrl: "http://mail.google.com/mail/u/0/#inbox/msg-123" })), /URL/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ sourceUrl: "https://evil.example/mail/msg-123" })), /URL/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ amountMinor: -1 })), /amount/i);
  assert.throws(() => validateIntakeProposalInput(invalid({ currency: "usd" })), /currency/i);
});

test("intake validation keeps Gmail/Calendar source types aligned and accepts strong-evidence workspace rerouting", () => {
  assert.doesNotThrow(() => validateIntakeProposalInput({
    ...validIntake,
    workspaceId: "indelitech",
    sourceKey: "personal_gmail",
  }));

  assert.doesNotThrow(() => validateIntakeProposalInput({
    scanRunId: "scan-calendar-proposal",
    workspaceId: "indelitech",
    sourceKey: "primary_calendar",
    sourceType: "calendar",
    eventId: "evt-123",
    seriesId: "series-9",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-20T14:00:00-04:00",
    sourceUrl: "https://calendar.google.com/calendar/event?eid=evt-123",
    intakeType: "TASK",
    title: "Prepare for prospect call",
    summary: "Prospect call is on the calendar.",
    classificationReason: "Preparation is required before the scheduled prospect call.",
  }));
});

test("calendar sync validation accepts bounded batches and rejects malformed windows or physical workspace IDs", () => {
  assert.doesNotThrow(() => validateCalendarSyncInput(validCalendarSync));

  const invalid = (patch: Record<string, unknown>) => ({ ...validCalendarSync, ...patch }) as CalendarSyncInput;
  assert.throws(() => validateCalendarSyncInput(invalid({ sourceKey: "praise_team_calendar" })), /source/i);
  assert.throws(() => validateCalendarSyncInput(invalid({ batchIndex: 0 })), /batch/i);
  assert.throws(() => validateCalendarSyncInput(invalid({ batchIndex: 2, batchCount: 1 })), /batch/i);
  assert.throws(() => validateCalendarSyncInput(invalid({ windowStart: "2026-09-17" })), /window/i);
  assert.throws(() => validateCalendarSyncInput(invalid({ windowEnd: "2026-09-16T00:00:00-04:00" })), /window/i);

  const badWorkspace: CalendarSyncInput = {
    ...validCalendarSync,
    events: [{ ...validCalendarSync.events[0], automaticWorkspaceId: "personal:marc" as "personal" }],
  };
  assert.throws(() => validateCalendarSyncInput(badWorkspace), /workspace/i);
});

test("calendar event time validation distinguishes all-day dates from timed instants", () => {
  assert.doesNotThrow(() => validateCalendarSyncInput({
    ...validCalendarSync,
    events: [{
      eventId: "all-day-1",
      title: "Family day",
      start: "2026-09-27",
      end: "2026-09-28",
      allDay: true,
      cancelled: false,
    }],
  }));

  assert.throws(() => validateCalendarSyncInput({
    ...validCalendarSync,
    events: [{
      eventId: "bad-all-day",
      title: "Family day",
      start: "2026-09-27T09:00:00-04:00",
      end: "2026-09-27T10:00:00-04:00",
      allDay: true,
      cancelled: false,
    }],
  }), /all-day|date/i);

  assert.throws(() => validateCalendarSyncInput({
    ...validCalendarSync,
    events: [{
      eventId: "bad-timed",
      title: "Meeting",
      start: "2026-09-27",
      end: "2026-09-27",
      allDay: false,
      cancelled: false,
    }],
  }), /timed|timestamp/i);
});

test("scan status requires one result for every approved source and exact success/failure timing", () => {
  assert.doesNotThrow(() => validateScanStatusInput(validScanStatus));

  assert.throws(() => validateScanStatusInput({
    ...validScanStatus,
    sources: validScanStatus.sources.slice(0, 4),
  }), /every approved source|five|5/i);

  assert.throws(() => validateScanStatusInput({
    ...validScanStatus,
    sources: [...validScanStatus.sources.slice(0, 4), validScanStatus.sources[0]],
  }), /duplicate|source/i);

  assert.throws(() => validateScanStatusInput({
    ...validScanStatus,
    sources: validScanStatus.sources.map((source) => source.sourceKey === "personal_gmail"
      ? { ...source, completedAt: undefined }
      : source),
  } as ScanStatusInput), /completed/i);

  assert.throws(() => validateScanStatusInput({
    ...validScanStatus,
    sources: validScanStatus.sources.map((source) => source.sourceKey === "indelitech_gmail"
      ? { ...source, diagnostic: undefined }
      : source),
  } as ScanStatusInput), /diagnostic/i);

  assert.throws(() => validateScanStatusInput({
    ...validScanStatus,
    sources: validScanStatus.sources.map((source) => source.sourceKey === "primary_calendar"
      ? { ...source, attemptedAt: "2026-09-17" }
      : source),
  } as ScanStatusInput), /timestamp/i);
});

test("calendar workspace override contract permits only logical workspaces and series/occurrence identity", () => {
  const valid: CalendarWorkspaceOverrideInput = {
    sourceKey: "primary_calendar",
    scope: "SERIES",
    identityKey: "series-9",
    workspaceId: "indelitech",
  };
  assert.doesNotThrow(() => validateCalendarWorkspaceOverrideInput(valid));
  assert.doesNotThrow(() => validateCalendarWorkspaceOverrideInput({ ...valid, scope: "OCCURRENCE", identityKey: "evt-123@2026-09-20" }));
  assert.throws(() => validateCalendarWorkspaceOverrideInput({ ...valid, scope: "EVENT" as "SERIES" }), /scope/i);
  assert.throws(() => validateCalendarWorkspaceOverrideInput({ ...valid, workspaceId: "personal:marc" as "personal" }), /workspace/i);
  assert.throws(() => validateCalendarWorkspaceOverrideInput({ ...valid, identityKey: "   " }), /identity/i);
});


test("one-time ChatGPT history proposals use honest chat provenance without joining daily freshness", () => {
  const chatProposal: IntakeProposalInput = {
    scanRunId: "chat-history-2026-09-18",
    workspaceId: "personal",
    sourceKey: "chat_history",
    sourceType: "chat",
    chatItemId: "career-auraone-submit",
    chatThreadId: "job-search-side-gigs",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-07T15:57:58Z",
    subject: "AuraOne application",
    intakeType: "TASK",
    title: "Finish and submit AuraOne application",
    summary: "Prior chat context shows the application reached the final review/submission step.",
    classificationReason: "The application was still open and requires a concrete submission action.",
    priority: "HIGH",
  };

  assert.doesNotThrow(() => validateIntakeProposalInput(chatProposal));
  assert.equal(DAILY_INTAKE_SOURCE_KEYS.includes("chat_history" as never), false);

  assert.throws(() => validateIntakeProposalInput({
    ...chatProposal,
    chatItemId: undefined,
  }), /chat|identity/i);
  assert.throws(() => validateIntakeProposalInput({
    ...chatProposal,
    messageId: "fake-gmail-id",
  }), /chat|gmail|identity/i);
  assert.throws(() => validateIntakeProposalInput({
    ...chatProposal,
    sourceUrl: "https://chatgpt.com/c/example",
  }), /source url|chat/i);
});


test("Gmail Intake rejects contradictory chat identity fields", () => {
  assert.throws(() => validateIntakeProposalInput({
    ...validIntake,
    chatItemId: "should-not-be-here",
  }), /gmail|chat|identity/i);
  assert.throws(() => validateIntakeProposalInput({
    ...validIntake,
    chatThreadId: "should-not-be-here",
  }), /gmail|chat|identity/i);
});

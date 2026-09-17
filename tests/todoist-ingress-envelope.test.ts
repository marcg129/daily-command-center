import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isVersionedDccEnvelope,
  parseTodoistIngressEnvelope,
  TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES,
} from "@/lib/runtime/todoist-ingress-envelope";
import { TodoistTaskIngressValidationError } from "@/lib/runtime/todoist-task-ingress";

function task(kind: string, payload: unknown, version = "1") {
  return {
    id: "relay-task-123",
    content: "DCC relay envelope",
    description: [
      `dccEnvelopeVersion: ${version}`,
      `kind: ${kind}`,
      `payload: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    ].join("\n"),
  };
}

const intakePayload = {
  scanRunId: "scan-1",
  workspaceId: "personal",
  sourceKey: "personal_gmail",
  sourceType: "gmail",
  messageId: "msg-1",
  threadId: "thread-1",
  proposalOrdinal: 1,
  sourceTimestamp: "2026-09-17T11:00:00-04:00",
  sender: "sender@example.com",
  subject: "Please reply",
  sourceUrl: "https://mail.google.com/mail/u/0/#inbox/msg-1",
  intakeType: "TASK",
  title: "Reply to sender",
  summary: "The sender requested a response.",
  classificationReason: "An explicit response was requested.",
};

const calendarPayload = {
  scanRunId: "scan-1",
  sourceKey: "primary_calendar",
  windowStart: "2026-09-17T00:00:00-04:00",
  windowEnd: "2026-11-01T00:00:00-04:00",
  batchIndex: 1,
  batchCount: 1,
  events: [{
    eventId: "event-1",
    title: "Client call",
    start: "2026-09-20T14:00:00-04:00",
    end: "2026-09-20T14:30:00-04:00",
    allDay: false,
    automaticWorkspaceId: "indelitech",
    cancelled: false,
  }],
};

const scanStatusPayload = {
  scanRunId: "scan-1",
  sources: [
    { sourceKey: "personal_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
    { sourceKey: "professional_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
    { sourceKey: "indelitech_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
    { sourceKey: "primary_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
    { sourceKey: "family_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
  ],
};

test("versioned envelope detection leaves legacy Todoist capture as the fallback", () => {
  assert.equal(isVersionedDccEnvelope(task("intake_proposal", intakePayload)), true);
  assert.equal(isVersionedDccEnvelope({
    id: "legacy-1",
    content: "Call vendor",
    description: "workspace: indelitech\npriority: HIGH",
  }), false);
});

test("v1 parses the three supported envelope kinds through their canonical validators", () => {
  assert.deepEqual(parseTodoistIngressEnvelope(task("intake_proposal", intakePayload)), {
    kind: "intake_proposal",
    payload: intakePayload,
  });
  assert.deepEqual(parseTodoistIngressEnvelope(task("calendar_sync", calendarPayload)), {
    kind: "calendar_sync",
    payload: calendarPayload,
  });
  assert.deepEqual(parseTodoistIngressEnvelope(task("scan_status", scanStatusPayload)), {
    kind: "scan_status",
    payload: scanStatusPayload,
  });
});

test("versioned envelopes enforce the same safe Todoist task identity boundary as legacy capture", () => {
  assert.throws(() => parseTodoistIngressEnvelope({
    ...task("intake_proposal", intakePayload),
    id: "unsafe/task/id",
  }), /task id|Todoist/i);
});

test("envelopes require exactly three metadata lines, version 1, supported kind, and single-line JSON", () => {
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", intakePayload, "2")), /version/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("unknown_kind", intakePayload)), /kind/i);
  assert.throws(() => parseTodoistIngressEnvelope({
    ...task("intake_proposal", intakePayload),
    description: `dccEnvelopeVersion: 1\nkind: intake_proposal\npayload: ${JSON.stringify(intakePayload)}\nextra: nope`,
  }), /three|line|metadata/i);
  assert.throws(() => parseTodoistIngressEnvelope({
    ...task("intake_proposal", intakePayload),
    description: "dccEnvelopeVersion: 1\nkind: intake_proposal\npayload: {\n\"scanRunId\":\"scan-1\"}",
  }), /three|single-line|payload/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", "{not-json")), /JSON|payload/i);
});

test("envelope payloads fail closed on missing scanRunId, unknown fields, and physical workspace selectors", () => {
  const withoutScan = { ...intakePayload } as Partial<typeof intakePayload>;
  delete withoutScan.scanRunId;
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", withoutScan)), /scan run|scanRunId/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", {
    ...intakePayload,
    unexpected: true,
  })), /unknown|unsupported|field/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", {
    ...intakePayload,
    physicalWorkspaceId: "personal:marc",
  })), /unknown|unsupported|physical|field/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", {
    ...intakePayload,
    workspaceId: "personal:marc",
  })), /workspace/i);
  assert.throws(() => parseTodoistIngressEnvelope(task("calendar_sync", {
    ...calendarPayload,
    events: [{ ...calendarPayload.events[0], secretProviderField: "nope" }],
  })), /unknown|unsupported|field/i);
});

test("serialized payloads are capped at the explicit v1 byte ceiling", () => {
  assert.equal(TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES, 8192);
  const oversized = {
    ...intakePayload,
    summary: "x".repeat(TODOIST_DCC_ENVELOPE_MAX_PAYLOAD_BYTES),
  };
  assert.throws(() => parseTodoistIngressEnvelope(task("intake_proposal", oversized)), /size|large|8192/i);
});

test("validation failures use the existing permanent Todoist ingress error type", () => {
  assert.throws(
    () => parseTodoistIngressEnvelope(task("intake_proposal", { ...intakePayload, workspaceId: "household" })),
    (error) => error instanceof TodoistTaskIngressValidationError,
  );
});

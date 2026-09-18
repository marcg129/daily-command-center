import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTodoistRelayTask,
  TodoistTaskIngressValidationError,
} from "@/lib/runtime/todoist-task-ingress";

test("Todoist relay maps explicit metadata into canonical structured capture", () => {
  const parsed = parseTodoistRelayTask({
    id: "6hWfF8h2gHrG9GH5",
    content: "Follow up with D&H",
    description: [
      "source: chatgpt",
      "requestId: supplied-but-not-authoritative",
      "workspace: indelitech",
      "priority: HIGH",
      "due: 2026-09-18",
      "recurrence: One-time",
      "estimatedDuration: 30m",
      "category: Vendor",
      "project: Hardware",
      "person: Pat",
      "dependency: Replacement shipment",
      "context: Ask about RMA: replacement tracking and ETA",
      "sourceContext: Conversation about the replacement shipment",
    ].join("\n"),
  });

  assert.deepEqual(parsed, {
    requestId: "todoist:6hWfF8h2gHrG9GH5",
    workspaceId: "indelitech",
    title: "Follow up with D&H",
    context: "Ask about RMA: replacement tracking and ETA",
    category: "Vendor",
    project: "Hardware",
    person: "Pat",
    priority: "HIGH",
    due: "2026-09-18",
    estimatedDuration: "30m",
    recurrence: "One-time",
    dependency: "Replacement shipment",
    sourceContext: "Conversation about the replacement shipment",
    remindAt: null,
    followUpAt: null,
  });
});

test("Todoist task id is the authoritative idempotency key", () => {
  const parsed = parseTodoistRelayTask({
    id: "6hWfF8h2gHrG9GH5",
    content: "Relay test",
    description: "requestId: malicious-or-stale\nworkspace: personal",
  });
  assert.equal(parsed.requestId, "todoist:6hWfF8h2gHrG9GH5");
});

test("unknown optional fields are omitted instead of invented", () => {
  const parsed = parseTodoistRelayTask({
    id: "abc123",
    content: "Simple task",
    description: "workspace: personal",
  });
  assert.equal(parsed.workspaceId, "personal");
  assert.equal(parsed.priority, undefined);
  assert.equal(parsed.estimatedDuration, undefined);
  assert.equal(parsed.context, undefined);
  assert.equal(parsed.recurrence, undefined);
});

test("unknown metadata keys fail closed", () => {
  assert.throws(
    () => parseTodoistRelayTask({
      id: "abc123",
      content: "Simple task",
      description: "workspace: personal\nphysicalWorkspaceId: secret-row-id",
    }),
    (error) => error instanceof TodoistTaskIngressValidationError && /unsupported metadata field/i.test(error.message),
  );
});

test("duplicate metadata keys fail closed", () => {
  assert.throws(
    () => parseTodoistRelayTask({
      id: "abc123",
      content: "Simple task",
      description: "workspace: personal\nworkspace: indelitech",
    }),
    (error) => error instanceof TodoistTaskIngressValidationError && /duplicate metadata field/i.test(error.message),
  );
});

test("invalid workspace is rejected by canonical capture validation", () => {
  assert.throws(
    () => parseTodoistRelayTask({
      id: "abc123",
      content: "Simple task",
      description: "workspace: household",
    }),
    /workspaceId must be personal or indelitech/i,
  );
});

test("invalid or unsafe external task ids fail closed", () => {
  for (const id of ["", "contains:colon", "contains space", "../escape", "x".repeat(120)]) {
    assert.throws(
      () => parseTodoistRelayTask({ id, content: "Simple task", description: "workspace: personal" }),
      (error) => error instanceof TodoistTaskIngressValidationError && /task id/i.test(error.message),
    );
  }
});

test("blank title and malformed metadata lines fail closed", () => {
  assert.throws(
    () => parseTodoistRelayTask({ id: "abc123", content: "   ", description: "workspace: personal" }),
    /title is required/i,
  );
  assert.throws(
    () => parseTodoistRelayTask({ id: "abc123", content: "Task", description: "workspace personal" }),
    (error) => error instanceof TodoistTaskIngressValidationError && /key: value/i.test(error.message),
  );
});


test("plain Todoist tasks default to Personal and preserve native description, priority, and timed due data", () => {
  const description = "Check updated injury news. Current plan: keep the insurance option until status is clear.";
  const parsed = parseTodoistRelayTask({
    id: "normal-task-1",
    content: "Monitor TE decision",
    description,
    priority: 4,
    due: {
      date: "2026-09-20T11:00:00",
      timezone: "America/New_York",
      isRecurring: false,
    },
  });

  assert.equal(parsed.workspaceId, "personal");
  assert.equal(parsed.context, description);
  assert.equal(parsed.priority, "HIGH");
  assert.equal(parsed.due, "2026-09-20");
  assert.equal(parsed.remindAt, "2026-09-20T15:00:00.000Z");
});

test("plain descriptions containing ordinary colons remain context instead of metadata", () => {
  const description = "Review the matchup. Current plan: hold until the late injury report.";
  const parsed = parseTodoistRelayTask({
    id: "normal-task-2",
    content: "Review matchup",
    description,
  });

  assert.equal(parsed.workspaceId, "personal");
  assert.equal(parsed.context, description);
});

test("explicit structured metadata overrides Personal/native defaults and still fails closed when malformed", () => {
  const parsed = parseTodoistRelayTask({
    id: "structured-task-1",
    content: "Call vendor",
    description: "workspace: indelitech\npriority: LOW\ndue: 2026-09-21",
    priority: 4,
    due: {
      date: "2026-09-20T11:00:00",
      timezone: "America/New_York",
      isRecurring: false,
    },
  });

  assert.equal(parsed.workspaceId, "indelitech");
  assert.equal(parsed.priority, "LOW");
  assert.equal(parsed.due, "2026-09-21");
  assert.equal(parsed.remindAt, null);

  assert.throws(
    () => parseTodoistRelayTask({
      id: "structured-task-2",
      content: "Malformed relay",
      description: "workspace personal",
    }),
    (error) => error instanceof TodoistTaskIngressValidationError && /key: value/i.test(error.message),
  );
});

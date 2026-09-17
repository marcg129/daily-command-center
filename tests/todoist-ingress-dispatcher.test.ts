import assert from "node:assert/strict";
import test from "node:test";
import { createTodoistIngressDispatcher } from "@/lib/runtime/todoist-ingress-dispatcher";
import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import type { TodoistTaskIngressOutcome, TodoistRelayActions } from "@/lib/runtime/todoist-task-ingress-service";
import type { ParsedDccEnvelope } from "@/lib/runtime/todoist-ingress-envelope";

const legacyTask: TodoistRelayTask = {
  id: "legacy-1",
  content: "Call vendor",
  description: "workspace: personal",
  addedAt: "2026-09-17T16:00:00Z",
};

const versionedTask: TodoistRelayTask = {
  id: "intake-1",
  content: "Daily Intake transport",
  description: `dccEnvelopeVersion: 1\nkind: intake_proposal\npayload: {"scanRunId":"scan-1","workspaceId":"personal","sourceKey":"personal_gmail","sourceType":"gmail","messageId":"msg-1","proposalOrdinal":1,"sourceTimestamp":"2026-09-17T16:00:00Z","intakeType":"TASK","title":"Reply to sender","summary":"A reply was requested.","classificationReason":"The sender explicitly requested a response."}`,
  addedAt: "2026-09-17T16:01:00Z",
};

function outcome(taskId: string): TodoistTaskIngressOutcome {
  return { status: "imported", todoistTaskId: taskId };
}

test("dispatcher preserves legacy capture and routes versioned envelopes to Daily Intake", async () => {
  const legacySeen: string[] = [];
  const intakeSeen: Array<{ taskId: string; envelope: ParsedDccEnvelope }> = [];
  const relay: TodoistRelayActions = {
    async closeTask() {},
    async markFailure() {},
  };
  const dispatch = createTodoistIngressDispatcher({
    legacyImportTask: async (task) => {
      legacySeen.push(task.id);
      return outcome(task.id);
    },
    dailyIntakeImport: async (taskId, envelope) => {
      intakeSeen.push({ taskId, envelope });
      return outcome(taskId);
    },
    relay,
  });

  assert.equal((await dispatch(legacyTask)).status, "imported");
  assert.equal((await dispatch(versionedTask)).status, "imported");
  assert.deepEqual(legacySeen, ["legacy-1"]);
  assert.equal(intakeSeen.length, 1);
  assert.equal(intakeSeen[0].taskId, "intake-1");
  assert.equal(intakeSeen[0].envelope.kind, "intake_proposal");
});

test("malformed versioned envelopes become visible permanent failures instead of transient retries", async () => {
  const failures: Array<{ taskId: string; diagnostic: string }> = [];
  let legacyCalls = 0;
  let intakeCalls = 0;
  const relay: TodoistRelayActions = {
    async closeTask() {},
    async markFailure(taskId, diagnostic) { failures.push({ taskId, diagnostic }); },
  };
  const dispatch = createTodoistIngressDispatcher({
    legacyImportTask: async (task) => {
      legacyCalls += 1;
      return outcome(task.id);
    },
    dailyIntakeImport: async (taskId) => {
      intakeCalls += 1;
      return outcome(taskId);
    },
    relay,
  });

  const malformed: TodoistRelayTask = {
    ...versionedTask,
    id: "bad-envelope",
    description: "dccEnvelopeVersion: 1\nkind: intake_proposal\npayload: {not-json}",
  };
  const result = await dispatch(malformed);

  assert.equal(result.status, "permanent-failure");
  assert.equal(legacyCalls, 0);
  assert.equal(intakeCalls, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].taskId, "bad-envelope");
  assert.match(failures[0].diagnostic, /^DCC import failed:/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext } from "@/lib/runtime/context";
import type { IntakeRepository } from "@/lib/runtime/intake-repository";
import type { CalendarProjectionRepository } from "@/lib/runtime/calendar-projection-repository";
import type { SourceFreshnessRepository } from "@/lib/runtime/source-freshness-repository";
import type { ParsedDccEnvelope } from "@/lib/runtime/todoist-ingress-envelope";
import {
  createDailyIntakeIngressService,
  type DailyIntakeUserWorkspaceResolver,
} from "@/lib/runtime/daily-intake-ingress-service";
import {
  TodoistRelayTransportError,
  TodoistWorkspaceAuthorizationError,
  type TodoistRelayActions,
} from "@/lib/runtime/todoist-task-ingress-service";

const personalContext: RequestContext = {
  userId: "user:marc",
  workspaceId: "personal:marc",
  workspaceKey: "personal",
};
const indelitechContext: RequestContext = {
  userId: "user:marc",
  workspaceId: "indelitech:marc",
  workspaceKey: "indelitech",
};

const intakeEnvelope: ParsedDccEnvelope = {
  kind: "intake_proposal",
  payload: {
    scanRunId: "scan-1",
    workspaceId: "personal",
    sourceKey: "personal_gmail",
    sourceType: "gmail",
    messageId: "msg-1",
    proposalOrdinal: 1,
    sourceTimestamp: "2026-09-17T11:00:00-04:00",
    intakeType: "TASK",
    title: "Reply to sender",
    summary: "A reply was requested.",
    classificationReason: "The source explicitly requests a response.",
  },
};

const calendarEnvelope: ParsedDccEnvelope = {
  kind: "calendar_sync",
  payload: {
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
  },
};

const scanEnvelope: ParsedDccEnvelope = {
  kind: "scan_status",
  payload: {
    scanRunId: "scan-1",
    sources: [
      { sourceKey: "personal_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
      { sourceKey: "professional_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
      { sourceKey: "indelitech_gmail", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
      { sourceKey: "primary_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
      { sourceKey: "family_calendar", state: "SUCCESS", attemptedAt: "2026-09-17T11:00:00-04:00", completedAt: "2026-09-17T11:01:00-04:00" },
    ],
  },
};

function fakeDependencies(options: {
  intakeStatus?: "created" | "reused" | "terminal";
  resolveError?: Error;
  resolveIndelitechError?: Error;
  persistError?: Error;
  closeError?: Error;
} = {}) {
  const events: string[] = [];
  const resolver: DailyIntakeUserWorkspaceResolver = {
    async resolveUser() {
      events.push("resolve-user");
      if (options.resolveError) throw options.resolveError;
      return { userId: "user:marc" };
    },
    async resolve(workspaceId: string) {
      events.push(`resolve:${workspaceId}`);
      if (workspaceId === "indelitech" && options.resolveIndelitechError) throw options.resolveIndelitechError;
      if (options.resolveError) throw options.resolveError;
      return workspaceId === "indelitech" ? indelitechContext : personalContext;
    },
  };

  const intake = {
    async ingest(context: RequestContext) {
      events.push(`intake:${context.workspaceKey}`);
      if (options.persistError) throw options.persistError;
      return { status: options.intakeStatus ?? "created", item: { intakeId: "intake-1" } };
    },
  } as unknown as IntakeRepository;
  const calendar = {
    async ingestBatch(userId: string) {
      events.push(`calendar:${userId}`);
      if (options.persistError) throw options.persistError;
      return { complete: true, receivedBatchCount: 1 };
    },
  } as unknown as CalendarProjectionRepository;
  const freshness = {
    async record(userId: string) {
      events.push(`status:${userId}`);
      if (options.persistError) throw options.persistError;
    },
  } as unknown as SourceFreshnessRepository;
  const relay: TodoistRelayActions = {
    async closeTask(taskId: string) {
      events.push(`close:${taskId}`);
      if (options.closeError) throw options.closeError;
    },
    async markFailure(taskId: string, diagnostic: string) {
      events.push(`fail:${taskId}:${diagnostic}`);
    },
  };

  return { events, resolver, intake, calendar, freshness, relay };
}

function service(deps: ReturnType<typeof fakeDependencies>) {
  return createDailyIntakeIngressService({
    intakeRepository: deps.intake,
    calendarRepository: deps.calendar,
    sourceFreshnessRepository: deps.freshness,
    workspaceResolver: deps.resolver,
    relay: deps.relay,
  });
}

test("intake proposal persists in its exact resolved workspace before relay close", async () => {
  const deps = fakeDependencies();
  const result = await service(deps).import("relay-1", intakeEnvelope);
  assert.equal(result.status, "imported");
  assert.deepEqual(deps.events, ["resolve:personal", "intake:personal", "close:relay-1"]);
});

test("semantic Intake replay closes safely and reports already-imported", async () => {
  const deps = fakeDependencies({ intakeStatus: "reused" });
  const result = await service(deps).import("relay-2", intakeEnvelope);
  assert.equal(result.status, "already-imported");
  assert.equal(deps.events.at(-1), "close:relay-2");
});

test("calendar sync requires active user and pre-authorizes Indelitech classification before persistence", async () => {
  const deps = fakeDependencies();
  const result = await service(deps).import("relay-3", calendarEnvelope);
  assert.equal(result.status, "imported");
  assert.deepEqual(deps.events, ["resolve-user", "resolve:indelitech", "calendar:user:marc", "close:relay-3"]);
});

test("calendar sync without Indelitech events does not require that workspace grant", async () => {
  const deps = fakeDependencies({ resolveIndelitechError: new TodoistWorkspaceAuthorizationError() });
  const personalOnly: ParsedDccEnvelope = {
    kind: "calendar_sync",
    payload: {
      ...calendarEnvelope.payload,
      events: [{ ...calendarEnvelope.payload.events[0], automaticWorkspaceId: "personal" }],
    },
  };
  const result = await service(deps).import("relay-4", personalOnly);
  assert.equal(result.status, "imported");
  assert.deepEqual(deps.events, ["resolve-user", "calendar:user:marc", "close:relay-4"]);
});

test("scan status requires only the active configured user and closes after persistence", async () => {
  const deps = fakeDependencies();
  const result = await service(deps).import("relay-5", scanEnvelope);
  assert.equal(result.status, "imported");
  assert.deepEqual(deps.events, ["resolve-user", "status:user:marc", "close:relay-5"]);
});

test("authorization denials are permanent and visible while persistence is never attempted", async () => {
  const deps = fakeDependencies({ resolveIndelitechError: new TodoistWorkspaceAuthorizationError() });
  const result = await service(deps).import("relay-6", calendarEnvelope);
  assert.equal(result.status, "permanent-failure");
  assert.match(result.diagnostic ?? "", /authorized|workspace/i);
  assert.equal(deps.events.some((entry) => entry.startsWith("calendar:")), false);
  assert.equal(deps.events.some((entry) => entry.startsWith("fail:relay-6:")), true);
});

test("D1 persistence failure remains transient and never closes or permanently marks the relay", async () => {
  const deps = fakeDependencies({ persistError: new Error("D1 unavailable") });
  const result = await service(deps).import("relay-7", intakeEnvelope);
  assert.equal(result.status, "transient-failure");
  assert.equal(deps.events.some((entry) => entry === "close:relay-7"), false);
  assert.equal(deps.events.some((entry) => entry.startsWith("fail:relay-7:")), false);
});

test("relay close failure after successful persistence is transient and replay-safe", async () => {
  const deps = fakeDependencies({
    intakeStatus: "reused",
    closeError: new TodoistRelayTransportError("temporary Todoist failure", { transient: true, retryAfterSeconds: 30 }),
  });
  const result = await service(deps).import("relay-8", intakeEnvelope);
  assert.equal(result.status, "transient-failure");
  assert.equal(result.retryAfterSeconds, 30);
  assert.deepEqual(deps.events, ["resolve:personal", "intake:personal", "close:relay-8"]);
});

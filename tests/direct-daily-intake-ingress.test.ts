import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext } from "@/lib/runtime/context";
import {
  createDirectDailyIntakeIngressService,
  DirectDailyIntakeValidationError,
} from "@/lib/runtime/direct-daily-intake-ingress";
import type { IntakeRepository } from "@/lib/runtime/intake-repository";
import type { CalendarProjectionRepository } from "@/lib/runtime/calendar-projection-repository";
import type { SourceFreshnessRepository } from "@/lib/runtime/source-freshness-repository";
import { principalId } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

const principal = { principalId: principalId("cf-user:marc") };
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

const intakeProposal = {
  scanRunId: "scan-direct-1",
  workspaceId: "personal",
  sourceKey: "personal_gmail",
  sourceType: "gmail",
  messageId: "message-1",
  proposalOrdinal: 1,
  sourceTimestamp: "2026-10-01T12:00:00-04:00",
  intakeType: "TASK",
  title: "Reply to sender",
  summary: "The sender requested a reply.",
  classificationReason: "The source explicitly requests action.",
  priority: "MEDIUM",
} as const;

const calendarBatch = {
  scanRunId: "scan-direct-1",
  sourceKey: "primary_calendar",
  windowStart: "2026-10-01T07:30:00-04:00",
  windowEnd: "2026-11-15T07:30:00-05:00",
  batchIndex: 1,
  batchCount: 1,
  events: [{
    eventId: "event-1",
    title: "Client call",
    start: "2026-10-05T14:00:00-04:00",
    end: "2026-10-05T14:30:00-04:00",
    allDay: false,
    automaticWorkspaceId: "indelitech",
    cancelled: false,
  }],
} as const;

const scanStatus = {
  scanRunId: "scan-direct-1",
  sources: [
    { sourceKey: "personal_gmail", state: "SUCCESS", attemptedAt: "2026-10-01T11:00:00-04:00", completedAt: "2026-10-01T11:01:00-04:00" },
    { sourceKey: "professional_gmail", state: "SUCCESS", attemptedAt: "2026-10-01T11:01:00-04:00", completedAt: "2026-10-01T11:02:00-04:00" },
    { sourceKey: "indelitech_gmail", state: "SUCCESS", attemptedAt: "2026-10-01T11:02:00-04:00", completedAt: "2026-10-01T11:03:00-04:00" },
    { sourceKey: "primary_calendar", state: "SUCCESS", attemptedAt: "2026-10-01T11:03:00-04:00", completedAt: "2026-10-01T11:04:00-04:00" },
    { sourceKey: "family_calendar", state: "SUCCESS", attemptedAt: "2026-10-01T11:04:00-04:00", completedAt: "2026-10-01T11:05:00-04:00" },
  ],
} as const;

function dependencies(options: { denyIndelitech?: boolean } = {}) {
  const events: string[] = [];
  const resolver: WorkspaceResolver = {
    async resolve(receivedPrincipal, workspaceId) {
      assert.equal(receivedPrincipal?.principalId, principal.principalId);
      events.push(`resolve:${workspaceId}`);
      if (workspaceId === "indelitech" && options.denyIndelitech) {
        throw new Error("Workspace access denied.");
      }
      return workspaceId === "indelitech" ? indelitechContext : personalContext;
    },
  };

  const intakeRepository = {
    async ingest(context: RequestContext) {
      events.push(`intake:${context.workspaceKey}`);
      return { status: "created", item: { intakeId: "intake-1" } };
    },
  } as unknown as IntakeRepository;

  const calendarRepository = {
    async ingestBatch(userId: string) {
      events.push(`calendar:${userId}`);
      return { complete: true, receivedBatchCount: 1 };
    },
  } as unknown as CalendarProjectionRepository;

  const sourceFreshnessRepository = {
    async record(userId: string) {
      events.push(`status:${userId}`);
    },
  } as unknown as SourceFreshnessRepository;

  return { events, resolver, intakeRepository, calendarRepository, sourceFreshnessRepository };
}

function service(deps: ReturnType<typeof dependencies>) {
  return createDirectDailyIntakeIngressService({
    principal,
    workspaceResolver: deps.resolver,
    intakeRepository: deps.intakeRepository,
    calendarRepository: deps.calendarRepository,
    sourceFreshnessRepository: deps.sourceFreshnessRepository,
  });
}

test("direct Intake proposal writes to the exact authenticated workspace with no relay hop", async () => {
  const deps = dependencies();
  const result = await service(deps).submitIntakeProposal(intakeProposal);

  assert.deepEqual(result, { status: "created", intakeId: "intake-1" });
  assert.deepEqual(deps.events, ["resolve:personal", "intake:personal"]);
});

test("direct Calendar sync authorizes Indelitech classification before persisting for the authenticated user", async () => {
  const deps = dependencies();
  const result = await service(deps).syncCalendarBatch(calendarBatch);

  assert.equal(result.complete, true);
  assert.equal(result.receivedBatchCount, 1);
  assert.deepEqual(deps.events, [
    "resolve:personal",
    "resolve:indelitech",
    "calendar:user:marc",
  ]);
});

test("direct scan status records freshness only after resolving both logical workspaces to the same user", async () => {
  const deps = dependencies();
  const result = await service(deps).recordScanStatus(scanStatus);

  assert.deepEqual(result, { scanRunId: "scan-direct-1", recorded: true });
  assert.deepEqual(deps.events, [
    "resolve:personal",
    "resolve:indelitech",
    "status:user:marc",
  ]);
});

test("direct Calendar sync fails closed when the principal lacks the requested Indelitech grant", async () => {
  const deps = dependencies({ denyIndelitech: true });

  await assert.rejects(
    service(deps).syncCalendarBatch(calendarBatch),
    /Workspace access denied/,
  );
  assert.equal(deps.events.some((event) => event.startsWith("calendar:")), false);
});

test("direct transport validates scan payloads before persistence", async () => {
  const deps = dependencies();
  const malformed = {
    ...scanStatus,
    sources: scanStatus.sources.slice(0, 4),
  };

  await assert.rejects(
    service(deps).recordScanStatus(malformed as never),
    DirectDailyIntakeValidationError,
  );
  assert.deepEqual(deps.events, []);
});

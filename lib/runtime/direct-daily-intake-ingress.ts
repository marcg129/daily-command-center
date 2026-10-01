import { requireHostedWorkspaceInstance, type ProductWorkspaceId } from "./context";
import {
  validateIntakeProposalInput,
  validateScanStatusInput,
  type IntakeProposalInput,
  type ScanStatusInput,
} from "./daily-intake";
import {
  validateCalendarSyncInput,
  type CalendarSyncInput,
} from "./calendar-projections";
import type { IntakeRepository } from "./intake-repository";
import type { CalendarProjectionRepository } from "./calendar-projection-repository";
import type { SourceFreshnessRepository } from "./source-freshness-repository";
import type { AuthenticatedPrincipal } from "./session";
import type { WorkspaceResolver } from "./workspace-resolver";

export class DirectDailyIntakeValidationError extends Error {}

type Dependencies = Readonly<{
  principal: AuthenticatedPrincipal;
  workspaceResolver: WorkspaceResolver;
  intakeRepository: IntakeRepository;
  calendarRepository: CalendarProjectionRepository;
  sourceFreshnessRepository: SourceFreshnessRepository;
}>;

function validate(label: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    throw new DirectDailyIntakeValidationError(
      error instanceof Error ? error.message : `${label} is invalid.`,
    );
  }
}

/**
 * Direct authenticated Daily Intake transport for MCP callers.
 *
 * This path deliberately bypasses Todoist and persists through the same
 * canonical Intake, Calendar projection, and source-freshness repositories.
 * It never approves Intake items or creates canonical Tasks/Bills.
 */
export function createDirectDailyIntakeIngressService({
  principal,
  workspaceResolver,
  intakeRepository,
  calendarRepository,
  sourceFreshnessRepository,
}: Dependencies) {
  async function resolve(workspaceId: ProductWorkspaceId) {
    return requireHostedWorkspaceInstance(
      await workspaceResolver.resolve(principal, workspaceId),
    );
  }

  async function resolveSameUser(requiredWorkspaces: readonly ProductWorkspaceId[]) {
    const contexts = [];
    for (const workspaceId of requiredWorkspaces) {
      contexts.push(await resolve(workspaceId));
    }
    const [first, ...rest] = contexts;
    if (!first || rest.some((context) => context.userId !== first.userId)) {
      throw new Error("Workspace identity mismatch.");
    }
    return first.userId;
  }

  return {
    async submitIntakeProposal(input: IntakeProposalInput) {
      validate("Intake proposal", () => validateIntakeProposalInput(input));
      const context = await resolve(input.workspaceId);
      const result = await intakeRepository.ingest(context, input);
      return {
        status: result.status,
        intakeId: result.item.intakeId,
      } as const;
    },

    async syncCalendarBatch(input: CalendarSyncInput) {
      validate("Calendar sync", () => validateCalendarSyncInput(input));
      const requiredWorkspaces: ProductWorkspaceId[] = ["personal"];
      if (input.events.some((event) => event.automaticWorkspaceId === "indelitech")) {
        requiredWorkspaces.push("indelitech");
      }
      const userId = await resolveSameUser(requiredWorkspaces);
      const result = await calendarRepository.ingestBatch(userId, input);
      return {
        sourceKey: input.sourceKey,
        batchIndex: input.batchIndex,
        batchCount: input.batchCount,
        complete: result.complete,
        receivedBatchCount: result.receivedBatchCount,
      } as const;
    },

    async recordScanStatus(input: ScanStatusInput) {
      validate("Scan status", () => validateScanStatusInput(input));
      const userId = await resolveSameUser(["personal", "indelitech"]);
      await sourceFreshnessRepository.record(userId, input);
      return {
        scanRunId: input.scanRunId,
        recorded: true,
      } as const;
    },
  };
}

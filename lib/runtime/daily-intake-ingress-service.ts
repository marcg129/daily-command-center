import type { RequestContext } from "./context";
import type { IntakeRepository } from "./intake-repository";
import type { CalendarProjectionRepository } from "./calendar-projection-repository";
import type { SourceFreshnessRepository } from "./source-freshness-repository";
import type { ParsedDccEnvelope } from "./todoist-ingress-envelope";
import {
  TodoistRelayTransportError,
  TodoistWorkspaceAuthorizationError,
  type TodoistRelayActions,
  type TodoistTaskIngressOutcome,
} from "./todoist-task-ingress-service";

export interface DailyIntakeUserWorkspaceResolver {
  resolveUser(): Promise<{ userId: string }>;
  resolve(workspaceId: string): Promise<RequestContext>;
}

type Dependencies = Readonly<{
  intakeRepository: IntakeRepository;
  calendarRepository: CalendarProjectionRepository;
  sourceFreshnessRepository: SourceFreshnessRepository;
  workspaceResolver: DailyIntakeUserWorkspaceResolver;
  relay: TodoistRelayActions;
}>;

function transportOutcome(taskId: string, error: unknown): TodoistTaskIngressOutcome {
  if (error instanceof TodoistRelayTransportError && !error.transient) {
    return {
      status: "permanent-failure",
      todoistTaskId: taskId,
      diagnostic: "DCC relay update failed: Todoist authorization or configuration must be corrected.",
    };
  }
  return {
    status: "transient-failure",
    todoistTaskId: taskId,
    retryAfterSeconds: error instanceof TodoistRelayTransportError
      ? error.retryAfterSeconds ?? undefined
      : undefined,
  };
}

async function markAuthorizationFailure(
  relay: TodoistRelayActions,
  taskId: string,
): Promise<TodoistTaskIngressOutcome> {
  const diagnostic = "DCC import failed: configured DCC user is not authorized for the requested workspace.";
  try {
    await relay.markFailure(taskId, diagnostic);
    return { status: "permanent-failure", todoistTaskId: taskId, diagnostic };
  } catch (error) {
    return transportOutcome(taskId, error);
  }
}

export function createDailyIntakeIngressService({
  intakeRepository,
  calendarRepository,
  sourceFreshnessRepository,
  workspaceResolver,
  relay,
}: Dependencies) {
  return {
    async import(taskId: string, envelope: ParsedDccEnvelope): Promise<TodoistTaskIngressOutcome> {
      let persistenceStatus: "imported" | "already-imported" = "imported";

      try {
        if (envelope.kind === "intake_proposal") {
          const context = await workspaceResolver.resolve(envelope.payload.workspaceId);
          const result = await intakeRepository.ingest(context, envelope.payload);
          persistenceStatus = result.status === "created" ? "imported" : "already-imported";
        } else if (envelope.kind === "calendar_sync") {
          const { userId } = await workspaceResolver.resolveUser();
          if (envelope.payload.events.some((event) => event.automaticWorkspaceId === "indelitech")) {
            await workspaceResolver.resolve("indelitech");
          }
          await calendarRepository.ingestBatch(userId, envelope.payload);
        } else {
          const { userId } = await workspaceResolver.resolveUser();
          await sourceFreshnessRepository.record(userId, envelope.payload);
        }
      } catch (error) {
        if (error instanceof TodoistWorkspaceAuthorizationError) {
          return markAuthorizationFailure(relay, taskId);
        }
        return { status: "transient-failure", todoistTaskId: taskId };
      }

      try {
        await relay.closeTask(taskId);
      } catch (error) {
        return transportOutcome(taskId, error);
      }

      return { status: persistenceStatus, todoistTaskId: taskId };
    },
  };
}

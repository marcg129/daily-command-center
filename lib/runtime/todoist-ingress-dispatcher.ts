import {
  isVersionedDccEnvelope,
  parseTodoistIngressEnvelope,
  type ParsedDccEnvelope,
} from "./todoist-ingress-envelope";
import {
  TodoistTaskIngressValidationError,
  type TodoistRelayTask,
} from "./todoist-task-ingress";
import {
  TodoistRelayTransportError,
  type TodoistRelayActions,
  type TodoistTaskIngressOutcome,
} from "./todoist-task-ingress-service";

type Dependencies = Readonly<{
  legacyImportTask: (task: TodoistRelayTask) => Promise<TodoistTaskIngressOutcome>;
  dailyIntakeImport: (taskId: string, envelope: ParsedDccEnvelope) => Promise<TodoistTaskIngressOutcome>;
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

async function markValidationFailure(
  relay: TodoistRelayActions,
  taskId: string,
  error: TodoistTaskIngressValidationError,
): Promise<TodoistTaskIngressOutcome> {
  const diagnostic = `DCC import failed: ${error.message}`;
  try {
    await relay.markFailure(taskId, diagnostic);
    return { status: "permanent-failure", todoistTaskId: taskId, diagnostic };
  } catch (transportError) {
    return transportOutcome(taskId, transportError);
  }
}

export function createTodoistIngressDispatcher({
  legacyImportTask,
  dailyIntakeImport,
  relay,
}: Dependencies) {
  return async function importTask(task: TodoistRelayTask): Promise<TodoistTaskIngressOutcome> {
    if (!isVersionedDccEnvelope(task)) return legacyImportTask(task);

    let envelope: ParsedDccEnvelope;
    try {
      envelope = parseTodoistIngressEnvelope(task);
    } catch (error) {
      if (error instanceof TodoistTaskIngressValidationError) {
        return markValidationFailure(relay, task.id, error);
      }
      return { status: "transient-failure", todoistTaskId: task.id };
    }

    return dailyIntakeImport(task.id, envelope);
  };
}

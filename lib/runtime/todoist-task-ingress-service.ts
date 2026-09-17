import type { RequestContext } from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import { createHostedStructuredTaskCaptureService } from "@/lib/runtime/hosted-task-capture";
import type { Clock } from "@/lib/runtime/primitives";
import {
  TaskCaptureConflictError,
  TaskCaptureValidationError,
  type StructuredTaskCapture,
} from "@/lib/runtime/task-capture";
import {
  parseTodoistRelayTask,
  TodoistTaskIngressValidationError,
  type TodoistRelayTask,
} from "@/lib/runtime/todoist-task-ingress";

export interface TodoistUserWorkspaceResolver {
  resolve(workspaceId: string): Promise<RequestContext>;
}

export interface TodoistRelayActions {
  closeTask(taskId: string): Promise<void>;
  markFailure(taskId: string, diagnostic: string): Promise<void>;
}

export class TodoistWorkspaceAuthorizationError extends Error {
  constructor(message = "Workspace access denied.") {
    super(message);
    this.name = "TodoistWorkspaceAuthorizationError";
  }
}

export class TodoistRelayTransportError extends Error {
  readonly transient: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: { transient: boolean; retryAfterSeconds?: number | null },
  ) {
    super(message);
    this.name = "TodoistRelayTransportError";
    this.transient = options.transient;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export type TodoistTaskIngressOutcome = Readonly<{
  status: "imported" | "already-imported" | "permanent-failure" | "transient-failure";
  todoistTaskId: string;
  requestId?: string;
  diagnostic?: string;
  retryAfterSeconds?: number;
}>;

type Dependencies = Readonly<{
  repository: HostedTaskRepository;
  clock: Clock;
  workspaceResolver: TodoistUserWorkspaceResolver;
  relay: TodoistRelayActions;
}>;

function retryAfter(error: unknown): number | undefined {
  if (!(error instanceof TodoistRelayTransportError)) return undefined;
  return error.retryAfterSeconds ?? undefined;
}

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
    retryAfterSeconds: retryAfter(error),
  };
}

async function markPermanentFailure(
  relay: TodoistRelayActions,
  taskId: string,
  diagnostic: string,
  requestId?: string,
): Promise<TodoistTaskIngressOutcome> {
  try {
    await relay.markFailure(taskId, diagnostic);
    return {
      status: "permanent-failure",
      todoistTaskId: taskId,
      requestId,
      diagnostic,
    };
  } catch (error) {
    return { ...transportOutcome(taskId, error), requestId };
  }
}

function validationDiagnostic(error: Error): string {
  return `DCC import failed: ${error.message}`;
}

/**
 * Processes one task that has already been read from the dedicated Todoist
 * relay project. DCC persistence is canonical and always happens before the
 * relay is closed. Identical re-deliveries therefore replay safely.
 */
export function createTodoistTaskIngressService({
  repository,
  clock,
  workspaceResolver,
  relay,
}: Dependencies) {
  const capture = createHostedStructuredTaskCaptureService(repository, clock);

  return async function importTask(task: TodoistRelayTask): Promise<TodoistTaskIngressOutcome> {
    let input: StructuredTaskCapture;
    try {
      input = parseTodoistRelayTask(task);
    } catch (error) {
      if (error instanceof TodoistTaskIngressValidationError || error instanceof TaskCaptureValidationError) {
        return markPermanentFailure(relay, task.id, validationDiagnostic(error));
      }
      return { status: "transient-failure", todoistTaskId: task.id };
    }

    let context: RequestContext;
    try {
      context = await workspaceResolver.resolve(input.workspaceId);
    } catch (error) {
      if (error instanceof TodoistWorkspaceAuthorizationError) {
        return markPermanentFailure(
          relay,
          task.id,
          `DCC import failed: configured DCC user is not authorized for ${input.workspaceId}.`,
          input.requestId,
        );
      }
      return {
        status: "transient-failure",
        todoistTaskId: task.id,
        requestId: input.requestId,
      };
    }

    let result;
    try {
      result = await capture(context, input);
    } catch (error) {
      if (error instanceof TaskCaptureConflictError) {
        return markPermanentFailure(
          relay,
          task.id,
          "DCC import failed: relay identity conflicts with an existing DCC task.",
          input.requestId,
        );
      }
      if (error instanceof TaskCaptureValidationError) {
        return markPermanentFailure(relay, task.id, validationDiagnostic(error), input.requestId);
      }
      return {
        status: "transient-failure",
        todoistTaskId: task.id,
        requestId: input.requestId,
      };
    }

    try {
      await relay.closeTask(task.id);
    } catch (error) {
      return {
        ...transportOutcome(task.id, error),
        requestId: input.requestId,
      };
    }

    return {
      status: result.created ? "imported" : "already-imported",
      todoistTaskId: task.id,
      requestId: input.requestId,
    };
  };
}

import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import {
  createHostedStructuredTaskCaptureService,
  hostedTaskFromCapture,
} from "@/lib/runtime/hosted-task-capture";
import type { Clock } from "@/lib/runtime/primitives";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";
import {
  parseStructuredTaskCapture,
  TaskCaptureValidationError,
  type StructuredTaskCapture,
} from "@/lib/runtime/task-capture";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

type CaptureWithoutRequestId = Omit<StructuredTaskCapture, "requestId">;

export type ChatTaskCaptureProposal = Readonly<{
  requestId: string;
  workspaceId: StructuredTaskCapture["workspaceId"];
  title: string;
  context: string | null;
  type: NonNullable<StructuredTaskCapture["type"]>;
  priority: NonNullable<StructuredTaskCapture["priority"]>;
  due: string | null;
  remindAt: string | null;
  followUpAt: string | null;
  recurrence: NonNullable<StructuredTaskCapture["recurrence"]>;
  repeats: boolean;
  estimatedDuration: StructuredTaskCapture["estimatedDuration"] | null;
  category: string | null;
  project: string | null;
  person: string | null;
  dependency: string | null;
  sourceContext: string | null;
}>;

export class TaskCaptureConfirmationError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TaskCaptureValidationError("A structured capture object is required.");
  }
  return value as Record<string, unknown>;
}

function proposal(input: StructuredTaskCapture, now: string): ChatTaskCaptureProposal {
  const task = hostedTaskFromCapture(input, now);
  const recurrence = input.recurrence ?? "One-time";
  return {
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    title: input.title,
    context: input.context ?? null,
    type: task.type,
    priority: task.priority,
    due: input.due ?? null,
    remindAt: input.remindAt ?? null,
    followUpAt: input.followUpAt ?? null,
    recurrence,
    repeats: recurrence !== "One-time",
    estimatedDuration: input.estimatedDuration ?? null,
    category: input.category ?? null,
    project: input.project ?? null,
    person: input.person ?? null,
    dependency: input.dependency ?? null,
    sourceContext: input.sourceContext ?? null,
  };
}

/**
 * Chat-facing composition around canonical hosted task capture.
 *
 * Preview is intentionally persistence-free. Create requires an explicit
 * confirmation flag and then delegates to the existing idempotent D1-backed
 * capture service; it never creates a second task record or storage path.
 */
export function createChatTaskCaptureService(
  principal: AuthenticatedPrincipal,
  workspaceResolver: WorkspaceResolver,
  repository: HostedTaskRepository,
  clock: Clock,
  requestId: () => string = () => `chat:${crypto.randomUUID()}`,
) {
  const capture = createHostedStructuredTaskCaptureService(repository, clock);

  return {
    async preview(value: unknown) {
      const raw = record(value);
      const input = parseStructuredTaskCapture({ ...raw, requestId: requestId() });
      await workspaceResolver.resolve(principal, input.workspaceId);
      return proposal(input, clock.now().toISOString());
    },

    async create(value: unknown) {
      const raw = record(value);
      if (raw.confirmedByUser !== true) {
        throw new TaskCaptureConfirmationError(
          "Explicit user confirmation is required before creating a task.",
        );
      }
      const captureInput = { ...raw };
      delete captureInput.confirmedByUser;
      const input = parseStructuredTaskCapture(captureInput);
      const context = await workspaceResolver.resolve(principal, input.workspaceId);
      return capture(context, input);
    },
  };
}

export type ChatTaskCaptureInput = CaptureWithoutRequestId;

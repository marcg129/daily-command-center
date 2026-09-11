import {
  PRODUCT_WORKSPACE_IDS,
  requireHostedContext,
  taskVisibleInWorkspace,
  type RequestContext,
} from "@/lib/runtime/context";
import type { HostedTaskRepository } from "@/lib/runtime/hosted-task-repository";
import type { HostedTask } from "@/lib/runtime/hosted-tasks";
import type { Clock } from "@/lib/runtime/primitives";
import {
  captureFingerprint,
  captureTaskId,
  parseStructuredTaskCapture,
  TaskCaptureConflictError,
  TaskCaptureValidationError,
  type CaptureDuration,
  type CaptureInterpretation,
  type StructuredTaskCapture,
} from "@/lib/runtime/task-capture";

const DURATION_MINUTES: Record<CaptureDuration, number | null> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h+": 120,
  Project: null,
};

export type HostedTaskCaptureResult = {
  created: boolean;
  task: HostedTask;
  interpretation: CaptureInterpretation;
};

export function hostedTaskFromCapture(input: StructuredTaskCapture, now: string): HostedTask {
  const recurrence = input.recurrence ?? "One-time";
  const type = recurrence !== "One-time" ? "RECURRING" : input.type ?? (input.due ? "DEADLINE" : "ONE_TIME");
  return {
    taskId: captureTaskId(input),
    primaryWorkspaceId: input.workspaceId,
    title: input.title,
    context: input.context ?? "No additional details.",
    category: input.category ?? null,
    project: input.project ?? null,
    person: input.person ?? null,
    type,
    priority: input.priority ?? "MEDIUM",
    status: type === "WAITING" ? "WAITING" : "OPEN",
    dueAt: input.due ?? null,
    dueIsDateOnly: input.due != null,
    remindAt: input.remindAt ?? null,
    followUpAt: input.followUpAt ?? null,
    estimatedDuration: input.estimatedDuration ? DURATION_MINUTES[input.estimatedDuration] : null,
    estimatedDurationLabel: input.estimatedDuration ?? null,
    recurrence: recurrence === "One-time" ? null : recurrence,
    seriesId: null,
    recurrenceAnchorDay: null,
    dependency: input.dependency ?? null,
    createdAt: now,
    completedAt: null,
    source: "send-to-tasks",
    sourceContext: input.sourceContext ?? null,
    lastNotifiedAt: null,
    updatedAt: now,
    captureFingerprint: captureFingerprint(input),
  };
}

function interpretation(task: HostedTask): CaptureInterpretation {
  return {
    workspaceId: task.primaryWorkspaceId,
    type: task.type,
    priority: task.priority,
    due: task.dueAt ?? "",
    remindAt: task.remindAt ?? undefined,
    followUpAt: task.followUpAt ?? undefined,
    recurrence: task.recurrence ?? "One-time",
  };
}

function replay(candidate: HostedTask, existing: HostedTask): HostedTaskCaptureResult {
  if (existing.source !== "send-to-tasks" || existing.captureFingerprint !== candidate.captureFingerprint) {
    throw new TaskCaptureConflictError("requestId is already associated with a different task capture.");
  }
  return { created: false, task: existing, interpretation: interpretation(existing) };
}

export function createHostedStructuredTaskCaptureService(repository: HostedTaskRepository, clock: Clock) {
  return async function capture(context: RequestContext, value: unknown): Promise<HostedTaskCaptureResult> {
    const workspaceId = requireHostedContext(context);
    const input = parseStructuredTaskCapture(value);
    if (input.workspaceId !== workspaceId) {
      throw new TaskCaptureValidationError("Capture workspace must match the authorized workspace context.");
    }
    const candidate = hostedTaskFromCapture(input, clock.now().toISOString());
    const existing = await repository.get(context, candidate.taskId);
    if (existing) return replay(candidate, existing);

    const visibleIn = [workspaceId, ...PRODUCT_WORKSPACE_IDS.filter((target) => target !== workspaceId)]
      .filter((target) => taskVisibleInWorkspace(workspaceId, target));
    try {
      const saved = await repository.create(context, candidate, visibleIn);
      return { created: true, task: saved, interpretation: interpretation(saved) };
    } catch (error) {
      // Only retry within the authorized view; never probe globally for hidden collisions.
      const raced = await repository.get(context, candidate.taskId);
      if (raced) return replay(candidate, raced);
      throw error;
    }
  };
}

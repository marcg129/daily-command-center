import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import type { TodoistTaskIngressOutcome } from "@/lib/runtime/todoist-task-ingress-service";

export const TODOIST_INGRESS_BATCH_LIMIT = 50;

export interface TodoistIngressQueue {
  listRelayTasks(): Promise<TodoistRelayTask[]>;
}

export type TodoistIngressControlState = Readonly<{
  rotationOffset: number;
  cooldownUntilMs: number | null;
}>;

export interface TodoistIngressControlStore {
  load(): Promise<TodoistIngressControlState>;
  save(state: TodoistIngressControlState): Promise<void>;
}

export type TodoistIngressBatchSummary = Readonly<{
  listed: number;
  attempted: number;
  imported: number;
  alreadyImported: number;
  permanentFailures: number;
  transientFailures: number;
  deferred: number;
  retryAfterSeconds: number | null;
  skippedForBackoff: boolean;
}>;

type RunOptions = Readonly<{
  control?: TodoistIngressControlStore;
  nowMs?: number;
}>;

const DEFAULT_CONTROL_STATE: TodoistIngressControlState = {
  rotationOffset: 0,
  cooldownUntilMs: null,
};

function retryAfterSeconds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.ceil(raw);
}

function rotatedBatch(tasks: TodoistRelayTask[], offset: number): TodoistRelayTask[] {
  if (tasks.length === 0) return [];
  const start = offset % tasks.length;
  const count = Math.min(tasks.length, TODOIST_INGRESS_BATCH_LIMIT);
  return Array.from({ length: count }, (_, index) => tasks[(start + index) % tasks.length]);
}

function emptySummary(retryAfter: number | null, skippedForBackoff: boolean): TodoistIngressBatchSummary {
  return {
    listed: 0,
    attempted: 0,
    imported: 0,
    alreadyImported: 0,
    permanentFailures: 0,
    transientFailures: 0,
    deferred: 0,
    retryAfterSeconds: retryAfter,
    skippedForBackoff,
  };
}

/**
 * Runs one bounded poll of the relay project. A durable control store is used
 * by the scheduled Worker to honor provider cooldowns across invocations and
 * rotate the starting point so permanently failed open tasks cannot starve
 * later relays. Queue-read failures remain visible by rejecting the run.
 */
export async function runTodoistIngressBatch(
  queue: TodoistIngressQueue,
  importTask: (task: TodoistRelayTask) => Promise<TodoistTaskIngressOutcome>,
  options: RunOptions = {},
): Promise<TodoistIngressBatchSummary> {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("Todoist ingress run time is invalid.");

  const state = options.control ? await options.control.load() : DEFAULT_CONTROL_STATE;
  if (!Number.isSafeInteger(state.rotationOffset) || state.rotationOffset < 0) {
    throw new Error("Todoist ingress rotation state is invalid.");
  }
  if (state.cooldownUntilMs !== null && (!Number.isSafeInteger(state.cooldownUntilMs) || state.cooldownUntilMs < 0)) {
    throw new Error("Todoist ingress cooldown state is invalid.");
  }

  if (state.cooldownUntilMs !== null && state.cooldownUntilMs > nowMs) {
    return emptySummary(Math.ceil((state.cooldownUntilMs - nowMs) / 1000), true);
  }

  let listedTasks: TodoistRelayTask[];
  try {
    listedTasks = await queue.listRelayTasks();
  } catch (error) {
    const retryAfter = retryAfterSeconds(error);
    if (options.control && retryAfter !== null) {
      await options.control.save({
        rotationOffset: state.rotationOffset,
        cooldownUntilMs: nowMs + retryAfter * 1000,
      });
    }
    throw error;
  }

  if (listedTasks.length === 0) {
    if (options.control && (state.rotationOffset !== 0 || state.cooldownUntilMs !== null)) {
      await options.control.save(DEFAULT_CONTROL_STATE);
    }
    return emptySummary(null, false);
  }

  const tasks = rotatedBatch(listedTasks, state.rotationOffset);
  const start = state.rotationOffset % listedTasks.length;
  let imported = 0;
  let alreadyImported = 0;
  let permanentFailures = 0;
  let transientFailures = 0;
  let attempted = 0;
  let providerRetryAfter: number | null = null;

  for (const task of tasks) {
    attempted += 1;
    try {
      const outcome = await importTask(task);
      if (outcome.status === "imported") imported += 1;
      else if (outcome.status === "already-imported") alreadyImported += 1;
      else if (outcome.status === "permanent-failure") permanentFailures += 1;
      else {
        transientFailures += 1;
        if (
          typeof outcome.retryAfterSeconds === "number" &&
          Number.isFinite(outcome.retryAfterSeconds) &&
          outcome.retryAfterSeconds > 0
        ) {
          providerRetryAfter = Math.ceil(outcome.retryAfterSeconds);
          break;
        }
      }
    } catch {
      // Unexpected per-task faults are retryable by default. Without provider
      // retry metadata, continue so one D1/provider edge case does not block
      // unrelated relay items in the same bounded batch.
      transientFailures += 1;
    }
  }

  const nextRotationOffset = (start + attempted) % listedTasks.length;
  if (options.control) {
    await options.control.save({
      rotationOffset: nextRotationOffset,
      cooldownUntilMs: providerRetryAfter === null ? null : nowMs + providerRetryAfter * 1000,
    });
  }

  return {
    listed: listedTasks.length,
    attempted,
    imported,
    alreadyImported,
    permanentFailures,
    transientFailures,
    deferred: Math.max(0, listedTasks.length - attempted),
    retryAfterSeconds: providerRetryAfter,
    skippedForBackoff: false,
  };
}

import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import type { TodoistTaskIngressOutcome } from "@/lib/runtime/todoist-task-ingress-service";

export const TODOIST_INGRESS_BATCH_LIMIT = 50;

export interface TodoistIngressQueue {
  listRelayTasks(): Promise<TodoistRelayTask[]>;
}

export type TodoistIngressControlState = Readonly<{
  cursorAddedAt: string | null;
  cursorTaskId: string | null;
  cooldownUntilMs: number | null;
}>;

export type TodoistIngressControlWriteMetadata = Readonly<{
  runStartedAtMs: number;
  observedAtMs: number;
}>;

export interface TodoistIngressControlStore {
  load(): Promise<TodoistIngressControlState>;
  save(state: TodoistIngressControlState, metadata: TodoistIngressControlWriteMetadata): Promise<void>;
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
  clock?: () => number;
}>;

const DEFAULT_CONTROL_STATE: TodoistIngressControlState = {
  cursorAddedAt: null,
  cursorTaskId: null,
  cooldownUntilMs: null,
};

function retryAfterSeconds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.ceil(raw);
}

function now(clock: () => number): number {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Todoist ingress run time is invalid.");
  return value;
}

function validateControlState(state: TodoistIngressControlState) {
  if ((state.cursorAddedAt === null) !== (state.cursorTaskId === null)) {
    throw new Error("Todoist ingress cursor state is invalid.");
  }
  if (state.cursorAddedAt !== null && !Number.isFinite(Date.parse(state.cursorAddedAt))) {
    throw new Error("Todoist ingress cursor state is invalid.");
  }
  if (state.cursorTaskId !== null && !state.cursorTaskId.trim()) {
    throw new Error("Todoist ingress cursor state is invalid.");
  }
  if (state.cooldownUntilMs !== null && (!Number.isSafeInteger(state.cooldownUntilMs) || state.cooldownUntilMs < 0)) {
    throw new Error("Todoist ingress cooldown state is invalid.");
  }
}

function compareRelayTasks(left: TodoistRelayTask, right: TodoistRelayTask): number {
  const leftAddedAt = left.addedAt;
  const rightAddedAt = right.addedAt;
  if (!leftAddedAt || !rightAddedAt || !Number.isFinite(Date.parse(leftAddedAt)) || !Number.isFinite(Date.parse(rightAddedAt))) {
    throw new Error("Todoist ingress task ordering metadata is invalid.");
  }
  const added = leftAddedAt.localeCompare(rightAddedAt);
  return added !== 0 ? added : left.id.localeCompare(right.id);
}

function compareTaskToCursor(task: TodoistRelayTask, state: TodoistIngressControlState): number {
  if (state.cursorAddedAt === null || state.cursorTaskId === null) return 1;
  if (!task.addedAt) throw new Error("Todoist ingress task ordering metadata is invalid.");
  const added = task.addedAt.localeCompare(state.cursorAddedAt);
  return added !== 0 ? added : task.id.localeCompare(state.cursorTaskId);
}

function stableCursorBatch(tasks: TodoistRelayTask[], state: TodoistIngressControlState): TodoistRelayTask[] {
  const ordered = [...tasks].sort(compareRelayTasks);
  if (ordered.length === 0) return [];
  const afterCursor = state.cursorTaskId === null
    ? 0
    : ordered.findIndex((task) => compareTaskToCursor(task, state) > 0);
  const start = afterCursor < 0 ? 0 : afterCursor;
  const count = Math.min(ordered.length, TODOIST_INGRESS_BATCH_LIMIT);
  return Array.from({ length: count }, (_, index) => ordered[(start + index) % ordered.length]);
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
 * Runs one bounded poll of the relay project. The scheduled Worker persists a
 * stable Todoist task cursor and provider cooldown so closed tasks/new arrivals
 * cannot starve deferred relays and rate-limit windows survive cron invocations.
 */
export async function runTodoistIngressBatch(
  queue: TodoistIngressQueue,
  importTask: (task: TodoistRelayTask) => Promise<TodoistTaskIngressOutcome>,
  options: RunOptions = {},
): Promise<TodoistIngressBatchSummary> {
  const clock = options.clock ?? Date.now;
  const runStartedAtMs = now(clock);
  const state = options.control ? await options.control.load() : DEFAULT_CONTROL_STATE;
  validateControlState(state);

  if (state.cooldownUntilMs !== null && state.cooldownUntilMs > runStartedAtMs) {
    return emptySummary(Math.ceil((state.cooldownUntilMs - runStartedAtMs) / 1000), true);
  }

  let listedTasks: TodoistRelayTask[];
  try {
    listedTasks = await queue.listRelayTasks();
  } catch (error) {
    const retryAfter = retryAfterSeconds(error);
    if (options.control && retryAfter !== null) {
      const observedAtMs = now(clock);
      await options.control.save({
        ...state,
        cooldownUntilMs: observedAtMs + retryAfter * 1000,
      }, { runStartedAtMs, observedAtMs });
    }
    throw error;
  }

  if (listedTasks.length === 0) {
    if (options.control && state.cooldownUntilMs !== null) {
      const observedAtMs = now(clock);
      await options.control.save({ ...state, cooldownUntilMs: null }, { runStartedAtMs, observedAtMs });
    }
    return emptySummary(null, false);
  }

  const tasks = options.control
    ? stableCursorBatch(listedTasks, state)
    : listedTasks.slice(0, TODOIST_INGRESS_BATCH_LIMIT);
  let imported = 0;
  let alreadyImported = 0;
  let permanentFailures = 0;
  let transientFailures = 0;
  let attempted = 0;
  let providerRetryAfter: number | null = null;
  let providerRetryObservedAtMs: number | null = null;
  let lastAttemptedTask: TodoistRelayTask | null = null;

  for (const task of tasks) {
    attempted += 1;
    lastAttemptedTask = task;
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
          providerRetryObservedAtMs = now(clock);
          break;
        }
      }
    } catch {
      transientFailures += 1;
    }
  }

  if (options.control) {
    const observedAtMs = providerRetryObservedAtMs ?? now(clock);
    const cursorAddedAt = lastAttemptedTask?.addedAt ?? state.cursorAddedAt;
    const cursorTaskId = lastAttemptedTask?.id ?? state.cursorTaskId;
    if ((cursorAddedAt === null) !== (cursorTaskId === null) || (cursorAddedAt !== null && cursorAddedAt === undefined)) {
      throw new Error("Todoist ingress task ordering metadata is invalid.");
    }
    await options.control.save({
      cursorAddedAt: cursorAddedAt ?? null,
      cursorTaskId: cursorTaskId ?? null,
      cooldownUntilMs: providerRetryAfter === null
        ? null
        : observedAtMs + providerRetryAfter * 1000,
    }, { runStartedAtMs, observedAtMs });
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

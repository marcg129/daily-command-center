import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";
import type { TodoistTaskIngressOutcome } from "@/lib/runtime/todoist-task-ingress-service";

export const TODOIST_INGRESS_BATCH_LIMIT = 50;

export interface TodoistIngressQueue {
  listRelayTasks(): Promise<TodoistRelayTask[]>;
}

export type TodoistIngressBatchSummary = Readonly<{
  listed: number;
  attempted: number;
  imported: number;
  alreadyImported: number;
  permanentFailures: number;
  transientFailures: number;
  deferred: number;
}>;

/**
 * Runs one bounded poll of the relay project. Queue-read failure rejects the
 * entire run because treating an unreadable inbox as empty would hide an
 * outage. Once tasks are listed, each item is isolated so one malformed or
 * unexpectedly failing task cannot block the rest of the batch.
 */
export async function runTodoistIngressBatch(
  queue: TodoistIngressQueue,
  importTask: (task: TodoistRelayTask) => Promise<TodoistTaskIngressOutcome>,
): Promise<TodoistIngressBatchSummary> {
  const listedTasks = await queue.listRelayTasks();
  const tasks = listedTasks.slice(0, TODOIST_INGRESS_BATCH_LIMIT);

  let imported = 0;
  let alreadyImported = 0;
  let permanentFailures = 0;
  let transientFailures = 0;

  for (const task of tasks) {
    try {
      const outcome = await importTask(task);
      if (outcome.status === "imported") imported += 1;
      else if (outcome.status === "already-imported") alreadyImported += 1;
      else if (outcome.status === "permanent-failure") permanentFailures += 1;
      else transientFailures += 1;
    } catch {
      // Unexpected per-task faults are retryable by default. Do not let one
      // provider/D1 edge case prevent later relay items from being attempted.
      transientFailures += 1;
    }
  }

  return {
    listed: listedTasks.length,
    attempted: tasks.length,
    imported,
    alreadyImported,
    permanentFailures,
    transientFailures,
    deferred: Math.max(0, listedTasks.length - tasks.length),
  };
}

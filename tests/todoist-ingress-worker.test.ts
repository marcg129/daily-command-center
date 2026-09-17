import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runTodoistIngressBatch,
  type TodoistIngressControlState,
  type TodoistIngressControlStore,
  type TodoistIngressControlWriteMetadata,
  type TodoistIngressQueue,
} from "@/lib/runtime/todoist-ingress-runner";
import type { TodoistTaskIngressOutcome } from "@/lib/runtime/todoist-task-ingress-service";
import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";

const TASK_EPOCH = Date.parse("2026-09-16T12:00:00.000Z");

function relayTask(id: string, position = 0): TodoistRelayTask {
  return {
    id,
    content: `Task ${id}`,
    description: "workspace: personal",
    addedAt: new Date(TASK_EPOCH + position * 1000).toISOString(),
  };
}

class MemoryControlStore implements TodoistIngressControlStore {
  state: TodoistIngressControlState = {
    cursorAddedAt: null,
    cursorTaskId: null,
    cooldownUntilMs: null,
  };
  writes: TodoistIngressControlWriteMetadata[] = [];
  async load() { return this.state; }
  async save(state: TodoistIngressControlState, metadata: TodoistIngressControlWriteMetadata) {
    this.state = state;
    this.writes.push(metadata);
  }
}

function text(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function jsonc(path: string) {
  return JSON.parse(text(path).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

test("batch runner bounds one cron invocation and isolates one bad task from the rest", async () => {
  const tasks = Array.from({ length: 55 }, (_, index) => relayTask(`task-${index + 1}`, index + 1));
  const queue: TodoistIngressQueue = { async listRelayTasks() { return tasks; } };
  const seen: string[] = [];
  const summary = await runTodoistIngressBatch(queue, async (task): Promise<TodoistTaskIngressOutcome> => {
    seen.push(task.id);
    if (task.id === "task-2") throw new Error("unexpected per-task bug");
    if (task.id === "task-3") return { status: "transient-failure", todoistTaskId: task.id };
    if (task.id === "task-4") return { status: "permanent-failure", todoistTaskId: task.id, diagnostic: "bad metadata" };
    return { status: "imported", todoistTaskId: task.id };
  });

  assert.equal(seen.length, 50);
  assert.deepEqual(seen.slice(0, 5), ["task-1", "task-2", "task-3", "task-4", "task-5"]);
  assert.deepEqual(summary, {
    listed: 55,
    attempted: 50,
    imported: 47,
    alreadyImported: 0,
    permanentFailures: 1,
    transientFailures: 2,
    deferred: 5,
    retryAfterSeconds: null,
    skippedForBackoff: false,
  });
});

test("batch runner counts idempotent replays separately", async () => {
  const queue: TodoistIngressQueue = {
    async listRelayTasks() { return [relayTask("a", 1), relayTask("b", 2)]; },
  };
  const summary = await runTodoistIngressBatch(queue, async (task) => ({
    status: "already-imported",
    todoistTaskId: task.id,
  }));

  assert.equal(summary.alreadyImported, 2);
  assert.equal(summary.imported, 0);
  assert.equal(summary.deferred, 0);
});

test("provider retry-after starts when observed and persists a durable cooldown", async () => {
  const queue: TodoistIngressQueue = {
    async listRelayTasks() { return [relayTask("a", 1), relayTask("b", 2), relayTask("c", 3)]; },
  };
  const control = new MemoryControlStore();
  const seen: string[] = [];
  const startMs = Date.parse("2026-09-16T20:00:00.000Z");
  let currentMs = startMs;

  const summary = await runTodoistIngressBatch(queue, async (task) => {
    seen.push(task.id);
    if (task.id === "b") {
      currentMs = startMs + 120_000;
      return { status: "transient-failure", todoistTaskId: task.id, retryAfterSeconds: 180 };
    }
    return { status: "imported", todoistTaskId: task.id };
  }, { control, clock: () => currentMs });

  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(summary.retryAfterSeconds, 180);
  assert.equal(summary.attempted, 2);
  assert.equal(control.state.cooldownUntilMs, startMs + 300_000);
  assert.equal(control.state.cursorTaskId, "b");
  assert.equal(control.state.cursorAddedAt, relayTask("b", 2).addedAt);

  let listedAgain = false;
  currentMs = startMs + 180_000;
  const skipped = await runTodoistIngressBatch({
    async listRelayTasks() {
      listedAgain = true;
      return [relayTask("a", 1)];
    },
  }, async () => ({ status: "imported", todoistTaskId: "a" }), {
    control,
    clock: () => currentMs,
  });

  assert.equal(listedAgain, false);
  assert.equal(skipped.skippedForBackoff, true);
  assert.equal(skipped.attempted, 0);
});

test("stable task cursor survives closed tasks and new arrivals without starving the deferred relay", async () => {
  const initial = Array.from({ length: 51 }, (_, index) => relayTask(`task-${index + 1}`, index + 1));
  let listed = initial;
  const queue: TodoistIngressQueue = { async listRelayTasks() { return listed; } };
  const control = new MemoryControlStore();
  const firstSeen: string[] = [];
  const secondSeen: string[] = [];
  let currentMs = 1_000;

  await runTodoistIngressBatch(queue, async (task) => {
    firstSeen.push(task.id);
    return task.id === "task-1"
      ? { status: "imported", todoistTaskId: task.id }
      : { status: "permanent-failure", todoistTaskId: task.id, diagnostic: "bad metadata" };
  }, { control, clock: () => currentMs });

  listed = [...initial.slice(1), relayTask("task-52", 52)];
  currentMs = 61_000;
  await runTodoistIngressBatch(queue, async (task) => {
    secondSeen.push(task.id);
    return { status: "imported", todoistTaskId: task.id };
  }, { control, clock: () => currentMs });

  assert.equal(firstSeen.length, 50);
  assert.equal(firstSeen.at(-1), "task-50");
  assert.equal(secondSeen[0], "task-51");
  assert.ok(secondSeen.includes("task-52"));
});

test("queue-read failure rejects the run instead of pretending the inbox was empty", async () => {
  const queue: TodoistIngressQueue = {
    async listRelayTasks() { throw new Error("Todoist unavailable"); },
  };
  await assert.rejects(runTodoistIngressBatch(queue, async () => {
    throw new Error("must not execute");
  }), /Todoist unavailable/);
});

test("Todoist ingress Worker is cron-only, private, and uses explicit bindings", () => {
  const worker = text("../workers/todoist-task-ingress.ts");
  const config = jsonc("../wrangler.todoist.jsonc");

  assert.match(worker, /scheduled\s*\(/);
  assert.doesNotMatch(worker, /\bfetch\s*\(/);
  assert.match(worker, /D1TaskRepository/);
  assert.match(worker, /D1UserWorkspaceResolver/);
  assert.match(worker, /D1TodoistIngressControlStore/);
  assert.match(worker, /createTodoistApiClient/);
  assert.match(worker, /runTodoistIngressBatch/);
  assert.match(worker, /clock:\s*\(\)\s*=>\s*Date\.now\(\)/);

  assert.equal(config.name, "daily-command-center-todoist-ingress");
  assert.equal(config.main, "workers/todoist-task-ingress.ts");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.triggers, { crons: ["* * * * *"] });
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "daily-command-center-prod",
    database_id: "2f67ea9a-bf97-4008-9031-2ebfdb5a6e57",
  }]);
  assert.deepEqual(config.vars, { TODOIST_PROJECT_ID: "6hWfF7hXXMj9XpV5" });
  assert.doesNotMatch(JSON.stringify(config), /TODOIST_API_TOKEN|DCC_USER_ID/);
});

test("Todoist deploy applies migrations before deploying the Worker", () => {
  const deployWorkflow = text("../.github/workflows/cloudflare-todoist-deploy.yml");
  const migration = text("../migrations/0011_todoist_ingress_control.sql");
  assert.match(deployWorkflow, /d1 migrations apply daily-command-center-prod --remote --config wrangler\.todoist\.jsonc/);
  assert.match(migration, /CREATE TABLE todoist_ingress_control/);
  assert.match(migration, /cooldown_until_ms INTEGER/);
  assert.match(migration, /cursor_added_at TEXT/);
  assert.match(migration, /cursor_task_id TEXT/);
  assert.match(migration, /cursor_run_started_ms INTEGER NOT NULL/);
});

test("CI dry-runs the Todoist Worker without embedding deployment secrets", () => {
  const packageJson = JSON.parse(text("../package.json")) as { scripts: Record<string, string> };
  const checkWorkflow = text("../.github/workflows/check.yml");

  assert.equal(packageJson.scripts["build:todoist"], "wrangler deploy --dry-run --config wrangler.todoist.jsonc");
  assert.equal(packageJson.scripts["deploy:todoist"], "wrangler deploy --config wrangler.todoist.jsonc");
  assert.match(checkWorkflow, /npm run build:todoist/);
  assert.doesNotMatch(text("../wrangler.todoist.jsonc"), /TODOIST_API_TOKEN|DCC_USER_ID/);
});

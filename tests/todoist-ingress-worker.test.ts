import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runTodoistIngressBatch,
  type TodoistIngressQueue,
} from "@/lib/runtime/todoist-ingress-runner";
import type { TodoistTaskIngressOutcome } from "@/lib/runtime/todoist-task-ingress-service";
import type { TodoistRelayTask } from "@/lib/runtime/todoist-task-ingress";

function relayTask(id: string): TodoistRelayTask {
  return { id, content: `Task ${id}`, description: "workspace: personal" };
}

function text(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function jsonc(path: string) {
  return JSON.parse(text(path).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

test("batch runner bounds one cron invocation and isolates one bad task from the rest", async () => {
  const tasks = Array.from({ length: 55 }, (_, index) => relayTask(`task-${index + 1}`));
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
  });
});

test("batch runner counts idempotent replays separately", async () => {
  const queue: TodoistIngressQueue = {
    async listRelayTasks() { return [relayTask("a"), relayTask("b")]; },
  };
  const summary = await runTodoistIngressBatch(queue, async (task) => ({
    status: "already-imported",
    todoistTaskId: task.id,
  }));

  assert.equal(summary.alreadyImported, 2);
  assert.equal(summary.imported, 0);
  assert.equal(summary.deferred, 0);
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
  assert.match(worker, /createTodoistApiClient/);
  assert.match(worker, /runTodoistIngressBatch/);

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
  assert.deepEqual(config.vars, { TODOIST_PROJECT_ID: "6XGgm6PHrGgMpCFX" });
  assert.doesNotMatch(JSON.stringify(config), /TODOIST_API_TOKEN|DCC_USER_ID/);
});

test("CI dry-runs the Todoist Worker without embedding deployment secrets", () => {
  const packageJson = JSON.parse(text("../package.json")) as { scripts: Record<string, string> };
  const checkWorkflow = text("../.github/workflows/check.yml");

  assert.equal(packageJson.scripts["build:todoist"], "wrangler deploy --dry-run --config wrangler.todoist.jsonc");
  assert.equal(packageJson.scripts["deploy:todoist"], "wrangler deploy --config wrangler.todoist.jsonc");
  assert.match(checkWorkflow, /npm run build:todoist/);
  assert.doesNotMatch(text("../wrangler.todoist.jsonc"), /TODOIST_API_TOKEN|DCC_USER_ID/);
});

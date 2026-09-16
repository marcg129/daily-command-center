import type { D1Database } from "../lib/runtime/d1";
import { createTodoistApiClient } from "../lib/runtime/todoist-api";
import { runTodoistIngressBatch } from "../lib/runtime/todoist-ingress-runner";
import { createTodoistTaskIngressService } from "../lib/runtime/todoist-task-ingress-service";
import { D1TaskRepository } from "../lib/server/d1-task-repository";
import { D1UserWorkspaceResolver } from "../lib/server/d1-user-workspace-resolver";

type Env = Readonly<{
  DB: D1Database;
  TODOIST_API_TOKEN: string;
  TODOIST_PROJECT_ID: string;
  DCC_USER_ID: string;
}>;

type ScheduledController = Readonly<{
  scheduledTime: number;
  cron: string;
}>;

type ExecutionContext = Readonly<{
  waitUntil(promise: Promise<unknown>): void;
}>;

async function run(env: Env, scheduledTime: number) {
  const now = Number.isFinite(scheduledTime) && scheduledTime > 0
    ? new Date(scheduledTime)
    : new Date();
  const api = createTodoistApiClient({
    token: env.TODOIST_API_TOKEN,
    projectId: env.TODOIST_PROJECT_ID,
  });
  const repository = new D1TaskRepository(env.DB);
  const workspaceResolver = new D1UserWorkspaceResolver(env.DB, env.DCC_USER_ID);
  const importTask = createTodoistTaskIngressService({
    repository,
    clock: { now: () => now },
    workspaceResolver,
    relay: api,
  });

  const summary = await runTodoistIngressBatch(api, importTask);
  console.log("Todoist task ingress run", summary);
}

const todoistTaskIngress = {
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(run(env, controller.scheduledTime));
  },
};

export default todoistTaskIngress;

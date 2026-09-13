import type { D1Database } from "../lib/runtime/d1";
import { collectAndStoreHostedIntel } from "../lib/runtime/hosted-intel-collector";
import { D1CollectorSnapshotRepository } from "../lib/server/d1-collector-snapshot-repository";

type Env = Readonly<{
  DB: D1Database;
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
  await collectAndStoreHostedIntel(
    new D1CollectorSnapshotRepository(env.DB),
    { now },
  );
}

const hostedIntelCollector = {
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(run(env, controller.scheduledTime));
  },
};

export default hostedIntelCollector;

import { systemClock } from "@/lib/runtime/primitives";
import { getDatabase } from "@/lib/server/database";
import { LocalTaskMutationRepository } from "@/lib/server/local-task-mutation-repository";
import { createTaskHandlers } from "@/lib/server/task-service";

export const runtime = "nodejs";
const handlers = createTaskHandlers(new LocalTaskMutationRepository(getDatabase), systemClock);
export const GET = handlers.GET;

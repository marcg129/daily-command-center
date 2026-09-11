import { systemClock } from "@/lib/runtime/primitives";
import { createTaskCaptureHandler } from "@/lib/server/task-capture-service";
import { getDatabase } from "@/lib/server/database";
import { LocalTaskMutationRepository } from "@/lib/server/local-task-mutation-repository";

export const runtime = "nodejs";
export const POST = createTaskCaptureHandler(new LocalTaskMutationRepository(getDatabase), systemClock);

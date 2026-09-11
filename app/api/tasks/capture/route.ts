import { systemClock } from "@/lib/runtime/primitives";
import { createTaskCaptureHandler } from "@/lib/server/task-capture-service";
import { getDatabase } from "@/lib/server/database";
import { LocalTaskMutationRepository } from "@/lib/server/local-task-mutation-repository";
import { isLocalTaskCaptureEnabled } from "@/lib/server/local-task-capture-boundary";

export const runtime = "nodejs";

const localPOST = createTaskCaptureHandler(
  new LocalTaskMutationRepository(getDatabase),
  systemClock,
);

export async function POST(request: Request) {
  if (!isLocalTaskCaptureEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return localPOST(request);
}

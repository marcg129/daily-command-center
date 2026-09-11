import type { Clock } from "@/lib/runtime/primitives";
import {
  createStructuredTaskCaptureService,
  TaskCaptureConflictError,
  TaskCaptureValidationError,
} from "@/lib/runtime/task-capture";
import type { TaskMutationRepository } from "@/lib/runtime/task-mutations";

export function createTaskCaptureHandler(repository: TaskMutationRepository, clock: Clock) {
  const capture = createStructuredTaskCaptureService(repository, clock);
  return async function POST(request: Request) {
    let body: unknown;
    try { body = await request.json(); }
    catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    try {
      return Response.json(await capture(body));
    } catch (error) {
      if (error instanceof TaskCaptureValidationError)
        return Response.json({ error: error.message }, { status: 400 });
      if (error instanceof TaskCaptureConflictError)
        return Response.json({ error: error.message }, { status: 409 });
      return Response.json({ error: "Task capture could not be saved safely." }, { status: 500 });
    }
  };
}

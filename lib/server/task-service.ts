import type { Clock } from "@/lib/runtime/primitives";
import type { TaskMutation, TaskMutationRepository } from "@/lib/runtime/task-mutations";

export function createTaskHandlers(repository: TaskMutationRepository, clock: Clock) {
  return {
    async GET() {
      try { return Response.json({ tasks: await repository.read() }); }
      catch { return Response.json({ error: "Tasks could not be read safely." }, { status: 500 }); }
    },
    async POST(request: Request) {
      try {
        const body = await request.json() as { mutations?: TaskMutation[] };
        if (!body || !Array.isArray(body.mutations)) throw new Error("A mutation batch is required.");
        return Response.json({ tasks: await repository.apply(body.mutations, clock.now().toISOString()) });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Task mutations are invalid." }, { status: 400 });
      }
    },
  };
}

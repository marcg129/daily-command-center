import type { TaskMutationRepository } from "@/lib/runtime/task-mutations";
import type { WorkspaceStateResponse } from "@/lib/types";

/** The hosted bootstrap shape intentionally defers reminders and legacy browser import. */
export async function readHostedWorkspace(repository: TaskMutationRepository): Promise<WorkspaceStateResponse> {
  return {
    tasks: await repository.read(),
    reminders: [],
    initialized: true,
    legacyBrowserImportAllowed: false,
  };
}

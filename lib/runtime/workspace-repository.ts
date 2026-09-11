import type { WorkspaceState } from "@/lib/types";
import type { RequestContext } from "@/lib/runtime/context";

export interface WorkspaceRepository {
  read(context: RequestContext): Promise<WorkspaceState>;
  isInitialized(context: RequestContext): Promise<boolean>;
  write(context: RequestContext, state: WorkspaceState, now: string): Promise<WorkspaceState>;
}

import type { DatabaseSync } from "node:sqlite";
import { requireLegacyWorkspace, type RequestContext } from "@/lib/runtime/context";
import type { WorkspaceRepository } from "@/lib/runtime/workspace-repository";
import type { WorkspaceState } from "@/lib/types";
import { hasWorkspaceState, readWorkspaceState, writeWorkspaceState } from "@/lib/workspace-store";

export class LocalWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: () => DatabaseSync) {}

  async read(context: RequestContext) {
    requireLegacyWorkspace(context);
    return readWorkspaceState(this.database());
  }

  async isInitialized(context: RequestContext) {
    requireLegacyWorkspace(context);
    return hasWorkspaceState(this.database());
  }

  async write(context: RequestContext, state: WorkspaceState, now: string) {
    requireLegacyWorkspace(context);
    return writeWorkspaceState(this.database(), state, now);
  }
}

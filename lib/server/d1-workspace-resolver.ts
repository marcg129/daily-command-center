import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

export class D1WorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly database: D1Database) {}

  async resolve(
    principal: AuthenticatedPrincipal | null,
    requestedWorkspaceId: string,
  ): Promise<RequestContext> {
    if (!principal?.principalId) throw new Error("Authentication required.");
    if (!isProductWorkspaceId(requestedWorkspaceId)) throw new Error("Unknown workspace.");

    const grant = await this.database.prepare(
      `SELECT 1 AS allowed FROM principal_workspace_grants
       WHERE principal_id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(principal.principalId, requestedWorkspaceId).first<{ allowed: number }>();

    if (!grant) throw new Error("Workspace access denied.");
    return { workspaceId: requestedWorkspaceId };
  }
}

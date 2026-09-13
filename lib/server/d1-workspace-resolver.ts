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

    const membership = await this.database.prepare(
      `SELECT 1 AS allowed
       FROM user_principals p
       JOIN users u ON u.user_id = p.user_id
       JOIN workspace_memberships m ON m.user_id = u.user_id
       WHERE p.principal_id = ?
         AND u.status = 'ACTIVE'
         AND m.workspace_id = ?
         AND m.role IN ('OWNER', 'MEMBER')
       LIMIT 1`,
    ).bind(principal.principalId, requestedWorkspaceId).first<{ allowed: number }>();

    if (!membership) throw new Error("Workspace access denied.");
    return { workspaceId: requestedWorkspaceId };
  }
}

import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";

type MembershipRow = Readonly<{
  user_id: string;
  workspace_id: string;
  workspace_key: string;
}>;

export class D1WorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly database: D1Database) {}

  async resolve(
    principal: AuthenticatedPrincipal | null,
    requestedWorkspaceId: string,
  ): Promise<RequestContext> {
    if (!principal?.principalId) throw new Error("Authentication required.");
    if (!isProductWorkspaceId(requestedWorkspaceId)) throw new Error("Unknown workspace.");

    const membership = await this.database.prepare(
      `SELECT u.user_id, m.workspace_id, m.workspace_key
       FROM user_principals p
       JOIN users u ON u.user_id = p.user_id
       JOIN workspace_memberships m ON m.user_id = u.user_id
       WHERE p.principal_id = ?
         AND u.status = 'ACTIVE'
         AND m.workspace_key = ?
         AND m.role IN ('OWNER', 'MEMBER')
       LIMIT 2`,
    ).bind(principal.principalId, requestedWorkspaceId).all<MembershipRow>();

    if (!membership.success) throw new Error("Workspace lookup failed.");
    const rows = membership.results ?? [];
    if (rows.length !== 1 || rows[0].workspace_key !== requestedWorkspaceId) {
      throw new Error("Workspace access denied.");
    }
    return {
      userId: rows[0].user_id,
      workspaceId: rows[0].workspace_id,
      workspaceKey: requestedWorkspaceId,
    };
  }
}

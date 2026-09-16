import { isProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";

type MembershipRow = Readonly<{
  user_id: string;
  workspace_id: string;
  workspace_key: string;
}>;

export class D1UserWorkspaceResolver {
  private readonly userId: string;

  constructor(
    private readonly database: D1Database,
    userId: string,
  ) {
    const normalized = userId.trim();
    if (!normalized) throw new Error("DCC user ID is required.");
    this.userId = normalized;
  }

  async resolve(requestedWorkspaceId: string): Promise<RequestContext> {
    if (!isProductWorkspaceId(requestedWorkspaceId)) throw new Error("Unknown workspace.");

    const result = await this.database.prepare(
      `SELECT u.user_id, m.workspace_id, m.workspace_key
       FROM users u
       JOIN workspace_memberships m ON m.user_id = u.user_id
       WHERE u.user_id = ?
         AND u.status = 'ACTIVE'
         AND m.workspace_key = ?
         AND m.role IN ('OWNER', 'MEMBER')
       LIMIT 2`,
    ).bind(this.userId, requestedWorkspaceId).all<MembershipRow>();

    if (!result.success) throw new Error("Workspace lookup failed.");
    const rows = result.results ?? [];
    if (
      rows.length !== 1 ||
      rows[0].user_id !== this.userId ||
      rows[0].workspace_key !== requestedWorkspaceId
    ) {
      throw new Error("Workspace access denied.");
    }

    return {
      userId: rows[0].user_id,
      workspaceId: rows[0].workspace_id,
      workspaceKey: requestedWorkspaceId,
    };
  }
}

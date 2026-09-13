import {
  ApplicationUserAccessError,
  applicationUserId,
  isAuthorizedWorkspace,
  type ApplicationUserResolver,
  type AuthorizedWorkspace,
  type ResolvedApplicationUser,
} from "@/lib/runtime/application-user";
import type { D1Database } from "@/lib/runtime/d1";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";

type MembershipRow = Readonly<{
  user_id: string;
  workspace_id: string;
  display_name: string;
  workspace_type: string;
  theme_key: string;
  role: string;
}>;

export class D1ApplicationUserResolver implements ApplicationUserResolver {
  constructor(private readonly database: D1Database) {}

  async resolve(
    principal: AuthenticatedPrincipal,
  ): Promise<ResolvedApplicationUser> {
    if (!principal?.principalId) throw new ApplicationUserAccessError();

    const result = await this.database
      .prepare(
        `SELECT u.user_id,
              w.workspace_id,
              w.name AS display_name,
              w.workspace_type,
              w.theme_key,
              m.role
       FROM user_principals p
       JOIN users u ON u.user_id = p.user_id
       JOIN workspace_memberships m ON m.user_id = u.user_id
       JOIN workspaces w ON w.workspace_id = m.workspace_id
       WHERE p.principal_id = ?
         AND u.status = 'ACTIVE'
         AND m.role IN ('OWNER', 'MEMBER')
       ORDER BY CASE w.workspace_id WHEN 'personal' THEN 0 WHEN 'indelitech' THEN 1 ELSE 2 END,
                w.name,
                w.workspace_id`,
      )
      .bind(principal.principalId)
      .all<MembershipRow>();

    if (!result.success) throw new Error("Application user lookup failed.");
    const rows = result.results ?? [];
    if (rows.length === 0) throw new ApplicationUserAccessError();

    const userIds = new Set(rows.map((row) => row.user_id));
    if (userIds.size !== 1) throw new ApplicationUserAccessError();

    const workspaces = rows
      .map((row) => ({
        workspaceId: row.workspace_id,
        displayName: row.display_name,
        workspaceType: row.workspace_type,
        themeKey: row.theme_key,
        role: row.role,
      }))
      .filter(isAuthorizedWorkspace) as AuthorizedWorkspace[];

    if (workspaces.length === 0) throw new ApplicationUserAccessError();
    return {
      userId: applicationUserId(rows[0].user_id),
      workspaces,
    };
  }
}

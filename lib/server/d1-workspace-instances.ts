import {
  isProductWorkspaceId,
  requireHostedContext,
  type ProductWorkspaceId,
  type RequestContext,
} from "@/lib/runtime/context";
import type { D1Database } from "@/lib/runtime/d1";

type WorkspaceInstanceRow = Readonly<{
  workspace_key: string;
  workspace_id: string;
}>;

export type WorkspaceInstanceContext = Readonly<{
  userId: string | null;
  workspaceId: string;
  workspaceKey: ProductWorkspaceId;
}>;

/**
 * Normalizes the context without exposing physical IDs to the browser/task model.
 * Contexts without userId/workspaceKey are retained only for local/unit-test
 * compatibility; authenticated hosted routes always receive the enriched form from
 * D1WorkspaceResolver.
 */
export function workspaceInstanceContext(context: RequestContext): WorkspaceInstanceContext {
  const workspaceKey = requireHostedContext(context);
  const hasUser = typeof context.userId === "string" && context.userId.length > 0;
  const hasKey = context.workspaceKey !== undefined;
  if (hasUser !== hasKey) throw new Error("Workspace access denied.");
  if (!hasUser) {
    return { userId: null, workspaceId: workspaceKey, workspaceKey };
  }
  return {
    userId: context.userId!,
    workspaceId: context.workspaceId,
    workspaceKey,
  };
}

/** Resolve user-facing workspace slots to this user's exact physical D1 rows. */
export async function resolveAuthorizedWorkspaceInstances(
  database: D1Database,
  context: RequestContext,
  workspaceKeys: readonly ProductWorkspaceId[],
): Promise<ReadonlyMap<ProductWorkspaceId, string>> {
  const current = workspaceInstanceContext(context);
  const requested = [...new Set(workspaceKeys)];
  if (requested.length === 0) return new Map();

  for (const key of requested) {
    if (!isProductWorkspaceId(key)) throw new Error("Unknown workspace.");
  }

  // Transitional internal/test contexts keep the historical 1:1 mapping. Public
  // hosted handlers do not construct this form.
  if (current.userId === null) {
    return new Map(requested.map((key) => [key, key] as const));
  }

  const placeholders = requested.map(() => "?").join(", ");
  const result = await database.prepare(
    `SELECT m.workspace_key, m.workspace_id
     FROM workspace_memberships m
     JOIN users u ON u.user_id = m.user_id
     WHERE m.user_id = ?
       AND u.status = 'ACTIVE'
       AND m.role IN ('OWNER', 'MEMBER')
       AND m.workspace_key IN (${placeholders})`,
  ).bind(current.userId, ...requested).all<WorkspaceInstanceRow>();
  if (!result.success) throw new Error("Workspace lookup failed.");

  const resolved = new Map<ProductWorkspaceId, string>();
  for (const row of result.results ?? []) {
    if (!isProductWorkspaceId(row.workspace_key)) continue;
    if (resolved.has(row.workspace_key)) throw new Error("Workspace access denied.");
    resolved.set(row.workspace_key, row.workspace_id);
  }

  if (resolved.size !== requested.length || resolved.get(current.workspaceKey) !== current.workspaceId) {
    throw new Error("Workspace access denied.");
  }
  return resolved;
}

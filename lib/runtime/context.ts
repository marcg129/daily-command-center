export const PERSONAL_WORKSPACE_ID = "personal" as const;
export const INDELITECH_WORKSPACE_ID = "indelitech" as const;
export const LEGACY_WORKSPACE_ID = "legacy-local";
export const PRODUCT_WORKSPACE_IDS = [PERSONAL_WORKSPACE_ID, INDELITECH_WORKSPACE_ID] as const;
export type ProductWorkspaceId = (typeof PRODUCT_WORKSPACE_IDS)[number];
export type WorkspaceId = ProductWorkspaceId | typeof LEGACY_WORKSPACE_ID;

/**
 * workspaceId is the exact persistence boundary. In local mode it is the legacy
 * workspace ID. In hosted mode it may be a per-user physical workspace instance.
 * workspaceKey is the stable user-facing slot (currently Personal or Indelitech).
 */
export type RequestContext = Readonly<{
  workspaceId: string;
  workspaceKey?: ProductWorkspaceId;
  userId?: string;
}>;

export type HostedWorkspaceInstanceContext = Readonly<{
  workspaceId: string;
  workspaceKey: ProductWorkspaceId;
  userId: string;
}>;

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return value === PERSONAL_WORKSPACE_ID || value === INDELITECH_WORKSPACE_ID || value === LEGACY_WORKSPACE_ID;
}

export function isProductWorkspaceId(value: unknown): value is ProductWorkspaceId {
  return value === PERSONAL_WORKSPACE_ID || value === INDELITECH_WORKSPACE_ID;
}

/** V1 task sharing policy, shared by hosted persistence and the local task UI. */
export function taskVisibleInWorkspace(
  primaryWorkspaceId: ProductWorkspaceId,
  viewingWorkspaceId: ProductWorkspaceId,
) {
  return primaryWorkspaceId === viewingWorkspaceId ||
    (primaryWorkspaceId === INDELITECH_WORKSPACE_ID && viewingWorkspaceId === PERSONAL_WORKSPACE_ID);
}

export function requireRequestContext(context: RequestContext | null | undefined): asserts context is RequestContext {
  if (!context || typeof context.workspaceId !== "string" || context.workspaceId.trim().length === 0 || context.workspaceId.length > 128) {
    throw new Error("A valid workspace context is required.");
  }
  if (context.workspaceKey !== undefined && !isProductWorkspaceId(context.workspaceKey)) {
    throw new Error("A valid workspace context is required.");
  }
}

/**
 * Returns the logical hosted product slot. Legacy/unit-test contexts where the
 * physical ID is still the product ID remain supported during the transition.
 */
export function requireHostedContext(context: RequestContext | null | undefined): ProductWorkspaceId {
  requireRequestContext(context);
  if (context.workspaceKey !== undefined) return context.workspaceKey;
  if (!isProductWorkspaceId(context.workspaceId)) throw new Error("A hosted product workspace context is required.");
  return context.workspaceId;
}

/** Requires the authenticated hosted form used by production D1 routes. */
export function requireHostedWorkspaceInstance(
  context: RequestContext | null | undefined,
): HostedWorkspaceInstanceContext {
  const workspaceKey = requireHostedContext(context);
  if (!context?.userId || context.userId.trim().length < 3 || context.userId.length > 160 || context.workspaceKey === undefined) {
    throw new Error("An authenticated hosted workspace instance is required.");
  }
  return {
    workspaceId: context.workspaceId,
    workspaceKey,
    userId: context.userId,
  };
}

export function legacyRequestContext(): RequestContext {
  return { workspaceId: LEGACY_WORKSPACE_ID };
}

export function requireLegacyWorkspace(context: RequestContext) {
  if (context.workspaceId !== LEGACY_WORKSPACE_ID) {
    throw new Error(`The local adapter cannot access workspace ${context.workspaceId}.`);
  }
}

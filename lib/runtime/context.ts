export type RequestContext = Readonly<{
  workspaceId: string;
}>;

export const PERSONAL_WORKSPACE_ID = "personal" as const;
export const INDELITECH_WORKSPACE_ID = "indelitech" as const;
export const LEGACY_WORKSPACE_ID = "legacy-local";
export const PRODUCT_WORKSPACE_IDS = [PERSONAL_WORKSPACE_ID, INDELITECH_WORKSPACE_ID] as const;
export type ProductWorkspaceId = (typeof PRODUCT_WORKSPACE_IDS)[number];
export type WorkspaceId = ProductWorkspaceId | typeof LEGACY_WORKSPACE_ID;

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
  if (!context || !isWorkspaceId(context.workspaceId)) throw new Error("A valid workspace context is required.");
}

export function requireHostedContext(context: RequestContext | null | undefined): ProductWorkspaceId {
  requireRequestContext(context);
  if (!isProductWorkspaceId(context.workspaceId)) throw new Error("A hosted product workspace context is required.");
  return context.workspaceId;
}

export function legacyRequestContext(): RequestContext {
  return { workspaceId: LEGACY_WORKSPACE_ID };
}

export function requireLegacyWorkspace(context: RequestContext) {
  if (context.workspaceId !== LEGACY_WORKSPACE_ID) {
    throw new Error(`The local adapter cannot access workspace ${context.workspaceId}.`);
  }
}

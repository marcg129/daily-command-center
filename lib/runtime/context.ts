export type RequestContext = Readonly<{
  workspaceId: string;
}>;

export const LEGACY_WORKSPACE_ID = "legacy-local";

export function legacyRequestContext(): RequestContext {
  return { workspaceId: LEGACY_WORKSPACE_ID };
}

export function requireLegacyWorkspace(context: RequestContext) {
  if (context.workspaceId !== LEGACY_WORKSPACE_ID) {
    throw new Error(`The local adapter cannot access workspace ${context.workspaceId}.`);
  }
}

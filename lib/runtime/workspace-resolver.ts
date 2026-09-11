import { isProductWorkspaceId, type ProductWorkspaceId, type RequestContext } from "@/lib/runtime/context";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";

export type { AuthenticatedPrincipal } from "@/lib/runtime/session";

export interface WorkspaceResolver {
  resolve(principal: AuthenticatedPrincipal | null, requestedWorkspaceId: string): Promise<RequestContext>;
}

/** Test-only authorization boundary. Production authentication is deliberately not implemented. */
export class FakeWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly grants: ReadonlyMap<string, ReadonlySet<ProductWorkspaceId>>) {}

  async resolve(principal: AuthenticatedPrincipal | null, requestedWorkspaceId: string): Promise<RequestContext> {
    if (!principal?.principalId) throw new Error("Authentication required.");
    if (!isProductWorkspaceId(requestedWorkspaceId)) throw new Error("Unknown workspace.");
    if (!this.grants.get(principal.principalId)?.has(requestedWorkspaceId)) throw new Error("Workspace access denied.");
    return { workspaceId: requestedWorkspaceId };
  }
}

import {
  isProductWorkspaceId,
  type ProductWorkspaceId,
} from "@/lib/runtime/context";
import type { AuthenticatedPrincipal } from "@/lib/runtime/session";

export type ApplicationUserId = string & {
  readonly __applicationUserId: unique symbol;
};

export type WorkspaceMembershipRole = "OWNER" | "MEMBER";

export type AuthorizedWorkspace = Readonly<{
  workspaceId: ProductWorkspaceId;
  displayName: string;
  workspaceType: "PERSONAL" | "BUSINESS";
  themeKey: string;
  role: WorkspaceMembershipRole;
}>;

export type ResolvedApplicationUser = Readonly<{
  userId: ApplicationUserId;
  workspaces: readonly AuthorizedWorkspace[];
}>;

export interface ApplicationUserResolver {
  resolve(principal: AuthenticatedPrincipal): Promise<ResolvedApplicationUser>;
}

export class ApplicationUserAccessError extends Error {
  constructor() {
    super("Application user access denied.");
    this.name = "ApplicationUserAccessError";
  }
}

export function applicationUserId(value: string): ApplicationUserId {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 160) {
    throw new Error("Application user ID is invalid.");
  }
  return normalized as ApplicationUserId;
}

export function isAuthorizedWorkspace(
  value: unknown,
): value is AuthorizedWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isProductWorkspaceId(candidate.workspaceId) &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.trim().length > 0 &&
    (candidate.workspaceType === "PERSONAL" ||
      candidate.workspaceType === "BUSINESS") &&
    typeof candidate.themeKey === "string" &&
    candidate.themeKey.trim().length > 0 &&
    (candidate.role === "OWNER" || candidate.role === "MEMBER")
  );
}

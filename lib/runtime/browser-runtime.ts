import type { ProductWorkspaceId } from "./context";
import {
  applicationUserId,
  isAuthorizedWorkspace,
  type AuthorizedWorkspace,
} from "./application-user";
import type { PublicSettings, WorkspaceStateResponse } from "../types";

export type BrowserRuntimeMode = "local" | "hosted";
export type BrowserFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;
export type HostedApplicationSession = Readonly<{
  userId: ReturnType<typeof applicationUserId>;
  workspaces: readonly AuthorizedWorkspace[];
  expiresAt: string;
}>;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHostname(hostname: string) {
  return LOOPBACK_HOSTNAMES.has(hostname.trim().toLowerCase());
}

export function browserRuntimeMode(hostname: string): BrowserRuntimeMode {
  return isLoopbackHostname(hostname) ? "local" : "hosted";
}

export function hostedWorkspaceEndpoint(workspaceId: ProductWorkspaceId) {
  return `/api/hosted/workspace?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function taskMutationEndpoint(
  mode: BrowserRuntimeMode,
  workspaceId: ProductWorkspaceId,
) {
  return mode === "local"
    ? "/api/tasks/mutations"
    : `/api/hosted/tasks/mutations?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export async function loadHostedApplicationSession(
  fetcher: BrowserFetch,
): Promise<HostedApplicationSession> {
  let response = await fetcher("/api/hosted/session", { cache: "no-store" });

  // AuthKit access tokens are intentionally short-lived. If the browser still
  // has a rotating refresh cookie, recover the product session once before
  // surfacing an identity failure. Cloudflare-only sessions simply receive a
  // failed refresh and preserve the original behavior.
  if (response.status === 403) {
    const refresh = await fetcher("/api/auth/workos/refresh", {
      method: "POST",
      cache: "no-store",
    });
    if (refresh.ok) {
      response = await fetcher("/api/hosted/session", { cache: "no-store" });
    }
  }

  if (!response.ok)
    throw new Error("Your Command Center identity could not be resolved.");
  const value = (await response.json()) as Record<string, unknown>;
  if (
    typeof value.userId !== "string" ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length === 0 ||
    !value.workspaces.every(isAuthorizedWorkspace) ||
    typeof value.expiresAt !== "string"
  ) {
    throw new Error("Your Command Center identity response was invalid.");
  }
  return {
    userId: applicationUserId(value.userId),
    workspaces: value.workspaces,
    expiresAt: value.expiresAt,
  };
}

export function selectAuthorizedWorkspace(
  workspaces: readonly AuthorizedWorkspace[],
  preferred: unknown,
): ProductWorkspaceId {
  const workspaceIds = workspaces.map(({ workspaceId }) => workspaceId);
  if (
    typeof preferred === "string" &&
    workspaceIds.includes(preferred as ProductWorkspaceId)
  ) {
    return preferred as ProductWorkspaceId;
  }
  const personal = workspaceIds.find(
    (workspaceId) => workspaceId === "personal",
  );
  return personal ?? workspaceIds[0];
}

export async function loadBrowserWorkspace(
  fetcher: BrowserFetch,
  mode: BrowserRuntimeMode,
  workspaceId: ProductWorkspaceId,
): Promise<{ settings?: PublicSettings; workspace: WorkspaceStateResponse }> {
  if (mode === "hosted") {
    const response = await fetcher(hostedWorkspaceEndpoint(workspaceId), {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Hosted tasks could not be read. No local data was used.",
      );
    return { workspace: (await response.json()) as WorkspaceStateResponse };
  }

  const [settingsResponse, workspaceResponse] = await Promise.all([
    fetcher("/api/settings", { cache: "no-store" }),
    fetcher("/api/workspace", { cache: "no-store" }),
  ]);
  if (!settingsResponse.ok)
    throw new Error(
      "Settings could not be read. Your saved configuration was not changed.",
    );
  if (!workspaceResponse.ok)
    throw new Error(
      "Tasks and reminders could not be read. Your saved workspace was not changed.",
    );
  return {
    settings: (await settingsResponse.json()) as PublicSettings,
    workspace: (await workspaceResponse.json()) as WorkspaceStateResponse,
  };
}

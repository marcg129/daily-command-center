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

let productRefreshInFlight: Promise<boolean> | null = null;

async function refreshProductSession(fetcher: BrowserFetch): Promise<boolean> {
  if (!productRefreshInFlight) {
    productRefreshInFlight = (async () => {
      try {
        const response = await fetcher("/api/auth/workos/refresh", {
          method: "POST",
          cache: "no-store",
        });
        return response.ok;
      } catch {
        return false;
      }
    })().finally(() => {
      productRefreshInFlight = null;
    });
  }
  return productRefreshInFlight;
}

/**
 * Browser fetch for DCC-hosted protected APIs.
 *
 * AuthKit uses short-lived access tokens plus rotating refresh tokens. A 403
 * may mean the product access cookie expired, so perform one same-document
 * serialized refresh and retry once. Separate browser tabs can still race; the
 * refresh endpoint therefore never clears cookies on a terminal refresh failure,
 * and a failed refresher probes the protected request once more in case another
 * tab already installed the rotated session.
 */
export async function fetchHostedWithSessionRefresh(
  fetcher: BrowserFetch,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetcher(input, init);
  if (response.status !== 403) return response;

  const refreshed = await refreshProductSession(fetcher);
  if (refreshed) return fetcher(input, init);

  // A failed refresh can be the stale loser of a cross-tab rotation. Because
  // cookies are browser-wide, retry the protected request once before surfacing
  // the original 403. If another tab won the rotation, this observes its new
  // access cookie without issuing another refresh request.
  try {
    const retry = await fetcher(input, init);
    return retry.status === 403 ? response : retry;
  } catch {
    return response;
  }
}

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
  const response = await fetchHostedWithSessionRefresh(
    fetcher,
    "/api/hosted/session",
    { cache: "no-store" },
  );

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
    const response = await fetchHostedWithSessionRefresh(
      fetcher,
      hostedWorkspaceEndpoint(workspaceId),
      { cache: "no-store" },
    );
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

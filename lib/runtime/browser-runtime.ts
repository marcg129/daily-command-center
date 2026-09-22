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

const PRODUCT_REFRESH_LOCK = "dcc-workos-refresh";
export const WORKOS_ACCEPTANCE_SESSION_KEY = "dcc-workos-acceptance-provider";
const WORKOS_ACCEPTANCE_HEADER = "x-dcc-auth-provider";

export function applyHostedAcceptanceAuth(
  init?: RequestInit,
  provider: "workos" | null = selectedHostedAcceptanceProvider(),
): RequestInit | undefined {
  if (provider !== "workos") return init;
  const headers = new Headers(init?.headers);
  headers.set(WORKOS_ACCEPTANCE_HEADER, "workos");
  return { ...init, headers };
}

function selectedHostedAcceptanceProvider(): "workos" | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(WORKOS_ACCEPTANCE_SESSION_KEY) === "workos"
      ? "workos"
      : null;
  } catch {
    return null;
  }
}

async function withProductRefreshLock<T>(
  task: () => Promise<T>,
): Promise<T | null> {
  const browser = typeof window !== "undefined";
  const manager =
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks
      : null;

  // Product browsers must have an origin-wide lock before rotating a single-use
  // refresh token. If a browser lacks Web Locks, fail closed instead of falling
  // back to tab-local coordination. Non-browser tests/server evaluation can use
  // the direct path because there is no cross-tab cookie race there.
  if (browser && !manager) return null;
  return manager
    ? manager.request(PRODUCT_REFRESH_LOCK, task)
    : task();
}

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
 * may mean the product access cookie expired. Recovery is serialized behind one
 * same-origin Web Lock, so separate tabs cannot rotate the same refresh token at
 * the same time. After acquiring the lock, re-check the protected request first:
 * a tab that waited for another tab's successful rotation observes the new
 * browser-wide cookies and skips its own refresh.
 */
export async function fetchHostedWithSessionRefresh(
  fetcher: BrowserFetch,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const protectedInit = applyHostedAcceptanceAuth(init);
  const response = await fetcher(input, protectedInit);
  if (response.status !== 403) return response;

  const recovered = await withProductRefreshLock(async () => {
    // A different tab may have refreshed while this caller waited for the lock.
    // Re-check before rotating a single-use refresh token.
    try {
      const recheck = await fetcher(input, protectedInit);
      if (recheck.status !== 403) return recheck;
    } catch {
      return response;
    }

    const refreshed = await refreshProductSession(fetcher);
    if (!refreshed) return response;
    return fetcher(input, protectedInit);
  });
  return recovered ?? response;
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

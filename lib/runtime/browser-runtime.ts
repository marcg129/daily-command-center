import type { ProductWorkspaceId } from "./context";
import type { PublicSettings, WorkspaceStateResponse } from "../types";

export type BrowserRuntimeMode = "local" | "hosted";
export type BrowserFetch = (input: string, init?: RequestInit) => Promise<Response>;

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

export function taskMutationEndpoint(mode: BrowserRuntimeMode, workspaceId: ProductWorkspaceId) {
  return mode === "local"
    ? "/api/tasks/mutations"
    : `/api/hosted/tasks/mutations?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export async function loadBrowserWorkspace(
  fetcher: BrowserFetch,
  mode: BrowserRuntimeMode,
  workspaceId: ProductWorkspaceId,
): Promise<{ settings?: PublicSettings; workspace: WorkspaceStateResponse }> {
  if (mode === "hosted") {
    const response = await fetcher(hostedWorkspaceEndpoint(workspaceId), { cache: "no-store" });
    if (!response.ok) throw new Error("Hosted tasks could not be read. No local data was used.");
    return { workspace: await response.json() as WorkspaceStateResponse };
  }

  const [settingsResponse, workspaceResponse] = await Promise.all([
    fetcher("/api/settings", { cache: "no-store" }),
    fetcher("/api/workspace", { cache: "no-store" }),
  ]);
  if (!settingsResponse.ok)
    throw new Error("Settings could not be read. Your saved configuration was not changed.");
  if (!workspaceResponse.ok)
    throw new Error("Tasks and reminders could not be read. Your saved workspace was not changed.");
  return {
    settings: await settingsResponse.json() as PublicSettings,
    workspace: await workspaceResponse.json() as WorkspaceStateResponse,
  };
}

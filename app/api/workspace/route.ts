import { legacyRequestContext } from "@/lib/runtime/context";
import { systemClock, webIdGenerator } from "@/lib/runtime/primitives";
import { LocalWorkspaceRepository } from "@/lib/server/local-workspace-repository";
import { getDatabase } from "@/lib/server/database";
import { legacyBrowserImportAllowed } from "@/lib/server/settings";
import { createWorkspaceHandlers } from "@/lib/server/workspace-service";

export const runtime = "nodejs";

const handlers = createWorkspaceHandlers({
  repository: new LocalWorkspaceRepository(getDatabase),
  context: legacyRequestContext,
  clock: systemClock,
  ids: webIdGenerator,
  legacyImportAllowed: legacyBrowserImportAllowed,
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;

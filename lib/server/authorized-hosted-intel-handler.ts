import { INDELITECH_WORKSPACE_ID, type RequestContext } from "@/lib/runtime/context";
import type { CollectorSnapshotRepository } from "@/lib/runtime/collector-snapshot-repository";
import { hostedIntelSnapshotResponse } from "@/lib/runtime/hosted-intel";
import type { Clock } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";
import { readRequestSessionIdentity } from "@/lib/server/request-session-identity";
import type { WorkspaceResolver } from "@/lib/runtime/workspace-resolver";
import type { LiveFeedResponse } from "@/lib/types";


function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

type AuthorizationResult =
  | { authorized: true; context: RequestContext }
  | { authorized: false; response: Response };

async function authorize(
  request: Request,
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  clock: Clock,
): Promise<AuthorizationResult> {
  const sessionIdentity = readRequestSessionIdentity(request);
  if (!sessionIdentity) return { authorized: false, response: errorResponse("Authentication required.", 403) };

  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (workspaceId !== INDELITECH_WORKSPACE_ID) {
    return { authorized: false, response: errorResponse("workspaceId must be indelitech.", 400) };
  }

  const session = await sessionProvider.getSession(sessionIdentity);
  const principal = requireAuthenticatedSession(session, clock.now());
  const context = await workspaceResolver.resolve(principal, workspaceId);
  return { authorized: true, context };
}

/**
 * Read-only hosted Intel boundary. Authentication and the exact Indelitech
 * workspace grant are resolved before any collector snapshot is read.
 */
export function createAuthorizedHostedIntelHandler(
  sessionProvider: SessionProvider,
  workspaceResolver: WorkspaceResolver,
  snapshots: CollectorSnapshotRepository,
  clock: Clock,
) {
  return {
    async GET(request: Request) {
      try {
        const authorization = await authorize(request, sessionProvider, workspaceResolver, clock);
        if (!authorization.authorized) return authorization.response;
        const snapshot = await snapshots.read<LiveFeedResponse>(
          authorization.context,
          "industry",
        );
        return Response.json(hostedIntelSnapshotResponse(snapshot, clock.now()));
      } catch (error) {
        if (error instanceof Error && error.message === "Authentication required.") {
          return errorResponse("Authentication required.", 403);
        }
        if (error instanceof Error && error.message === "Workspace access denied.") {
          return errorResponse("Workspace access denied.", 403);
        }
        return errorResponse("Hosted Intel could not be read safely.", 500);
      }
    },
  };
}

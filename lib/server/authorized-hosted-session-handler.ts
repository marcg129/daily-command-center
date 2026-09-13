import type { Clock } from "@/lib/runtime/primitives";
import {
  ApplicationUserAccessError,
  type ApplicationUserResolver,
} from "@/lib/runtime/application-user";
import {
  requireAuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

/**
 * Resolves a verified Cloudflare Access principal to a durable active
 * application user and returns only that user's supported workspace memberships.
 * It never returns the assertion, session ID, or identity-provider attributes.
 */
export function createAuthorizedHostedSessionHandler(
  sessionProvider: SessionProvider,
  applicationUsers: ApplicationUserResolver,
  clock: Clock,
) {
  return {
    async GET(request: Request) {
      try {
        const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
        if (!assertion) return errorResponse("Authentication required.", 403);
        const session = await sessionProvider.getSession(assertion);
        const principal = requireAuthenticatedSession(session, clock.now());
        const applicationUser = await applicationUsers.resolve(principal);
        return Response.json({
          userId: applicationUser.userId,
          workspaces: applicationUser.workspaces,
          expiresAt: session!.expiresAt,
        });
      } catch (error) {
        if (
          error instanceof ApplicationUserAccessError ||
          (error instanceof Error &&
            error.message === "Authentication required.")
        ) {
          return errorResponse("Authentication required.", 403);
        }
        return errorResponse("Hosted session could not be read safely.", 500);
      }
    },
  };
}

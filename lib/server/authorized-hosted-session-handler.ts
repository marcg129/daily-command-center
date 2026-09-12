import type { Clock } from "@/lib/runtime/primitives";
import { requireAuthenticatedSession, type SessionProvider } from "@/lib/runtime/session";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

/**
 * Returns only the stable principal derived from a cryptographically verified
 * Cloudflare Access application assertion. It grants no workspace access and
 * never returns the assertion, session ID, or identity-provider attributes.
 */
export function createAuthorizedHostedSessionHandler(
  sessionProvider: SessionProvider,
  clock: Clock,
) {
  return {
    async GET(request: Request) {
      try {
        const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
        if (!assertion) return errorResponse("Authentication required.", 403);
        const session = await sessionProvider.getSession(assertion);
        const principal = requireAuthenticatedSession(session, clock.now());
        return Response.json({
          principalId: principal.principalId,
          expiresAt: session!.expiresAt,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Authentication required.") {
          return errorResponse("Authentication required.", 403);
        }
        return errorResponse("Hosted session could not be read safely.", 500);
      }
    },
  };
}

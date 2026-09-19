import {
  ApplicationUserAccessError,
  type ApplicationUserResolver,
} from "@/lib/runtime/application-user";
import type { Clock } from "@/lib/runtime/primitives";
import {
  requireAuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";
import {
  ApplicationPrincipalLinkError,
  type ApplicationPrincipalLinker,
} from "@/lib/server/d1-application-principal-linker";
import { readWorkOSAccessCookie } from "@/lib/server/workos-browser-auth";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";

function denied() {
  return Response.json({ error: "Identity link denied." }, {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createAuthorizedWorkOSPrincipalLinkHandler(
  cloudflareSessions: SessionProvider,
  workosSessions: SessionProvider,
  applicationUsers: ApplicationUserResolver,
  principalLinker: ApplicationPrincipalLinker,
  clock: Clock,
) {
  return {
    async POST(request: Request): Promise<Response> {
      try {
        const accessAssertion = request.headers
          .get(ACCESS_ASSERTION_HEADER)
          ?.trim();
        const workosAccessToken = readWorkOSAccessCookie(request);

        if (!accessAssertion || !workosAccessToken) return denied();

        const [cloudflareSession, workosSession] = await Promise.all([
          cloudflareSessions.getSession(accessAssertion),
          workosSessions.getSession(`product-bearer:${workosAccessToken}`),
        ]);

        const cloudflarePrincipal = requireAuthenticatedSession(
          cloudflareSession,
          clock.now(),
        );
        const workosPrincipal = requireAuthenticatedSession(
          workosSession,
          clock.now(),
        );

        if (
          !cloudflarePrincipal.principalId.startsWith("cf-user:") ||
          !workosPrincipal.principalId.startsWith("workos-user:")
        ) {
          return denied();
        }

        // Resolve only the already-established Cloudflare identity. There is
        // intentionally no auto-provisioner in this linking path.
        const existingUser = await applicationUsers.resolve(cloudflarePrincipal);

        await principalLinker.link({
          userId: existingUser.userId,
          principalId: workosPrincipal.principalId,
          provider: "WORKOS_AUTHKIT",
        });

        const linkedUser = await applicationUsers.resolve(workosPrincipal);
        if (linkedUser.userId !== existingUser.userId) {
          throw new ApplicationPrincipalLinkError();
        }

        return Response.json({
          linked: true,
          userId: linkedUser.userId,
          workspaces: linkedUser.workspaces,
        }, {
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (
          error instanceof ApplicationUserAccessError ||
          error instanceof ApplicationPrincipalLinkError ||
          (error instanceof Error && error.message === "Authentication required.")
        ) {
          return denied();
        }
        return Response.json(
          { error: "Identity link could not be completed safely." },
          { status: 500, headers: { "Cache-Control": "no-store" } },
        );
      }
    },
  };
}

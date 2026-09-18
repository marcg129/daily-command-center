import type { JWTVerifyGetKey } from "jose";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedSessionHandler } from "@/lib/server/authorized-hosted-session-handler";
import { createHostedAuthenticationSessionProvider } from "@/lib/server/hosted-authentication-runtime";
import { D1ApplicationUserResolver } from "@/lib/server/d1-application-user-resolver";
import { AutoProvisioningApplicationUserResolver, D1ApplicationUserProvisioner } from "@/lib/server/d1-application-user-provisioner";
import type { HostedTaskRouteBindings } from "@/lib/server/hosted-task-route-runtime";

export function createHostedSessionRouteRuntime(
  bindings: HostedTaskRouteBindings,
  options: {
    clock?: Clock;
    accessKeyResolver?: JWTVerifyGetKey;
    workosKeyResolver?: JWTVerifyGetKey;
  } = {},
) {
  if (!bindings?.DB || !bindings.TEAM_DOMAIN || !bindings.POLICY_AUD) {
    throw new Error("Cloudflare Access bindings are required.");
  }
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedSessionHandler(
    createHostedAuthenticationSessionProvider(bindings, clock, {
      accessKeyResolver: options.accessKeyResolver,
      workosKeyResolver: options.workosKeyResolver,
    }),
    new AutoProvisioningApplicationUserResolver(
      new D1ApplicationUserResolver(bindings.DB),
      new D1ApplicationUserProvisioner(bindings.DB),
      (principal) => {
        if (principal.principalId.startsWith("cf-user:")) {
          return "CLOUDFLARE_ACCESS";
        }
        if (principal.principalId.startsWith("workos-user:")) {
          return "WORKOS_AUTHKIT";
        }
        return null;
      },
      (principal) =>
        principal.principalId.startsWith("cf-user:") ||
        principal.principalId.startsWith("workos-user:"),
    ),
    clock,
  );
}

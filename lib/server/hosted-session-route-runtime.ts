import type { JWTVerifyGetKey } from "jose";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { createAuthorizedHostedSessionHandler } from "@/lib/server/authorized-hosted-session-handler";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { D1ApplicationUserResolver } from "@/lib/server/d1-application-user-resolver";
import type { HostedTaskRouteBindings } from "@/lib/server/hosted-task-route-runtime";

export function createHostedSessionRouteRuntime(
  bindings: HostedTaskRouteBindings,
  options: { clock?: Clock; accessKeyResolver?: JWTVerifyGetKey } = {},
) {
  if (!bindings?.DB || !bindings.TEAM_DOMAIN || !bindings.POLICY_AUD) {
    throw new Error("Cloudflare Access bindings are required.");
  }
  const clock = options.clock ?? systemClock;
  return createAuthorizedHostedSessionHandler(
    new CloudflareAccessSessionProvider({
      teamDomain: bindings.TEAM_DOMAIN,
      audience: bindings.POLICY_AUD,
      clock,
      keyResolver: options.accessKeyResolver,
    }),
    new D1ApplicationUserResolver(bindings.DB),
    clock,
  );
}

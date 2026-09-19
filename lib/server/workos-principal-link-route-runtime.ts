import type { JWTVerifyGetKey } from "jose";
import { systemClock, type Clock } from "@/lib/runtime/primitives";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { D1ApplicationPrincipalLinker } from "@/lib/server/d1-application-principal-linker";
import { D1ApplicationUserResolver } from "@/lib/server/d1-application-user-resolver";
import { createAuthorizedWorkOSPrincipalLinkHandler } from "@/lib/server/authorized-workos-principal-link-handler";
import type { HostedTaskRouteBindings } from "@/lib/server/hosted-task-route-runtime";
import { WorkOSAccessSessionProvider } from "@/lib/server/workos-access-session-provider";

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createWorkOSPrincipalLinkRouteRuntime(
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

  const clientId = required(bindings.WORKOS_CLIENT_ID, "WORKOS_CLIENT_ID");
  const issuer = required(bindings.WORKOS_ISSUER, "WORKOS_ISSUER");
  const jwksUrl = required(bindings.WORKOS_JWKS_URL, "WORKOS_JWKS_URL");
  const clock = options.clock ?? systemClock;

  return createAuthorizedWorkOSPrincipalLinkHandler(
    new CloudflareAccessSessionProvider({
      teamDomain: bindings.TEAM_DOMAIN,
      audience: bindings.POLICY_AUD,
      clock,
      keyResolver: options.accessKeyResolver,
    }),
    new WorkOSAccessSessionProvider({
      clientId,
      issuer,
      jwksUrl,
      clock,
      keyResolver: options.workosKeyResolver,
    }),
    new D1ApplicationUserResolver(bindings.DB),
    new D1ApplicationPrincipalLinker(bindings.DB),
    clock,
  );
}

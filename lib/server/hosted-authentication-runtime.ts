import type { JWTVerifyGetKey } from "jose";
import type { Clock } from "@/lib/runtime/primitives";
import type { SessionProvider } from "@/lib/runtime/session";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";
import { MigrationSessionProvider } from "@/lib/server/migration-session-provider";
import { WorkOSAccessSessionProvider } from "@/lib/server/workos-access-session-provider";

export type HostedAuthenticationBindings = Readonly<{
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_ISSUER?: string;
  WORKOS_JWKS_URL?: string;
}>;

export type HostedAuthenticationKeyResolvers = Readonly<{
  /** Test seam only. Production uses the Cloudflare Access remote JWKS. */
  accessKeyResolver?: JWTVerifyGetKey;
  /** Test seam only. Production uses the configured WorkOS JWKS URL. */
  workosKeyResolver?: JWTVerifyGetKey;
}>;

function workosConfiguration(
  bindings: HostedAuthenticationBindings,
): null | Readonly<{ clientId: string; issuer: string; jwksUrl: string }> {
  const values = [
    bindings.WORKOS_CLIENT_ID?.trim() ?? "",
    bindings.WORKOS_ISSUER?.trim() ?? "",
    bindings.WORKOS_JWKS_URL?.trim() ?? "",
  ];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) {
    throw new Error("WorkOS authentication bindings must be configured together.");
  }
  return {
    clientId: values[0],
    issuer: values[1],
    jwksUrl: values[2],
  };
}

/**
 * Builds the one hosted SessionProvider used by every product surface.
 * Cloudflare remains the legacy verifier during migration. WorkOS is enabled
 * only when all three public verification bindings are present.
 */
export function createHostedAuthenticationSessionProvider(
  bindings: HostedAuthenticationBindings,
  clock: Clock,
  keyResolvers: HostedAuthenticationKeyResolvers = {},
): SessionProvider {
  if (!bindings?.TEAM_DOMAIN || !bindings.POLICY_AUD) {
    throw new Error("Cloudflare Access bindings are required.");
  }

  const legacy = new CloudflareAccessSessionProvider({
    teamDomain: bindings.TEAM_DOMAIN,
    audience: bindings.POLICY_AUD,
    clock,
    keyResolver: keyResolvers.accessKeyResolver,
  });

  const workos = workosConfiguration(bindings);
  if (!workos) return legacy;

  return new MigrationSessionProvider(
    legacy,
    new WorkOSAccessSessionProvider({
      clientId: workos.clientId,
      issuer: workos.issuer,
      jwksUrl: workos.jwksUrl,
      clock,
      keyResolver: keyResolvers.workosKeyResolver,
    }),
  );
}

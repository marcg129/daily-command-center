import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { Clock } from "@/lib/runtime/primitives";
import {
  principalId,
  type AuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";

export type CloudflareAccessSessionProviderOptions = Readonly<{
  teamDomain: string;
  audience: string;
  clock: Clock;
  /** Test seam for a local JWKS. Production callers must use the default resolver. */
  keyResolver?: JWTVerifyGetKey;
}>;

function accessOrigin(teamDomain: string): URL {
  let url: URL;
  try {
    url = new URL(teamDomain);
  } catch {
    throw new Error("A valid Cloudflare Access team domain is required.");
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.hostname === ".cloudflareaccess.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("A valid Cloudflare Access team domain is required.");
  }
  return new URL(url.origin);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies an opaque Cloudflare Access application assertion and maps its
 * trusted claims onto the transport-neutral session contract.
 */
export class CloudflareAccessSessionProvider implements SessionProvider {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(private readonly options: CloudflareAccessSessionProviderOptions) {
    const origin = accessOrigin(options.teamDomain);
    const audience = options.audience.trim();
    if (!audience) throw new Error("A Cloudflare Access audience is required.");

    this.issuer = origin.origin;
    this.audience = audience;
    this.keyResolver = options.keyResolver ?? createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", origin),
    );
  }

  async getSession(sessionIdentity: string | null | undefined): Promise<AuthenticatedSession | null> {
    if (!sessionIdentity) return null;

    try {
      const { payload } = await jwtVerify(sessionIdentity, this.keyResolver, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
        currentDate: this.options.clock.now(),
      });
      if (payload.type !== "app" || typeof payload.exp !== "number" || !Number.isFinite(payload.exp))
        return null;

      const expiresAt = new Date(payload.exp * 1_000);
      if (!Number.isFinite(expiresAt.getTime())) return null;

      let stablePrincipal: string;
      if (typeof payload.sub === "string" && payload.sub.trim() !== "") {
        stablePrincipal = `cf-user:${payload.sub}`;
      } else if (
        typeof payload.common_name === "string" &&
        payload.common_name.trim() !== ""
      ) {
        stablePrincipal = `cf-service:${await sha256Hex(payload.common_name)}`;
      } else {
        return null;
      }

      return {
        sessionId: `cf-access:${await sha256Hex(sessionIdentity)}`,
        principal: { principalId: principalId(stablePrincipal) },
        expiresAt: expiresAt.toISOString(),
      };
    } catch {
      return null;
    }
  }
}

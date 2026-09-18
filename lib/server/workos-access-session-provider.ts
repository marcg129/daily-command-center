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
import { readProductBearerToken } from "@/lib/server/request-session-identity";

export type WorkOSAccessSessionProviderOptions = Readonly<{
  clientId: string;
  issuer: string;
  jwksUrl: string;
  clock: Clock;
  /** Test seam for a local JWKS. Production callers use jwksUrl. */
  keyResolver?: JWTVerifyGetKey;
}>;

function clientId(value: string): string {
  const normalized = value.trim();
  if (!/^client_[A-Za-z0-9_-]{8,120}$/.test(normalized)) {
    throw new Error("A valid WorkOS client ID is required.");
  }
  return normalized;
}

function httpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`A valid WorkOS ${label} is required.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`A valid WorkOS ${label} is required.`);
  }
  return url;
}

function issuerVariants(value: string): readonly string[] {
  const url = httpsUrl(value, "issuer");
  if (url.search !== "" || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("A valid WorkOS issuer is required.");
  }
  return [url.origin, `${url.origin}/`];
}

/**
 * Verifies a WorkOS AuthKit access token without importing WorkOS authorization
 * concepts into DCC. Only the stable human user subject becomes a DCC principal.
 */
export class WorkOSAccessSessionProvider implements SessionProvider {
  private readonly expectedClientId: string;
  private readonly issuers: readonly string[];
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(private readonly options: WorkOSAccessSessionProviderOptions) {
    this.expectedClientId = clientId(options.clientId);
    this.issuers = issuerVariants(options.issuer);
    const jwks = httpsUrl(options.jwksUrl, "JWKS URL");
    this.keyResolver = options.keyResolver ?? createRemoteJWKSet(jwks);
  }

  async getSession(
    sessionIdentity: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    const token = readProductBearerToken(sessionIdentity);
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, this.keyResolver, {
        issuer: [...this.issuers],
        algorithms: ["RS256"],
        currentDate: this.options.clock.now(),
      });

      if (
        payload.client_id !== this.expectedClientId ||
        typeof payload.sub !== "string" ||
        !/^user_[A-Za-z0-9_-]{8,120}$/.test(payload.sub) ||
        typeof payload.sid !== "string" ||
        !/^session_[A-Za-z0-9_-]{8,160}$/.test(payload.sid) ||
        typeof payload.exp !== "number" ||
        !Number.isFinite(payload.exp) ||
        (payload.sub_profile !== undefined && payload.sub_profile !== "user")
      ) {
        return null;
      }

      const expiresAt = new Date(payload.exp * 1_000);
      if (!Number.isFinite(expiresAt.getTime())) return null;

      return {
        sessionId: `workos:${payload.sid}`,
        principal: {
          principalId: principalId(`workos-user:${payload.sub}`),
        },
        expiresAt: expiresAt.toISOString(),
      };
    } catch {
      return null;
    }
  }
}

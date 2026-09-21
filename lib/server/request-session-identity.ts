import { readWorkOSAccessCookie } from "@/lib/server/workos-browser-auth";

const CLOUDFLARE_ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const AUTHORIZATION_HEADER = "authorization";
const AUTH_PROVIDER_HEADER = "x-dcc-auth-provider";
const PRODUCT_BEARER_PREFIX = "product-bearer:";

function bearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

/**
 * Converts transport-specific browser/API credentials into the opaque string
 * consumed by the existing SessionProvider contract.
 *
 * Cloudflare Access remains first during the migration so the deployed owner
 * path is unchanged. Product bearer tokens are tagged before they reach a
 * composite provider, preventing one provider from accidentally accepting
 * another provider's credential.
 */
export function readRequestSessionIdentity(request: Request): string | null {
  const accessAssertion = request.headers
    .get(CLOUDFLARE_ACCESS_ASSERTION_HEADER)
    ?.trim();

  // Controlled migration acceptance seam: Cloudflare Access still gates who can
  // reach production, but an explicitly selected request can prove the DCC
  // application identity with the verified WorkOS HttpOnly cookie instead.
  // The selector is deliberately inert after Access is removed.
  const selectedProvider = request.headers
    .get(AUTH_PROVIDER_HEADER)
    ?.trim()
    .toLowerCase();
  if (selectedProvider === "workos") {
    if (!accessAssertion) return null;
    const cookieToken = readWorkOSAccessCookie(request);
    return cookieToken ? `${PRODUCT_BEARER_PREFIX}${cookieToken}` : null;
  }

  if (accessAssertion) return accessAssertion;

  const token = bearerToken(request.headers.get(AUTHORIZATION_HEADER));
  if (token) return `${PRODUCT_BEARER_PREFIX}${token}`;

  const cookieToken = readWorkOSAccessCookie(request);
  return cookieToken ? `${PRODUCT_BEARER_PREFIX}${cookieToken}` : null;
}

export function readProductBearerToken(
  sessionIdentity: string | null | undefined,
): string | null {
  if (!sessionIdentity?.startsWith(PRODUCT_BEARER_PREFIX)) return null;
  const token = sessionIdentity.slice(PRODUCT_BEARER_PREFIX.length).trim();
  return token && !/\s/.test(token) ? token : null;
}

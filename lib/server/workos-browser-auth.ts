const ACCESS_COOKIE = "dcc-workos-access";
const REFRESH_COOKIE = "dcc-workos-refresh";
const STATE_COOKIE = "dcc-workos-state";
const VERIFIER_COOKIE = "dcc-workos-verifier";
const RETURN_TO_COOKIE = "dcc-workos-return-to";

const AUTHORIZATION_URL = "https://api.workos.com/user_management/authorize";
const AUTHENTICATE_URL = "https://api.workos.com/user_management/authenticate";

export type WorkOSBrowserAuthBindings = Readonly<{
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_REDIRECT_URI?: string;
}>;

type FetchLike = typeof fetch;

type TokenResponse = Readonly<{
  access_token?: unknown;
  refresh_token?: unknown;
  user?: Readonly<{ id?: unknown }>;
}>;

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function config(bindings: WorkOSBrowserAuthBindings) {
  const clientId = required(bindings.WORKOS_CLIENT_ID, "WORKOS_CLIENT_ID");
  const apiKey = required(bindings.WORKOS_API_KEY, "WORKOS_API_KEY");
  const redirectUri = required(bindings.WORKOS_REDIRECT_URI, "WORKOS_REDIRECT_URI");

  if (!/^client_[A-Za-z0-9_-]{8,120}$/.test(clientId)) {
    throw new Error("WORKOS_CLIENT_ID is invalid.");
  }
  if (!/^sk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    throw new Error("WORKOS_API_KEY is invalid.");
  }

  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error("WORKOS_REDIRECT_URI is invalid.");
  }
  if (
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    (redirect.protocol !== "https:" &&
      !(redirect.protocol === "http:" &&
        (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1")))
  ) {
    throw new Error("WORKOS_REDIRECT_URI is invalid.");
  }

  return { clientId, apiKey, redirectUri: redirect.toString() };
}

function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function cookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure: boolean } ,
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function clearCookie(name: string, secure: boolean): string {
  return cookie(name, "", { maxAge: 0, secure });
}

function appendCookie(headers: Headers, value: string) {
  headers.append("Set-Cookie", value);
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://dcc.invalid");
    if (url.origin !== "https://dcc.invalid") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function exchange(
  body: Record<string, string>,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<TokenResponse> {
  const response = await fetchImpl(AUTHENTICATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, client_secret: apiKey }),
  });
  if (!response.ok) {
    throw new Error("WorkOS authentication exchange failed.");
  }
  return await response.json() as TokenResponse;
}

function validatedTokens(result: TokenResponse) {
  if (
    typeof result.access_token !== "string" ||
    !result.access_token ||
    typeof result.refresh_token !== "string" ||
    !result.refresh_token ||
    typeof result.user?.id !== "string" ||
    !/^user_[A-Za-z0-9_-]{8,120}$/.test(result.user.id)
  ) {
    throw new Error("WorkOS authentication response is invalid.");
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
  };
}

function setSessionCookies(
  headers: Headers,
  tokens: { accessToken: string; refreshToken: string },
  secure: boolean,
) {
  appendCookie(headers, cookie(ACCESS_COOKIE, tokens.accessToken, { maxAge: 3600, secure }));
  appendCookie(headers, cookie(REFRESH_COOKIE, tokens.refreshToken, { maxAge: 30 * 24 * 60 * 60, secure }));
}

function clearTransientCookies(headers: Headers, secure: boolean) {
  appendCookie(headers, clearCookie(STATE_COOKIE, secure));
  appendCookie(headers, clearCookie(VERIFIER_COOKIE, secure));
  appendCookie(headers, clearCookie(RETURN_TO_COOKIE, secure));
}

export function readWorkOSAccessCookie(request: Request): string | null {
  const value = cookies(request).get(ACCESS_COOKIE)?.trim();
  return value && !/\s/.test(value) ? value : null;
}

export function createWorkOSBrowserAuthHandlers(
  bindings: WorkOSBrowserAuthBindings,
  options: { fetchImpl?: FetchLike } = {},
) {
  const configured = config(bindings);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async start(request: Request): Promise<Response> {
      const state = randomToken();
      const verifier = randomToken(48);
      const challenge = await pkceChallenge(verifier);
      const requestUrl = new URL(request.url);
      const returnTo = safeReturnTo(requestUrl.searchParams.get("returnTo"));
      const destination = new URL(AUTHORIZATION_URL);
      destination.search = new URLSearchParams({
        response_type: "code",
        client_id: configured.clientId,
        redirect_uri: configured.redirectUri,
        provider: "authkit",
        state,
        code_challenge_method: "S256",
        code_challenge: challenge,
      }).toString();

      const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
      const secure = secureRequest(request);
      appendCookie(headers, cookie(STATE_COOKIE, state, { maxAge: 600, secure }));
      appendCookie(headers, cookie(VERIFIER_COOKIE, verifier, { maxAge: 600, secure }));
      appendCookie(headers, cookie(RETURN_TO_COOKIE, encodeURIComponent(returnTo), { maxAge: 600, secure }));
      return new Response(null, { status: 302, headers });
    },

    async callback(request: Request): Promise<Response> {
      const requestUrl = new URL(request.url);
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const jar = cookies(request);
      const expectedState = jar.get(STATE_COOKIE) ?? "";
      const verifier = jar.get(VERIFIER_COOKIE) ?? "";
      const secure = secureRequest(request);

      if (!code || !state || !expectedState || state !== expectedState || !verifier) {
        const headers = new Headers({ "Cache-Control": "no-store" });
        clearTransientCookies(headers, secure);
        return Response.json({ error: "Authentication callback validation failed." }, { status: 400, headers });
      }

      try {
        const result = await exchange({
          client_id: configured.clientId,
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
        }, configured.apiKey, fetchImpl);
        const tokens = validatedTokens(result);
        const encodedReturnTo = jar.get(RETURN_TO_COOKIE) ?? "";
        let returnTo = "/";
        try {
          returnTo = safeReturnTo(decodeURIComponent(encodedReturnTo));
        } catch {
          returnTo = "/";
        }
        const destination = new URL(returnTo, request.url);
        const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
        setSessionCookies(headers, tokens, secure);
        clearTransientCookies(headers, secure);
        return new Response(null, { status: 302, headers });
      } catch {
        const headers = new Headers({ "Cache-Control": "no-store" });
        clearTransientCookies(headers, secure);
        return Response.json({ error: "Authentication exchange failed." }, { status: 502, headers });
      }
    },

    async refresh(request: Request): Promise<Response> {
      const secure = secureRequest(request);
      const refreshToken = cookies(request).get(REFRESH_COOKIE)?.trim();
      if (!refreshToken || /\s/.test(refreshToken)) {
        return Response.json({ error: "Refresh token required." }, {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        });
      }

      try {
        const result = await exchange({
          client_id: configured.clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }, configured.apiKey, fetchImpl);
        const tokens = validatedTokens(result);
        const headers = new Headers({ "Cache-Control": "no-store" });
        setSessionCookies(headers, tokens, secure);
        return new Response(null, { status: 204, headers });
      } catch {
        const headers = new Headers({ "Cache-Control": "no-store" });
        appendCookie(headers, clearCookie(ACCESS_COOKIE, secure));
        appendCookie(headers, clearCookie(REFRESH_COOKIE, secure));
        return Response.json({ error: "Session refresh failed." }, { status: 401, headers });
      }
    },

    async signOut(request: Request): Promise<Response> {
      const secure = secureRequest(request);
      const headers = new Headers({ "Cache-Control": "no-store" });
      appendCookie(headers, clearCookie(ACCESS_COOKIE, secure));
      appendCookie(headers, clearCookie(REFRESH_COOKIE, secure));
      clearTransientCookies(headers, secure);
      return new Response(null, { status: 204, headers });
    },
  };
}

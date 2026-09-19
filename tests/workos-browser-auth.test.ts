import assert from "node:assert/strict";
import test from "node:test";
import { createWorkOSBrowserAuthHandlers } from "@/lib/server/workos-browser-auth";

const bindings = {
  WORKOS_CLIENT_ID: "client_01ABCDEF1234567890",
  WORKOS_API_KEY: "sk_test_01ABCDEF1234567890",
  WORKOS_REDIRECT_URI: "https://command.example/api/auth/workos/callback",
};

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function cookieValue(values: string[], name: string): string {
  for (const value of values) {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`).exec(value);
    if (match) return match[1];
  }
  throw new Error(`Missing cookie ${name}`);
}

test("AuthKit start creates state + PKCE and never exposes the API key", async () => {
  const handlers = createWorkOSBrowserAuthHandlers(bindings);
  const response = await handlers.start(new Request(
    "https://command.example/api/auth/workos/start?returnTo=%2Ftoday%3Fview%3Dfocus",
  ));

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin + location.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(location.searchParams.get("client_id"), bindings.WORKOS_CLIENT_ID);
  assert.equal(location.searchParams.get("redirect_uri"), bindings.WORKOS_REDIRECT_URI);
  assert.equal(location.searchParams.get("provider"), "authkit");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(location.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{30,}$/);
  assert.match(location.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{30,}$/);
  assert.doesNotMatch(location.toString(), /sk_test_/);

  const values = setCookies(response).join("\n");
  assert.match(values, /dcc-workos-state=/);
  assert.match(values, /dcc-workos-verifier=/);
  assert.match(values, /dcc-workos-return-to=/);
  assert.match(values, /HttpOnly/);
  assert.match(values, /SameSite=Lax/);
  assert.match(values, /Secure/);
});

test("callback validates state, exchanges the code with PKCE, and stores only HttpOnly session cookies", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({
      access_token: "access.jwt.value",
      refresh_token: "refresh_token_value",
      user: { id: "user_01HBEQKA6K4QJAS93VPE39W1JT" },
    });
  }) as typeof fetch;
  const handlers = createWorkOSBrowserAuthHandlers(bindings, { fetchImpl });

  const start = await handlers.start(new Request(
    "https://command.example/api/auth/workos/start?returnTo=%2Fcalendar%3Fmode%3Dagenda",
  ));
  const startCookies = setCookies(start);
  const state = cookieValue(startCookies, "dcc-workos-state");
  const verifier = cookieValue(startCookies, "dcc-workos-verifier");
  const returnTo = cookieValue(startCookies, "dcc-workos-return-to");

  const response = await handlers.callback(new Request(
    `https://command.example/api/auth/workos/callback?code=auth_code_123&state=${state}`,
    {
      headers: {
        Cookie: [
          `dcc-workos-state=${state}`,
          `dcc-workos-verifier=${verifier}`,
          `dcc-workos-return-to=${returnTo}`,
        ].join("; "),
      },
    },
  ));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://command.example/calendar?mode=agenda");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.workos.com/user_management/authenticate");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.client_id, bindings.WORKOS_CLIENT_ID);
  assert.equal(body.client_secret, bindings.WORKOS_API_KEY);
  assert.equal(body.grant_type, "authorization_code");
  assert.equal(body.code, "auth_code_123");
  assert.equal(body.code_verifier, verifier);

  const values = setCookies(response).join("\n");
  assert.match(values, /dcc-workos-access=access\.jwt\.value/);
  assert.match(values, /dcc-workos-refresh=refresh_token_value/);
  assert.match(values, /dcc-workos-state=;.*Max-Age=0/);
  assert.match(values, /dcc-workos-verifier=;.*Max-Age=0/);
  assert.match(values, /HttpOnly/);
  assert.match(values, /Secure/);
  assert.doesNotMatch(values, new RegExp(bindings.WORKOS_API_KEY));
});

test("callback fails closed on state mismatch without exchanging a code", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return Response.json({});
  }) as typeof fetch;
  const handlers = createWorkOSBrowserAuthHandlers(bindings, { fetchImpl });

  const response = await handlers.callback(new Request(
    "https://command.example/api/auth/workos/callback?code=abc&state=attacker",
    {
      headers: {
        Cookie: "dcc-workos-state=expected; dcc-workos-verifier=verifier-value",
      },
    },
  ));

  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.match(setCookies(response).join("\n"), /dcc-workos-state=;.*Max-Age=0/);
});

test("refresh rotates both WorkOS tokens, preserves transient failures, and clears terminal failures", async () => {
  let failureStatus: number | null = null;
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (failureStatus !== null) return new Response("invalid", { status: failureStatus });
    return Response.json({
      access_token: "rotated.access.token",
      refresh_token: "rotated_refresh_token",
      user: { id: "user_01HBEQKA6K4QJAS93VPE39W1JT" },
    });
  }) as typeof fetch;
  const handlers = createWorkOSBrowserAuthHandlers(bindings, { fetchImpl });

  const success = await handlers.refresh(new Request(
    "https://command.example/api/auth/workos/refresh",
    { method: "POST", headers: { Cookie: "dcc-workos-refresh=old_refresh_token" } },
  ));
  assert.equal(success.status, 204);
  assert.equal(bodies[0].grant_type, "refresh_token");
  assert.equal(bodies[0].refresh_token, "old_refresh_token");
  assert.match(setCookies(success).join("\n"), /dcc-workos-refresh=rotated_refresh_token/);

  failureStatus = 503;
  const transient = await handlers.refresh(new Request(
    "https://command.example/api/auth/workos/refresh",
    { method: "POST", headers: { Cookie: "dcc-workos-refresh=retry_refresh_token" } },
  ));
  assert.equal(transient.status, 503);
  assert.doesNotMatch(setCookies(transient).join("\n"), /dcc-workos-refresh=;.*Max-Age=0/);

  failureStatus = 400;
  const failure = await handlers.refresh(new Request(
    "https://command.example/api/auth/workos/refresh",
    { method: "POST", headers: { Cookie: "dcc-workos-refresh=bad_refresh_token" } },
  ));
  assert.equal(failure.status, 401);
  const cleared = setCookies(failure).join("\n");
  assert.match(cleared, /dcc-workos-access=;.*Max-Age=0/);
  assert.match(cleared, /dcc-workos-refresh=;.*Max-Age=0/);
});

test("sign-out clears product session cookies", async () => {
  const handlers = createWorkOSBrowserAuthHandlers(bindings);
  const response = await handlers.signOut(new Request(
    "https://command.example/api/auth/workos/signout",
    { method: "POST" },
  ));
  assert.equal(response.status, 204);
  const cleared = setCookies(response).join("\n");
  assert.match(cleared, /dcc-workos-access=;.*Max-Age=0/);
  assert.match(cleared, /dcc-workos-refresh=;.*Max-Age=0/);
});

test("browser auth configuration fails closed when required secret material is incomplete", () => {
  assert.throws(
    () => createWorkOSBrowserAuthHandlers({ WORKOS_CLIENT_ID: bindings.WORKOS_CLIENT_ID }),
    /WORKOS_API_KEY is required/i,
  );
  assert.throws(
    () => createWorkOSBrowserAuthHandlers({
      ...bindings,
      WORKOS_REDIRECT_URI: "http://command.example/callback",
    }),
    /redirect/i,
  );
});

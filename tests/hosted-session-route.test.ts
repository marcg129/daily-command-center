import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clock } from "@/lib/runtime/primitives";
import {
  InMemorySessionProvider,
  principalId,
  type AuthenticatedSession,
  type SessionProvider,
} from "@/lib/runtime/session";
import { createAuthorizedHostedSessionHandler } from "@/lib/server/authorized-hosted-session-handler";

const now = "2026-09-12T08:00:00.000Z";
const clock: Clock = { now: () => new Date(now) };
const validSession: AuthenticatedSession = {
  sessionId: "verified-session",
  principal: { principalId: principalId("cf-user:user-123") },
  expiresAt: "2026-09-12T09:00:00.000Z",
};

function request(assertion = "assertion") {
  return new Request("https://command.example/api/hosted/session", {
    headers: assertion ? { "cf-access-jwt-assertion": assertion } : undefined,
  });
}

test("verified hosted session returns only stable principal ID and expiry", async () => {
  const handler = createAuthorizedHostedSessionHandler(
    new InMemorySessionProvider(new Map([["assertion", validSession]])),
    clock,
  );
  const response = await handler.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    principalId: "cf-user:user-123",
    expiresAt: "2026-09-12T09:00:00.000Z",
  });
});

test("missing, invalid, and expired assertions fail closed", async () => {
  const sessions = new Map<string, AuthenticatedSession>([
    ["assertion", { ...validSession, expiresAt: now }],
  ]);
  const handler = createAuthorizedHostedSessionHandler(new InMemorySessionProvider(sessions), clock);
  for (const assertion of ["", "bad", "assertion"]) {
    const response = await handler.GET(request(assertion));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Authentication required." });
  }
});

test("session provider failures are bounded and never expose sensitive detail", async () => {
  const failing: SessionProvider = {
    async getSession() {
      throw new Error("JWKS internal secret token detail");
    },
  };
  const handler = createAuthorizedHostedSessionHandler(failing, clock);
  const response = await handler.GET(request());
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: "Hosted session could not be read safely." });
  assert.doesNotMatch(JSON.stringify(body).toLowerCase(), /jwks|secret|token|assertion/);
});

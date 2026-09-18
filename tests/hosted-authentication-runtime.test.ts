import assert from "node:assert/strict";
import test from "node:test";
import { createHostedAuthenticationSessionProvider } from "@/lib/server/hosted-authentication-runtime";

const clock = { now: () => new Date("2026-09-18T20:00:00.000Z") };
const legacy = {
  TEAM_DOMAIN: "https://daily-command-center.cloudflareaccess.com",
  POLICY_AUD: "access-application-audience",
};

test("legacy-only hosted auth remains valid without WorkOS configuration", () => {
  assert.doesNotThrow(() =>
    createHostedAuthenticationSessionProvider(legacy, clock),
  );
});

test("WorkOS verification bindings are all-or-nothing", () => {
  assert.throws(
    () =>
      createHostedAuthenticationSessionProvider(
        { ...legacy, WORKOS_CLIENT_ID: "client_01ABCDEF1234567890" },
        clock,
      ),
    /configured together/i,
  );

  assert.doesNotThrow(() =>
    createHostedAuthenticationSessionProvider(
      {
        ...legacy,
        WORKOS_CLIENT_ID: "client_01ABCDEF1234567890",
        WORKOS_ISSUER: "https://api.workos.com",
        WORKOS_JWKS_URL:
          "https://api.workos.com/sso/jwks/client_01ABCDEF1234567890",
      },
      clock,
    ),
  );
});

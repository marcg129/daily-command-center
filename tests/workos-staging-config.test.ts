import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/verify-workos-staging-config.mjs", import.meta.url));

const valid = {
  WORKOS_CLIENT_ID: "client_123456789",
  WORKOS_API_KEY: "sk_test_123456789abcdef",
  WORKOS_REDIRECT_URI: "https://command.coreyg.dev/api/auth/workos/callback",
  WORKOS_ISSUER: "https://api.workos.com/",
  WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/client_123456789",
};

function run(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...valid, ...overrides },
  });
}

test("WorkOS staging config verifier accepts the DCC staging contract without printing the API key", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /structurally ready/);
  assert.match(result.stdout, /API key: configured/);
  assert.doesNotMatch(result.stdout, /sk_test_123456789abcdef/);
  assert.doesNotMatch(result.stderr, /sk_test_123456789abcdef/);
});

test("WorkOS staging config verifier rejects a production API key", () => {
  const result = run({ WORKOS_API_KEY: "sk_live_123456789abcdef" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /staging key/);
  assert.doesNotMatch(result.stdout, /sk_live_/);
  assert.doesNotMatch(result.stderr, /sk_live_123456789abcdef/);
});

test("WorkOS staging config verifier requires the canonical DCC callback", () => {
  const result = run({
    WORKOS_REDIRECT_URI: "https://command.coreyg.dev/api/auth/workos/callback/extra",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WORKOS_REDIRECT_URI must be exactly/);
});

test("WorkOS staging config verifier binds the JWKS endpoint to the configured client", () => {
  const result = run({
    WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/client_other123",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WORKOS_JWKS_URL must be/);
});

test("WorkOS staging config verifier accepts the client-scoped issuer form", () => {
  const result = run({
    WORKOS_ISSUER: "https://api.workos.com/user_management/client_123456789",
  });
  assert.equal(result.status, 0, result.stderr);
});

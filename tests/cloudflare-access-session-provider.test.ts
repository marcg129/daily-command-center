import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { CloudflareAccessSessionProvider } from "@/lib/server/cloudflare-access-session-provider";

const now = new Date("2026-09-11T18:00:00.000Z");
const issuer = "https://daily-command-center.cloudflareaccess.com";
const audience = "access-application-audience";

async function signingFixture() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  const resolver = createLocalJWKSet({ keys: [jwk] });
  return { privateKey: pair.privateKey, resolver, jwk };
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; audience?: string; expiration?: number; notBefore?: number } = {},
) {
  let token = new SignJWT({ type: "app", sub: "user-123", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(overrides.expiration ?? Math.floor(now.getTime() / 1_000) + 3_600);
  if (overrides.notBefore !== undefined) token = token.setNotBefore(overrides.notBefore);
  return token.sign(privateKey);
}

function provider(keyResolver: JWTVerifyGetKey, options: { teamDomain?: string; expectedAudience?: string } = {}) {
  return new CloudflareAccessSessionProvider({
    teamDomain: options.teamDomain ?? issuer,
    audience: options.expectedAudience ?? audience,
    clock: { now: () => now },
    keyResolver,
  });
}

test("verified user assertion maps sub, expiry, and a hashed token session ID", async () => {
  const { privateKey, resolver } = await signingFixture();
  const assertion = await sign(privateKey, { email: "unstable@example.com" });
  const session = await provider(resolver).getSession(assertion);

  assert.equal(session?.principal.principalId, "cf-user:user-123");
  assert.equal(session?.expiresAt, "2026-09-11T19:00:00.000Z");
  assert.match(session?.sessionId ?? "", /^cf-access:[a-f0-9]{64}$/);
  assert.notEqual(session?.sessionId, assertion);
  assert.equal(session?.sessionId.includes(assertion), false);
});

test("verified service assertions hash common_name into stable, collision-resistant identity", async () => {
  const { privateKey, resolver } = await signingFixture();
  const firstAssertion = await sign(privateKey, { sub: "", common_name: "service/client@example" });
  const secondAssertion = await sign(
    privateKey,
    { sub: "", common_name: "service/client@example", nonce: "different-token" },
  );
  const access = provider(resolver);
  const first = await access.getSession(firstAssertion);
  const second = await access.getSession(secondAssertion);

  assert.match(first?.principal.principalId ?? "", /^cf-service:[a-f0-9]{64}$/);
  assert.equal(first?.principal.principalId, second?.principal.principalId);
  assert.notEqual(first?.sessionId, second?.sessionId);
});

test("local RS256 keys verify while malformed, tampered, and wrong-key assertions fail closed", async () => {
  const trusted = await signingFixture();
  const untrusted = await signingFixture();
  const valid = await sign(trusted.privateKey);
  const parts = valid.split(".");
  parts[2] = `${parts[2].startsWith("a") ? "b" : "a"}${parts[2].slice(1)}`;
  const tampered = parts.join(".");
  const wrongKey = await sign(untrusted.privateKey);
  const access = provider(trusted.resolver);

  assert.ok(await access.getSession(valid));
  for (const assertion of [null, "not-a-jwt", tampered, wrongKey])
    assert.equal(await access.getSession(assertion), null);
});

test("issuer, audience, time, application type, expiry claim, and identity are required", async () => {
  const { privateKey, resolver } = await signingFixture();
  const epoch = Math.floor(now.getTime() / 1_000);
  const invalid = [
    await sign(privateKey, {}, { issuer: "https://other.cloudflareaccess.com" }),
    await sign(privateKey, {}, { audience: "another-audience" }),
    await sign(privateKey, {}, { expiration: epoch - 1 }),
    await sign(privateKey, {}, { notBefore: epoch + 1 }),
    await sign(privateKey, { type: "org" }),
    await new SignJWT({ type: "app", sub: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer).setAudience(audience).sign(privateKey),
    await sign(privateKey, { sub: "", common_name: "" }),
    await sign(privateKey, { sub: "   ", common_name: "   " }),
  ];

  for (const assertion of invalid) assert.equal(await provider(resolver).getSession(assertion), null);
});

test("constructor rejects unsafe team domains and blank audiences", async () => {
  const { resolver } = await signingFixture();
  for (const teamDomain of [
    "http://team.cloudflareaccess.com",
    "https://cloudflareaccess.com",
    "https://attacker.example",
    "https://user:pass@team.cloudflareaccess.com",
    "https://team.cloudflareaccess.com/path",
    "https://team.cloudflareaccess.com/?query=yes",
    "https://team.cloudflareaccess.com/#fragment",
    "not a url",
  ]) {
    assert.throws(() => provider(resolver, { teamDomain }), /valid Cloudflare Access team domain/);
  }
  assert.throws(() => provider(resolver, { expectedAudience: "   " }), /audience is required/);
});

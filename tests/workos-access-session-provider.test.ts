import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { WorkOSAccessSessionProvider } from "@/lib/server/workos-access-session-provider";

const now = new Date("2026-09-18T20:00:00.000Z");
const issuer = "https://api.workos.com";
const clientId = "client_01ABCDEF1234567890";
const scopedIssuer = `${issuer}/user_management/${clientId}`;
const jwksUrl = "https://api.workos.com/sso/jwks/client_01ABCDEF1234567890";

async function fixture() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "workos-test-key";
  return {
    privateKey: pair.privateKey,
    resolver: createLocalJWKSet({ keys: [jwk] }),
  };
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; client?: string; expiration?: number; omitClient?: boolean } = {},
) {
  const payload: Record<string, unknown> = {
    sub: "user_01HBEQKA6K4QJAS93VPE39W1JT",
    sid: "session_01HQSXZGF8FHF7A9ZZFCW4387R",
    ...claims,
  };
  if (!overrides.omitClient) payload.client_id = overrides.client ?? clientId;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "workos-test-key" })
    .setIssuer(overrides.issuer ?? issuer)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(
      overrides.expiration ?? Math.floor(now.getTime() / 1_000) + 3_600,
    )
    .sign(privateKey);
}

function provider(resolver: JWTVerifyGetKey) {
  return new WorkOSAccessSessionProvider({
    clientId,
    issuer,
    jwksUrl,
    clock: { now: () => now },
    keyResolver: resolver,
  });
}

test("verified AuthKit user token maps only the stable WorkOS user subject", async () => {
  const { privateKey, resolver } = await fixture();
  const token = await sign(privateKey, {
    email: "ignored@example.com",
    role: "admin",
    permissions: ["all:the-things"],
  });
  const session = await provider(resolver).getSession(`product-bearer:${token}`);

  assert.equal(
    session?.principal.principalId,
    "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
  );
  assert.equal(
    session?.sessionId,
    "workos:session_01HQSXZGF8FHF7A9ZZFCW4387R",
  );
  assert.equal(session?.expiresAt, "2026-09-18T21:00:00.000Z");
});

test("client-scoped AuthKit issuer validates the application even when client_id is absent", async () => {
  const { privateKey, resolver } = await fixture();
  const token = await sign(
    privateKey,
    {},
    { issuer: scopedIssuer, omitClient: true },
  );

  const session = await provider(resolver).getSession(`product-bearer:${token}`);
  assert.equal(
    session?.principal.principalId,
    "workos-user:user_01HBEQKA6K4QJAS93VPE39W1JT",
  );
});

test("bare WorkOS issuer still requires the expected client_id claim", async () => {
  const { privateKey, resolver } = await fixture();
  const token = await sign(privateKey, {}, { omitClient: true });
  assert.equal(
    await provider(resolver).getSession(`product-bearer:${token}`),
    null,
  );
});

test("untagged, wrong-client, wrong-issuer, expired, and agent tokens fail closed", async () => {
  const { privateKey, resolver } = await fixture();
  const epoch = Math.floor(now.getTime() / 1_000);
  const valid = await sign(privateKey);
  const invalid = [
    valid,
    `product-bearer:${await sign(privateKey, {}, { client: "client_01DIFFERENT12345678" })}`,
    `product-bearer:${await sign(privateKey, {}, { issuer: "https://attacker.example" })}`,
    `product-bearer:${await sign(privateKey, {}, { expiration: epoch - 1 })}`,
    `product-bearer:${await sign(privateKey, { sub_profile: "ai_agent" })}`,
  ];

  for (const identity of invalid) {
    assert.equal(await provider(resolver).getSession(identity), null);
  }
});

test("provider configuration rejects unsafe issuer, JWKS, and client values", async () => {
  const { resolver } = await fixture();
  const base = {
    clientId,
    issuer,
    jwksUrl,
    clock: { now: () => now },
    keyResolver: resolver,
  };

  assert.throws(
    () => new WorkOSAccessSessionProvider({ ...base, clientId: "not-client" }),
    /client ID/i,
  );
  assert.throws(
    () => new WorkOSAccessSessionProvider({ ...base, issuer: "http://api.workos.com" }),
    /issuer/i,
  );
  assert.doesNotThrow(
    () => new WorkOSAccessSessionProvider({ ...base, issuer: scopedIssuer }),
  );
  assert.throws(
    () => new WorkOSAccessSessionProvider({ ...base, issuer: "https://api.workos.com/path" }),
    /issuer/i,
  );
  assert.throws(
    () => new WorkOSAccessSessionProvider({ ...base, jwksUrl: "http://api.workos.com/jwks" }),
    /JWKS/i,
  );
});

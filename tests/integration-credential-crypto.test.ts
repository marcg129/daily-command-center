import assert from "node:assert/strict";
import test from "node:test";
import { applicationUserId } from "@/lib/runtime/application-user";
import { integrationAccountId } from "@/lib/runtime/integration-account";
import {
  AesGcmIntegrationCredentialCipher,
  generateIntegrationCredentialKey,
} from "@/lib/server/integration-credential-crypto";

const alice = applicationUserId("user:alice");
const bob = applicationUserId("user:bob");
const integration = integrationAccountId("integration:google:alice");

test("integration credentials encrypt without exposing OAuth tokens", async () => {
  const key = generateIntegrationCredentialKey();
  const cipher = new AesGcmIntegrationCredentialCipher({
    activeVersion: 1,
    keys: new Map([[1, key]]),
  });
  const envelope = await cipher.encrypt(
    { userId: alice, integrationId: integration, provider: "GOOGLE" },
    {
      refreshToken: "refresh-secret-123",
      accessToken: "access-secret-456",
    },
  );

  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(envelope.keyVersion, 1);
  assert.equal(envelope.formatVersion, 1);
  assert.equal(envelope.nonceB64u.length, 16);
  assert.doesNotMatch(JSON.stringify(envelope), /refresh-secret|access-secret/);

  assert.deepEqual(
    await cipher.decrypt(
      { userId: alice, integrationId: integration, provider: "GOOGLE" },
      envelope,
    ),
    {
      refreshToken: "refresh-secret-123",
      accessToken: "access-secret-456",
    },
  );
});

test("encrypted credentials are cryptographically bound to the owning user and integration", async () => {
  const cipher = new AesGcmIntegrationCredentialCipher({
    activeVersion: 1,
    keys: new Map([[1, generateIntegrationCredentialKey()]]),
  });
  const envelope = await cipher.encrypt(
    { userId: alice, integrationId: integration, provider: "GOOGLE" },
    { refreshToken: "refresh-secret-123" },
  );

  await assert.rejects(
    cipher.decrypt(
      { userId: bob, integrationId: integration, provider: "GOOGLE" },
      envelope,
    ),
    /decryption failed/i,
  );
  await assert.rejects(
    cipher.decrypt(
      {
        userId: alice,
        integrationId: integrationAccountId("integration:google:other"),
        provider: "GOOGLE",
      },
      envelope,
    ),
    /decryption failed/i,
  );
});

test("credential encryption rejects bundles whose actual ciphertext exceeds the D1 envelope limit", async () => {
  const cipher = new AesGcmIntegrationCredentialCipher({
    activeVersion: 1,
    keys: new Map([[1, generateIntegrationCredentialKey()]]),
  });

  await assert.rejects(
    cipher.encrypt(
      { userId: alice, integrationId: integration, provider: "GOOGLE" },
      {
        refreshToken: "r".repeat(13_000),
        accessToken: "a".repeat(13_000),
      },
    ),
    /encrypted storage limit/i,
  );
});

test("credential key rotation can decrypt old envelopes while writing the active version", async () => {
  const v1 = generateIntegrationCredentialKey();
  const v2 = generateIntegrationCredentialKey();
  const oldCipher = new AesGcmIntegrationCredentialCipher({
    activeVersion: 1,
    keys: new Map([[1, v1]]),
  });
  const oldEnvelope = await oldCipher.encrypt(
    { userId: alice, integrationId: integration, provider: "GOOGLE" },
    { refreshToken: "refresh-old" },
  );

  const rotating = new AesGcmIntegrationCredentialCipher({
    activeVersion: 2,
    keys: new Map([[1, v1], [2, v2]]),
  });
  assert.deepEqual(
    await rotating.decrypt(
      { userId: alice, integrationId: integration, provider: "GOOGLE" },
      oldEnvelope,
    ),
    { refreshToken: "refresh-old", accessToken: null },
  );

  const newEnvelope = await rotating.encrypt(
    { userId: alice, integrationId: integration, provider: "GOOGLE" },
    { refreshToken: "refresh-new" },
  );
  assert.equal(newEnvelope.keyVersion, 2);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { applicationUserId } from "@/lib/runtime/application-user";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/runtime/d1";
import { integrationAccountId } from "@/lib/runtime/integration-account";
import {
  AesGcmIntegrationCredentialCipher,
  generateIntegrationCredentialKey,
} from "@/lib/server/integration-credential-crypto";
import { D1IntegrationAccountRepository } from "@/lib/server/d1-integration-account-repository";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly statement: StatementSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  private input() { return this.values as SQLInputValue[]; }
  async first<T>() { return (this.statement.get(...this.input()) as T | undefined) ?? null; }
  async all<T>() { return { success: true, results: this.statement.all(...this.input()) as T[] }; }
  async run<T>(): Promise<D1Result<T>> { this.statement.run(...this.input()); return { success: true }; }
}

class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of [
      "0001_workspaces.sql",
      "0006_principal_workspace_grants.sql",
      "0007_user_workspace_ownership.sql",
      "0014_integration_accounts.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
  }
  prepare(sql: string) { return new Statement(this.sqlite.prepare(sql)); }
  async batch<T>(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function repository(database: TestD1) {
  return new D1IntegrationAccountRepository(
    database,
    new AesGcmIntegrationCredentialCipher({
      activeVersion: 1,
      keys: new Map([[1, generateIntegrationCredentialKey()]]),
    }),
  );
}

function seedUser(database: TestD1, userId: string, status = "ACTIVE") {
  database.sqlite.prepare(
    "INSERT INTO users (user_id,status,created_at,updated_at) VALUES (?,?,?,?)",
  ).run(userId, status, "2026-10-01T12:00:00Z", "2026-10-01T12:00:00Z");
}

test("integration accounts are user-scoped and D1 stores only ciphertext", async () => {
  const database = new TestD1();
  seedUser(database, "user:alice");
  seedUser(database, "user:bob");
  const integrations = repository(database);
  const alice = applicationUserId("user:alice");
  const bob = applicationUserId("user:bob");
  const id = integrationAccountId("integration:google:alice");

  const created = await integrations.create({
    integrationId: id,
    userId: alice,
    provider: "GOOGLE",
    providerAccountId: "google-sub-alice",
    displayEmail: "Alice@Example.com",
    scopes: ["scope.calendar", "scope.gmail", "scope.gmail"],
    accessTokenExpiresAt: "2026-10-01T13:00:00Z",
    credentials: {
      refreshToken: "refresh-secret-alice",
      accessToken: "access-secret-alice",
    },
    now: "2026-10-01T12:00:00Z",
  });

  assert.equal(created.displayEmail, "alice@example.com");
  assert.deepEqual(created.scopes, ["scope.calendar", "scope.gmail"]);
  assert.equal(created.status, "ACTIVE");
  assert.equal(await integrations.get(bob, id), null);
  await assert.rejects(
    integrations.readCredentials(bob, id),
    /access denied/i,
  );

  assert.deepEqual(await integrations.readCredentials(alice, id), {
    refreshToken: "refresh-secret-alice",
    accessToken: "access-secret-alice",
  });

  const stored = database.sqlite.prepare(
    "SELECT nonce_b64u, ciphertext_b64u FROM integration_credentials WHERE integration_id=?",
  ).get(id) as Record<string, unknown>;
  const serialized = JSON.stringify(stored);
  assert.doesNotMatch(serialized, /refresh-secret-alice/);
  assert.doesNotMatch(serialized, /access-secret-alice/);

  database.sqlite.close();
});

test("one provider account cannot be attached to two DCC users", async () => {
  const database = new TestD1();
  seedUser(database, "user:alice");
  seedUser(database, "user:bob");
  const integrations = repository(database);

  await integrations.create({
    integrationId: integrationAccountId("integration:google:alice"),
    userId: applicationUserId("user:alice"),
    provider: "GOOGLE",
    providerAccountId: "same-google-sub",
    scopes: [],
    credentials: { refreshToken: "refresh-alice" },
    now: "2026-10-01T12:00:00Z",
  });

  await assert.rejects(
    integrations.create({
      integrationId: integrationAccountId("integration:google:bob"),
      userId: applicationUserId("user:bob"),
      provider: "GOOGLE",
      providerAccountId: "same-google-sub",
      scopes: [],
      credentials: { refreshToken: "refresh-bob" },
      now: "2026-10-01T12:05:00Z",
    }),
  );

  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM integration_accounts WHERE provider_account_id='same-google-sub'",
    ).get()!.count,
    1,
  );
  database.sqlite.close();
});

test("integration health tracks success and bounded failure state without exposing credentials", async () => {
  const database = new TestD1();
  seedUser(database, "user:alice");
  const integrations = repository(database);
  const userId = applicationUserId("user:alice");
  const integrationId = integrationAccountId("integration:google:alice");

  await integrations.create({
    integrationId,
    userId,
    provider: "GOOGLE",
    providerAccountId: "google-sub-alice",
    scopes: ["scope.gmail"],
    credentials: { refreshToken: "refresh-alice" },
    now: "2026-10-01T12:00:00Z",
  });

  await integrations.recordSyncFailure({
    userId,
    integrationId,
    failedAt: "2026-10-01T12:10:00Z",
    errorCode: "TOKEN_REVOKED",
    reauthRequired: true,
  });
  let account = await integrations.get(userId, integrationId);
  assert.equal(account?.status, "REAUTH_REQUIRED");
  assert.equal(account?.consecutiveFailures, 1);
  assert.equal(account?.lastErrorCode, "TOKEN_REVOKED");

  await integrations.replaceCredentials({
    userId,
    integrationId,
    credentials: { refreshToken: "refresh-alice-new" },
    accessTokenExpiresAt: "2026-10-01T14:00:00Z",
    now: "2026-10-01T12:20:00Z",
  });
  account = await integrations.get(userId, integrationId);
  assert.equal(account?.status, "ACTIVE");
  assert.equal(account?.consecutiveFailures, 0);
  assert.equal(account?.lastErrorCode, null);

  await integrations.recordSyncSuccess({
    userId,
    integrationId,
    completedAt: "2026-10-01T12:30:00Z",
    nextSyncAt: "2026-10-01T13:00:00Z",
  });
  account = await integrations.get(userId, integrationId);
  assert.equal(account?.lastSuccessfulSyncAt, "2026-10-01T12:30:00Z");
  assert.equal(account?.nextSyncAt, "2026-10-01T13:00:00Z");

  database.sqlite.close();
});

test("disconnect deletes credential ciphertext and disabled users fail closed", async () => {
  const database = new TestD1();
  seedUser(database, "user:alice");
  seedUser(database, "user:disabled", "DISABLED");
  const integrations = repository(database);
  const userId = applicationUserId("user:alice");
  const id = integrationAccountId("integration:google:alice");

  await integrations.create({
    integrationId: id,
    userId,
    provider: "GOOGLE",
    providerAccountId: "google-sub-alice",
    scopes: [],
    credentials: { refreshToken: "refresh-alice" },
    now: "2026-10-01T12:00:00Z",
  });

  await integrations.disconnect(userId, id, "2026-10-01T13:00:00Z");
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM integration_credentials WHERE integration_id=?",
    ).get(id)!.count,
    0,
  );
  assert.equal((await integrations.get(userId, id))?.status, "DISCONNECTED");
  await assert.rejects(
    integrations.readCredentials(userId, id),
    /access denied/i,
  );

  await integrations.replaceCredentials({
    userId,
    integrationId: id,
    credentials: {
      refreshToken: "refresh-alice-reconnected",
      accessToken: "access-alice-reconnected",
    },
    accessTokenExpiresAt: "2026-10-01T15:00:00Z",
    now: "2026-10-01T14:00:00Z",
  });
  assert.equal((await integrations.get(userId, id))?.status, "ACTIVE");
  assert.deepEqual(await integrations.readCredentials(userId, id), {
    refreshToken: "refresh-alice-reconnected",
    accessToken: "access-alice-reconnected",
  });
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) count FROM integration_credentials WHERE integration_id=?",
    ).get(id)!.count,
    1,
  );

  await assert.rejects(
    integrations.list(applicationUserId("user:disabled")),
    /access denied/i,
  );

  database.sqlite.close();
});

test("integration schema never declares plaintext OAuth token columns", () => {
  const migration = readFileSync(
    new URL("../migrations/0014_integration_accounts.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(migration, /\brefresh_token\b/i);
  assert.doesNotMatch(migration, /\baccess_token\b(?!_expires)/i);
  assert.match(migration, /ciphertext_b64u/);
  assert.match(migration, /AES-256-GCM/);
});

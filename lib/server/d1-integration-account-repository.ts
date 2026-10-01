import { applicationUserId, type ApplicationUserId } from "@/lib/runtime/application-user";
import type { D1Database, D1PreparedStatement } from "@/lib/runtime/d1";
import {
  integrationAccountId,
  normalizeIntegrationProvider,
  normalizeIntegrationScopes,
  type EncryptedIntegrationCredential,
  type IntegrationAccount,
  type IntegrationAccountId,
  type IntegrationAccountStatus,
  type IntegrationCredentialBundle,
  type IntegrationProvider,
} from "@/lib/runtime/integration-account";
import {
  AesGcmIntegrationCredentialCipher,
  type IntegrationCredentialContext,
} from "@/lib/server/integration-credential-crypto";

type AccountRow = Readonly<{
  integration_id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  display_email: string | null;
  status: IntegrationAccountStatus;
  scopes_json: string;
  access_token_expires_at: string | null;
  last_successful_sync_at: string | null;
  next_sync_at: string | null;
  consecutive_failures: number;
  last_error_code: string | null;
  last_error_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}>;

type CredentialRow = Readonly<{
  algorithm: "AES-256-GCM";
  key_version: number;
  format_version: 1;
  nonce_b64u: string;
  ciphertext_b64u: string;
}>;

const accountColumns = `
  integration_id, user_id, provider, provider_account_id, display_email, status,
  scopes_json, access_token_expires_at, last_successful_sync_at, next_sync_at,
  consecutive_failures, last_error_code, last_error_at, disconnected_at,
  created_at, updated_at
`;

function accountFromRow(row: AccountRow): IntegrationAccount {
  let scopes: unknown;
  try {
    scopes = JSON.parse(row.scopes_json);
  } catch {
    throw new Error("Integration account scopes are invalid.");
  }
  if (!Array.isArray(scopes) || scopes.some((value) => typeof value !== "string")) {
    throw new Error("Integration account scopes are invalid.");
  }
  return {
    integrationId: integrationAccountId(row.integration_id),
    userId: applicationUserId(row.user_id),
    provider: normalizeIntegrationProvider(row.provider),
    providerAccountId: row.provider_account_id,
    displayEmail: row.display_email,
    status: row.status,
    scopes: normalizeIntegrationScopes(scopes),
    accessTokenExpiresAt: row.access_token_expires_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    nextSyncAt: row.next_sync_at,
    consecutiveFailures: row.consecutive_failures,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nonEmpty(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function optionalEmail(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error("Integration account email is invalid.");
  }
  return normalized;
}

function optionalTimestamp(value: string | null | undefined, label: string): string | null {
  if (value == null || !value.trim()) return null;
  const normalized = value.trim();
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function envelope(row: CredentialRow): EncryptedIntegrationCredential {
  return {
    algorithm: row.algorithm,
    keyVersion: row.key_version,
    formatVersion: row.format_version,
    nonceB64u: row.nonce_b64u,
    ciphertextB64u: row.ciphertext_b64u,
  };
}

export class D1IntegrationAccountRepository {
  constructor(
    private readonly database: D1Database,
    private readonly cipher: AesGcmIntegrationCredentialCipher,
  ) {}

  private async requireActiveUser(userId: ApplicationUserId): Promise<void> {
    const row = await this.database.prepare(
      "SELECT user_id FROM users WHERE user_id=? AND status='ACTIVE'",
    ).bind(userId).first<{ user_id: string }>();
    if (!row) throw new Error("DCC user access denied.");
  }

  private context(
    userId: ApplicationUserId,
    integrationId: IntegrationAccountId,
    provider: IntegrationProvider,
  ): IntegrationCredentialContext {
    return { userId, integrationId, provider };
  }

  async create(input: Readonly<{
    integrationId: IntegrationAccountId;
    userId: ApplicationUserId;
    provider: IntegrationProvider;
    providerAccountId: string;
    displayEmail?: string | null;
    scopes: readonly string[];
    accessTokenExpiresAt?: string | null;
    credentials: IntegrationCredentialBundle;
    now: string;
  }>): Promise<IntegrationAccount> {
    await this.requireActiveUser(input.userId);
    const integrationId = integrationAccountId(input.integrationId);
    const provider = normalizeIntegrationProvider(input.provider);
    const providerAccountId = nonEmpty(input.providerAccountId, "Provider account ID", 255);
    const displayEmail = optionalEmail(input.displayEmail);
    const scopes = normalizeIntegrationScopes(input.scopes);
    const accessTokenExpiresAt = optionalTimestamp(
      input.accessTokenExpiresAt,
      "Access token expiry",
    );
    const now = optionalTimestamp(input.now, "Integration timestamp");
    if (!now) throw new Error("Integration timestamp is invalid.");

    const encrypted = await this.cipher.encrypt(
      this.context(input.userId, integrationId, provider),
      input.credentials,
    );

    const statements: D1PreparedStatement[] = [
      this.database.prepare(`INSERT INTO integration_accounts (
        integration_id, user_id, provider, provider_account_id, display_email, status,
        scopes_json, access_token_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`).bind(
        integrationId,
        input.userId,
        provider,
        providerAccountId,
        displayEmail,
        JSON.stringify(scopes),
        accessTokenExpiresAt,
        now,
        now,
      ),
      this.database.prepare(`INSERT INTO integration_credentials (
        integration_id, algorithm, key_version, format_version,
        nonce_b64u, ciphertext_b64u, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        integrationId,
        encrypted.algorithm,
        encrypted.keyVersion,
        encrypted.formatVersion,
        encrypted.nonceB64u,
        encrypted.ciphertextB64u,
        now,
        now,
      ),
    ];

    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new Error("Integration account persistence failed.");
    }
    const created = await this.get(input.userId, integrationId);
    if (!created) throw new Error("Integration account persistence failed.");
    return created;
  }

  async get(
    userId: ApplicationUserId,
    integrationId: IntegrationAccountId,
  ): Promise<IntegrationAccount | null> {
    await this.requireActiveUser(userId);
    const id = integrationAccountId(integrationId);
    const row = await this.database.prepare(
      `SELECT ${accountColumns} FROM integration_accounts
       WHERE user_id=? AND integration_id=?`,
    ).bind(userId, id).first<AccountRow>();
    return row ? accountFromRow(row) : null;
  }

  async list(userId: ApplicationUserId): Promise<IntegrationAccount[]> {
    await this.requireActiveUser(userId);
    const result = await this.database.prepare(
      `SELECT ${accountColumns} FROM integration_accounts
       WHERE user_id=? ORDER BY provider, display_email, integration_id`,
    ).bind(userId).all<AccountRow>();
    if (!result.success) throw new Error("Integration account read failed.");
    return (result.results ?? []).map(accountFromRow);
  }

  async readCredentials(
    userId: ApplicationUserId,
    integrationId: IntegrationAccountId,
  ): Promise<IntegrationCredentialBundle> {
    const account = await this.get(userId, integrationId);
    if (!account || account.status === "DISCONNECTED") {
      throw new Error("Integration account access denied.");
    }
    const row = await this.database.prepare(`SELECT
      c.algorithm, c.key_version, c.format_version, c.nonce_b64u, c.ciphertext_b64u
      FROM integration_credentials c
      JOIN integration_accounts a ON a.integration_id=c.integration_id
      WHERE a.user_id=? AND a.integration_id=?`)
      .bind(userId, integrationId)
      .first<CredentialRow>();
    if (!row) throw new Error("Integration credentials are unavailable.");
    return this.cipher.decrypt(
      this.context(userId, integrationId, account.provider),
      envelope(row),
    );
  }

  async replaceCredentials(input: Readonly<{
    userId: ApplicationUserId;
    integrationId: IntegrationAccountId;
    credentials: IntegrationCredentialBundle;
    accessTokenExpiresAt?: string | null;
    now: string;
  }>): Promise<void> {
    const account = await this.get(input.userId, input.integrationId);
    if (!account) {
      throw new Error("Integration account access denied.");
    }
    // Credential replacement is also the explicit reconnect path for an owned
    // disconnected account. The metadata update below reactivates the account
    // only after a new authenticated credential envelope is ready to persist.
    const now = optionalTimestamp(input.now, "Integration timestamp");
    if (!now) throw new Error("Integration timestamp is invalid.");
    const accessTokenExpiresAt = optionalTimestamp(
      input.accessTokenExpiresAt,
      "Access token expiry",
    );
    const encrypted = await this.cipher.encrypt(
      this.context(input.userId, input.integrationId, account.provider),
      input.credentials,
    );
    const results = await this.database.batch([
      this.database.prepare(`INSERT INTO integration_credentials (
        integration_id, algorithm, key_version, format_version,
        nonce_b64u, ciphertext_b64u, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(integration_id) DO UPDATE SET
        algorithm=excluded.algorithm,
        key_version=excluded.key_version,
        format_version=excluded.format_version,
        nonce_b64u=excluded.nonce_b64u,
        ciphertext_b64u=excluded.ciphertext_b64u,
        updated_at=excluded.updated_at`).bind(
        input.integrationId,
        encrypted.algorithm,
        encrypted.keyVersion,
        encrypted.formatVersion,
        encrypted.nonceB64u,
        encrypted.ciphertextB64u,
        account.createdAt,
        now,
      ),
      this.database.prepare(`UPDATE integration_accounts SET
        status='ACTIVE',
        access_token_expires_at=?,
        consecutive_failures=0,
        last_error_code=NULL,
        last_error_at=NULL,
        disconnected_at=NULL,
        updated_at=?
       WHERE user_id=? AND integration_id=?`).bind(
        accessTokenExpiresAt,
        now,
        input.userId,
        input.integrationId,
      ),
    ]);
    if (results.some((result) => !result.success)) {
      throw new Error("Integration credential persistence failed.");
    }
  }

  async recordSyncSuccess(input: Readonly<{
    userId: ApplicationUserId;
    integrationId: IntegrationAccountId;
    completedAt: string;
    nextSyncAt?: string | null;
  }>): Promise<void> {
    const account = await this.get(input.userId, input.integrationId);
    if (!account || account.status === "DISCONNECTED") {
      throw new Error("Integration account access denied.");
    }
    const completedAt = optionalTimestamp(input.completedAt, "Sync completion time");
    if (!completedAt) throw new Error("Sync completion time is invalid.");
    const nextSyncAt = optionalTimestamp(input.nextSyncAt, "Next sync time");
    const result = await this.database.prepare(`UPDATE integration_accounts SET
      status='ACTIVE',
      last_successful_sync_at=?,
      next_sync_at=?,
      consecutive_failures=0,
      last_error_code=NULL,
      last_error_at=NULL,
      updated_at=?
     WHERE user_id=? AND integration_id=?`).bind(
      completedAt,
      nextSyncAt,
      completedAt,
      input.userId,
      input.integrationId,
    ).run();
    if (!result.success) throw new Error("Integration health persistence failed.");
  }

  async recordSyncFailure(input: Readonly<{
    userId: ApplicationUserId;
    integrationId: IntegrationAccountId;
    failedAt: string;
    errorCode: string;
    reauthRequired?: boolean;
    nextSyncAt?: string | null;
  }>): Promise<void> {
    const account = await this.get(input.userId, input.integrationId);
    if (!account || account.status === "DISCONNECTED") {
      throw new Error("Integration account access denied.");
    }
    const failedAt = optionalTimestamp(input.failedAt, "Sync failure time");
    if (!failedAt) throw new Error("Sync failure time is invalid.");
    const nextSyncAt = optionalTimestamp(input.nextSyncAt, "Next sync time");
    const errorCode = nonEmpty(input.errorCode, "Integration error code", 80);
    const status: IntegrationAccountStatus = input.reauthRequired
      ? "REAUTH_REQUIRED"
      : "ERROR";
    const result = await this.database.prepare(`UPDATE integration_accounts SET
      status=?,
      next_sync_at=?,
      consecutive_failures=consecutive_failures+1,
      last_error_code=?,
      last_error_at=?,
      updated_at=?
     WHERE user_id=? AND integration_id=?`).bind(
      status,
      nextSyncAt,
      errorCode,
      failedAt,
      failedAt,
      input.userId,
      input.integrationId,
    ).run();
    if (!result.success) throw new Error("Integration health persistence failed.");
  }

  async disconnect(
    userId: ApplicationUserId,
    integrationId: IntegrationAccountId,
    disconnectedAt: string,
  ): Promise<void> {
    const account = await this.get(userId, integrationId);
    if (!account) throw new Error("Integration account access denied.");
    if (account.status === "DISCONNECTED") return;
    const at = optionalTimestamp(disconnectedAt, "Disconnect time");
    if (!at) throw new Error("Disconnect time is invalid.");
    const results = await this.database.batch([
      this.database.prepare(
        "DELETE FROM integration_credentials WHERE integration_id=?",
      ).bind(integrationId),
      this.database.prepare(`UPDATE integration_accounts SET
        status='DISCONNECTED',
        access_token_expires_at=NULL,
        next_sync_at=NULL,
        disconnected_at=?,
        updated_at=?
       WHERE user_id=? AND integration_id=?`).bind(
        at,
        at,
        userId,
        integrationId,
      ),
    ]);
    if (results.some((result) => !result.success)) {
      throw new Error("Integration disconnect failed.");
    }
  }
}

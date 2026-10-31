PRAGMA foreign_keys = ON;

CREATE TABLE integration_accounts (
  integration_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('GOOGLE')),
  provider_account_id TEXT NOT NULL,
  display_email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REAUTH_REQUIRED','ERROR','DISCONNECTED')),
  scopes_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  access_token_expires_at TEXT,
  last_successful_sync_at TEXT,
  next_sync_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  last_error_code TEXT,
  last_error_at TEXT,
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_account_id),
  CHECK (length(integration_id) BETWEEN 8 AND 160),
  CHECK (length(provider_account_id) BETWEEN 1 AND 255),
  CHECK (display_email IS NULL OR length(display_email) BETWEEN 3 AND 320),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 80),
  CHECK (
    (status = 'DISCONNECTED' AND disconnected_at IS NOT NULL)
    OR
    (status <> 'DISCONNECTED' AND disconnected_at IS NULL)
  )
) STRICT;

CREATE INDEX integration_accounts_user_provider
  ON integration_accounts(user_id, provider, status);

CREATE INDEX integration_accounts_due
  ON integration_accounts(status, next_sync_at)
  WHERE next_sync_at IS NOT NULL;

CREATE TABLE integration_credentials (
  integration_id TEXT PRIMARY KEY
    REFERENCES integration_accounts(integration_id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_version INTEGER NOT NULL CHECK (key_version BETWEEN 1 AND 2147483647),
  format_version INTEGER NOT NULL DEFAULT 1 CHECK (format_version = 1),
  nonce_b64u TEXT NOT NULL,
  ciphertext_b64u TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(nonce_b64u) BETWEEN 16 AND 32),
  CHECK (length(ciphertext_b64u) BETWEEN 16 AND 32768)
) STRICT;

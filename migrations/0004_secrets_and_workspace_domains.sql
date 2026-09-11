-- Hosted secret metadata contains provider references only, never plaintext values.
CREATE TABLE secret_metadata (
  secret_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('APPLICATION', 'USER', 'WORKSPACE')),
  owner_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_type, owner_id, secret_name),
  CHECK (length(owner_id) > 0 AND length(secret_name) > 0 AND length(provider_reference) > 0)
);
CREATE INDEX secret_metadata_owner_idx ON secret_metadata(owner_type, owner_id);

CREATE TABLE workspace_domain_records (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('CONTENT','DAILY_BRIEF','INDUSTRY_DISCOVERY','NEWSLETTER_EVIDENCE','AUDIENCE_HISTORY','SITEMAP_SNAPSHOT')),
  record_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, domain, record_key)
);
CREATE INDEX workspace_domain_recent_idx ON workspace_domain_records(workspace_id, domain, updated_at DESC);

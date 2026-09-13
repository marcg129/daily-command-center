PRAGMA foreign_keys = ON;

-- Application users are intentionally separate from authentication principals.
-- This lets one durable user retain memberships if an identity provider changes.
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(user_id) BETWEEN 3 AND 160)
) STRICT;

CREATE TABLE user_principals (
  principal_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(principal_id) BETWEEN 3 AND 128),
  CHECK (length(provider) BETWEEN 1 AND 64)
) STRICT;

CREATE INDEX user_principals_user ON user_principals(user_id);

CREATE TABLE workspace_memberships (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, workspace_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX workspace_memberships_workspace_role
  ON workspace_memberships(workspace_id, role, user_id);

-- Existing grants are production data. Backfill one durable legacy user per
-- verified principal and preserve every exact workspace relationship. Current
-- grants were created only by the owner bootstrap workflow, so OWNER is the
-- least-surprising role and preserves the deployed owner's authority.
INSERT INTO users (user_id, status, created_at, updated_at)
SELECT 'legacy:' || principal_id, 'ACTIVE', MIN(created_at), MAX(created_at)
FROM principal_workspace_grants
GROUP BY principal_id;

INSERT INTO user_principals (principal_id, user_id, provider, created_at)
SELECT principal_id, 'legacy:' || principal_id, 'CLOUDFLARE_ACCESS', MIN(created_at)
FROM principal_workspace_grants
GROUP BY principal_id;

INSERT INTO workspace_memberships (user_id, workspace_id, role, created_at, updated_at)
SELECT 'legacy:' || principal_id, workspace_id, 'OWNER', created_at, created_at
FROM principal_workspace_grants;

-- The membership model is the sole authorization source after this migration.
DROP TABLE principal_workspace_grants;

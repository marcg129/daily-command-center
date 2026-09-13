PRAGMA foreign_keys = ON;

-- A membership's workspace_key is the user-facing slot (for example, "personal").
-- The referenced workspace_id remains the exact physical data boundary. Rebuild the
-- table so every membership has exactly one durable slot and a user cannot map two
-- physical workspaces to the same slot.
ALTER TABLE workspace_memberships RENAME TO workspace_memberships_legacy;

CREATE TABLE workspace_memberships (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workspace_key TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, workspace_id),
  UNIQUE (user_id, workspace_key),
  CHECK (length(workspace_key) BETWEEN 1 AND 64),
  CHECK (role IN ('OWNER','MEMBER'))
) WITHOUT ROWID, STRICT;

INSERT INTO workspace_memberships
  (user_id, workspace_id, workspace_key, role, created_at, updated_at)
SELECT
  user_id,
  workspace_id,
  CASE
    WHEN workspace_id = 'personal' THEN 'personal'
    WHEN workspace_id = 'indelitech' THEN 'indelitech'
    ELSE workspace_id
  END,
  role,
  created_at,
  updated_at
FROM workspace_memberships_legacy;

DROP TABLE workspace_memberships_legacy;

-- Roll-up is a relationship between physical workspace instances, not a special
-- global workspace ID. This preserves the existing Indelitech -> Marc Personal
-- behavior while allowing future users to have different Personal instances.
CREATE TABLE workspace_rollups (
  source_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  target_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_workspace_id, target_workspace_id),
  CHECK (source_workspace_id <> target_workspace_id)
) WITHOUT ROWID, STRICT;

INSERT OR IGNORE INTO workspace_rollups (source_workspace_id, target_workspace_id)
SELECT 'indelitech', 'personal'
WHERE EXISTS (SELECT 1 FROM workspaces WHERE workspace_id = 'indelitech')
  AND EXISTS (SELECT 1 FROM workspaces WHERE workspace_id = 'personal');

-- Replace the original hard-coded Indelitech/Personal trigger with a physical
-- workspace-instance rule. A task may be visible in its owner or an explicitly
-- configured roll-up target only.
DROP TRIGGER IF EXISTS task_visibility_policy_insert;

CREATE TRIGGER task_visibility_policy_insert
BEFORE INSERT ON task_visibility
WHEN NOT EXISTS (
  SELECT 1
  FROM tasks t
  WHERE t.task_id = NEW.task_id
    AND (
      t.primary_workspace_id = NEW.workspace_id
      OR EXISTS (
        SELECT 1
        FROM workspace_rollups r
        WHERE r.source_workspace_id = t.primary_workspace_id
          AND r.target_workspace_id = NEW.workspace_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Task visibility violates workspace policy');
END;

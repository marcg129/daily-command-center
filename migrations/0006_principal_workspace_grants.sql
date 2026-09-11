PRAGMA foreign_keys = ON;

CREATE TABLE principal_workspace_grants (
  principal_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (principal_id, workspace_id),
  CHECK (length(principal_id) BETWEEN 3 AND 128),
  CHECK (workspace_id IN ('personal','indelitech'))
) WITHOUT ROWID, STRICT;

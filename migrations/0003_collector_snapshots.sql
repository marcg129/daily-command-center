PRAGMA foreign_keys = ON;

CREATE TABLE collector_snapshots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  collector TEXT NOT NULL,
  scope TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, collector, scope)
) WITHOUT ROWID, STRICT;

CREATE INDEX collector_snapshots_latest ON collector_snapshots(workspace_id, collector, checked_at DESC);


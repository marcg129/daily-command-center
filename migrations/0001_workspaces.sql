PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_type TEXT NOT NULL,
  theme_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO workspaces (workspace_id, name, workspace_type, theme_key, created_at, updated_at) VALUES
  ('personal', 'Personal', 'PERSONAL', 'personal-tech-blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('indelitech', 'Indelitech', 'BUSINESS', 'indelitech-business', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);


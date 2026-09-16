CREATE TABLE todoist_ingress_control (
  integration_key TEXT PRIMARY KEY,
  rotation_offset INTEGER NOT NULL DEFAULT 0 CHECK (rotation_offset >= 0),
  cooldown_until_ms INTEGER CHECK (cooldown_until_ms IS NULL OR cooldown_until_ms >= 0),
  updated_at TEXT NOT NULL
) STRICT;

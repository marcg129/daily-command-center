CREATE TABLE todoist_ingress_control (
  integration_key TEXT PRIMARY KEY,
  cursor_added_at TEXT,
  cursor_task_id TEXT,
  cursor_run_started_ms INTEGER NOT NULL DEFAULT 0 CHECK (cursor_run_started_ms >= 0),
  cooldown_until_ms INTEGER CHECK (cooldown_until_ms IS NULL OR cooldown_until_ms >= 0),
  updated_at TEXT NOT NULL,
  CHECK ((cursor_added_at IS NULL) = (cursor_task_id IS NULL))
) STRICT;

PRAGMA foreign_keys = ON;

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  primary_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  context TEXT,
  category TEXT,
  project TEXT,
  person TEXT,
  type TEXT NOT NULL CHECK (type IN ('ONE_TIME','DEADLINE','FOLLOW_UP','WAITING','RECURRING','BACKLOG')),
  priority TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','WAITING','DONE','CANCELLED')),
  due_at TEXT,
  due_is_date_only INTEGER NOT NULL DEFAULT 0 CHECK (due_is_date_only IN (0,1)),
  remind_at TEXT,
  follow_up_at TEXT,
  estimated_duration INTEGER CHECK (estimated_duration IS NULL OR estimated_duration >= 0),
  recurrence TEXT,
  series_id TEXT,
  recurrence_anchor_day INTEGER CHECK (recurrence_anchor_day IS NULL OR recurrence_anchor_day BETWEEN 1 AND 31),
  dependency TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  source TEXT NOT NULL,
  source_context TEXT,
  last_notified_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (due_is_date_only = 0 OR (due_at IS NOT NULL AND length(due_at) = 10))
) STRICT;

CREATE TABLE task_visibility (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, workspace_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX tasks_primary_workspace_status_due ON tasks(primary_workspace_id, status, due_at);
CREATE INDEX task_visibility_workspace_task ON task_visibility(workspace_id, task_id);

-- V1 content-sharing policy. It is intentionally independent from future secret ownership.
CREATE TRIGGER task_visibility_policy_insert BEFORE INSERT ON task_visibility
WHEN NOT EXISTS (
  SELECT 1 FROM tasks t WHERE t.task_id = NEW.task_id AND
    (t.primary_workspace_id = NEW.workspace_id OR (t.primary_workspace_id = 'indelitech' AND NEW.workspace_id = 'personal'))
)
BEGIN SELECT RAISE(ABORT, 'invalid task visibility'); END;

CREATE TRIGGER task_primary_workspace_immutable BEFORE UPDATE OF primary_workspace_id ON tasks
BEGIN SELECT RAISE(ABORT, 'task primary workspace is immutable'); END;

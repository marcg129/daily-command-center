PRAGMA foreign_keys = ON;

CREATE TABLE intake_items (
  intake_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  workspace_key TEXT NOT NULL CHECK (workspace_key IN ('personal','indelitech')),
  intake_type TEXT NOT NULL CHECK (intake_type IN ('TASK','FOLLOW_UP','BILL','AWARENESS')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','DEFERRED','APPROVED','DISMISSED','ARCHIVED')),
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail','calendar')),
  source_key TEXT NOT NULL CHECK (source_key IN (
    'personal_gmail','professional_gmail','indelitech_gmail','primary_calendar','family_calendar'
  )),
  source_message_id TEXT,
  source_thread_id TEXT,
  source_event_id TEXT,
  source_series_id TEXT,
  proposal_ordinal INTEGER NOT NULL CHECK (proposal_ordinal >= 1),
  source_timestamp TEXT NOT NULL,
  source_sender TEXT CHECK (source_sender IS NULL OR length(source_sender) <= 500),
  source_subject TEXT CHECK (source_subject IS NULL OR length(source_subject) <= 1000),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  source_summary TEXT NOT NULL CHECK (length(trim(source_summary)) BETWEEN 1 AND 4000),
  classification_reason TEXT NOT NULL CHECK (length(trim(classification_reason)) BETWEEN 1 AND 3000),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  due_date TEXT CHECK (
    due_date IS NULL OR
    (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
  ),
  follow_up_at TEXT,
  priority TEXT CHECK (priority IS NULL OR priority IN ('LOW','MEDIUM','HIGH')),
  amount_minor INTEGER CHECK (
    amount_minor IS NULL OR
    (amount_minor >= 0 AND amount_minor <= 9007199254740991)
  ),
  currency TEXT CHECK (currency IS NULL OR currency GLOB '[A-Z][A-Z][A-Z]'),
  target_payload_json TEXT NOT NULL DEFAULT '{}',
  semantic_key TEXT NOT NULL CHECK (length(trim(semantic_key)) BETWEEN 1 AND 2200),
  scan_run_id TEXT NOT NULL CHECK (length(trim(scan_run_id)) BETWEEN 1 AND 200),
  defer_until TEXT,
  approved_target_kind TEXT CHECK (approved_target_kind IS NULL OR approved_target_kind IN ('TASK','BILL')),
  approved_target_id TEXT,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (user_id, semantic_key),

  CHECK (
    (source_type = 'gmail'
      AND source_key IN ('personal_gmail','professional_gmail','indelitech_gmail')
      AND source_message_id IS NOT NULL
      AND source_event_id IS NULL)
    OR
    (source_type = 'calendar'
      AND source_key IN ('primary_calendar','family_calendar')
      AND source_event_id IS NOT NULL
      AND source_message_id IS NULL
      AND source_thread_id IS NULL)
  ),
  CHECK ((amount_minor IS NULL) = (currency IS NULL)),
  CHECK (intake_type = 'BILL' OR (amount_minor IS NULL AND currency IS NULL)),
  CHECK (
    (status = 'APPROVED' AND approved_target_kind IS NOT NULL AND approved_target_id IS NOT NULL)
    OR
    (status <> 'APPROVED' AND approved_target_kind IS NULL AND approved_target_id IS NULL)
  )
) STRICT;

CREATE INDEX intake_items_user_workspace_status
  ON intake_items(user_id, workspace_id, status, defer_until, created_at DESC);

CREATE INDEX intake_items_user_source_identity
  ON intake_items(user_id, source_key, source_message_id, source_event_id, proposal_ordinal);

CREATE TABLE projected_calendar_events (
  projection_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  google_event_id TEXT NOT NULL CHECK (length(trim(google_event_id)) BETWEEN 1 AND 1024),
  series_id TEXT CHECK (series_id IS NULL OR length(series_id) <= 1024),
  occurrence_id TEXT CHECK (occurrence_id IS NULL OR length(occurrence_id) <= 1024),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL CHECK (all_day IN (0,1)),
  location TEXT CHECK (location IS NULL OR length(location) <= 1000),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  automatic_workspace_key TEXT
    CHECK (automatic_workspace_key IS NULL OR automatic_workspace_key IN ('personal','indelitech')),
  projection_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (projection_status IN ('ACTIVE','REMOVED','CANCELLED')),
  last_seen_scan_run_id TEXT NOT NULL CHECK (length(trim(last_seen_scan_run_id)) BETWEEN 1 AND 200),
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (user_id, source_key, google_event_id),
  CHECK (
    (projection_status = 'ACTIVE' AND removed_at IS NULL)
    OR
    (projection_status IN ('REMOVED','CANCELLED'))
  )
) STRICT;

CREATE INDEX projected_calendar_events_user_window
  ON projected_calendar_events(user_id, projection_status, starts_at, source_key, google_event_id);

CREATE INDEX projected_calendar_events_user_series
  ON projected_calendar_events(user_id, source_key, series_id, starts_at);

CREATE TABLE calendar_workspace_overrides (
  override_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  scope TEXT NOT NULL CHECK (scope IN ('SERIES','OCCURRENCE')),
  target_id TEXT NOT NULL CHECK (length(trim(target_id)) BETWEEN 1 AND 1024),
  workspace_key TEXT NOT NULL CHECK (workspace_key IN ('personal','indelitech')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source_key, scope, target_id)
) STRICT;

CREATE INDEX calendar_workspace_overrides_lookup
  ON calendar_workspace_overrides(user_id, source_key, scope, target_id);

CREATE TABLE calendar_sync_runs (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  scan_run_id TEXT NOT NULL CHECK (length(trim(scan_run_id)) BETWEEN 1 AND 200),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  expected_batch_count INTEGER NOT NULL CHECK (expected_batch_count BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETE')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, source_key, scan_run_id),
  CHECK (
    (status = 'OPEN' AND completed_at IS NULL)
    OR
    (status = 'COMPLETE' AND completed_at IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;

CREATE TABLE calendar_sync_batches (
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  scan_run_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL CHECK (batch_index BETWEEN 1 AND 1000),
  received_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key, scan_run_id, batch_index),
  FOREIGN KEY (user_id, source_key, scan_run_id)
    REFERENCES calendar_sync_runs(user_id, source_key, scan_run_id) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;

CREATE TABLE daily_intake_source_status (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN (
    'personal_gmail','professional_gmail','indelitech_gmail','primary_calendar','family_calendar'
  )),
  state TEXT NOT NULL CHECK (state IN ('SUCCESS','FAILED')),
  scan_run_id TEXT NOT NULL CHECK (length(trim(scan_run_id)) BETWEEN 1 AND 200),
  last_attempt_at TEXT NOT NULL,
  last_successful_at TEXT,
  diagnostic TEXT CHECK (diagnostic IS NULL OR length(diagnostic) <= 1000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key),
  CHECK (state <> 'SUCCESS' OR last_successful_at IS NOT NULL)
) WITHOUT ROWID, STRICT;

ALTER TABLE bills
  ADD COLUMN source_intake_id TEXT REFERENCES intake_items(intake_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX bills_source_intake_uidx
  ON bills(source_intake_id) WHERE source_intake_id IS NOT NULL;

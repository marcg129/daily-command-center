PRAGMA foreign_keys = ON;

ALTER TABLE intake_items RENAME TO intake_items_legacy;

CREATE TABLE intake_items (
  intake_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workspace_key TEXT NOT NULL CHECK (workspace_key IN ('personal','indelitech')),
  intake_type TEXT NOT NULL CHECK (intake_type IN ('TASK','FOLLOW_UP','BILL','AWARENESS')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','DEFERRED','APPROVED','DISMISSED','ARCHIVED')),
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail','calendar','chat')),
  source_key TEXT NOT NULL CHECK (source_key IN (
    'personal_gmail','professional_gmail','indelitech_gmail','primary_calendar','family_calendar','chat_history'
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
  target_payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_payload_json)),
  semantic_key TEXT NOT NULL CHECK (length(trim(semantic_key)) BETWEEN 1 AND 2200),
  scan_run_id TEXT NOT NULL CHECK (length(trim(scan_run_id)) BETWEEN 1 AND 200),
  user_edited_at TEXT,
  defer_until TEXT,
  approved_target_kind TEXT CHECK (approved_target_kind IS NULL OR approved_target_kind IN ('TASK','BILL')),
  approved_target_id TEXT,
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
    OR
    (source_type = 'chat'
      AND source_key = 'chat_history'
      AND source_message_id IS NOT NULL
      AND source_event_id IS NULL
      AND source_series_id IS NULL)
  ),
  CHECK ((amount_minor IS NULL) = (currency IS NULL)),
  CHECK (intake_type = 'BILL' OR (amount_minor IS NULL AND currency IS NULL)),
  CHECK (
    (status = 'APPROVED' AND approved_target_kind IS NOT NULL AND approved_target_id IS NOT NULL)
    OR
    (status <> 'APPROVED' AND approved_target_kind IS NULL AND approved_target_id IS NULL)
  )
) STRICT;

INSERT INTO intake_items (
  intake_id, user_id, workspace_id, workspace_key, intake_type, status, source_type, source_key,
  source_message_id, source_thread_id, source_event_id, source_series_id, proposal_ordinal, source_timestamp,
  source_sender, source_subject, source_url, source_summary, classification_reason, title, due_date, follow_up_at,
  priority, amount_minor, currency, target_payload_json, semantic_key, scan_run_id, user_edited_at, defer_until,
  approved_target_kind, approved_target_id, created_at, updated_at
)
SELECT
  intake_id, user_id, workspace_id, workspace_key, intake_type, status, source_type, source_key,
  source_message_id, source_thread_id, source_event_id, source_series_id, proposal_ordinal, source_timestamp,
  source_sender, source_subject, source_url, source_summary, classification_reason, title, due_date, follow_up_at,
  priority, amount_minor, currency, target_payload_json, semantic_key, scan_run_id, user_edited_at, defer_until,
  approved_target_kind, approved_target_id, created_at, updated_at
FROM intake_items_legacy;

DROP TABLE intake_items_legacy;

CREATE INDEX intake_items_user_workspace_status
  ON intake_items(user_id, workspace_id, status, defer_until, created_at DESC);

CREATE INDEX intake_items_user_source_identity
  ON intake_items(user_id, source_key, source_message_id, source_event_id, proposal_ordinal);

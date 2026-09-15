PRAGMA foreign_keys = ON;

CREATE TABLE bills (
  bill_id TEXT PRIMARY KEY,
  primary_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  payee TEXT CHECK (payee IS NULL OR length(payee) <= 200),
  category TEXT CHECK (category IS NULL OR length(category) <= 100),
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('FIXED','VARIABLE')),
  default_amount_minor INTEGER CHECK (
    default_amount_minor IS NULL OR
    (default_amount_minor >= 0 AND default_amount_minor <= 9007199254740991)
  ),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  autopay INTEGER NOT NULL DEFAULT 0 CHECK (autopay IN (0,1)),
  payment_url TEXT CHECK (payment_url IS NULL OR length(payment_url) <= 2048),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 10000),
  schedule_start_date TEXT NOT NULL
    CHECK (length(schedule_start_date) = 10 AND schedule_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recurrence_unit TEXT NOT NULL CHECK (recurrence_unit IN ('NONE','WEEK','MONTH','YEAR')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 120),
  recurrence_day_mode TEXT
    CHECK (recurrence_day_mode IS NULL OR recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY')),
  reminder_days_before INTEGER
    CHECK (reminder_days_before IS NULL OR reminder_days_before BETWEEN 0 AND 365),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  CHECK (amount_mode = 'VARIABLE' OR default_amount_minor IS NOT NULL),
  CHECK (recurrence_unit <> 'NONE' OR recurrence_interval = 1),
  CHECK (
    (recurrence_unit IN ('NONE','WEEK') AND recurrence_day_mode IS NULL)
    OR
    (recurrence_unit IN ('MONTH','YEAR')
      AND recurrence_day_mode IS NOT NULL
      AND recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY'))
  )
) STRICT;

CREATE TABLE bill_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  due_date TEXT NOT NULL
    CHECK (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expected_amount_minor INTEGER CHECK (
    expected_amount_minor IS NULL OR
    (expected_amount_minor >= 0 AND expected_amount_minor <= 9007199254740991)
  ),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','PAID','SKIPPED','CANCELLED')),
  paid_amount_minor INTEGER CHECK (
    paid_amount_minor IS NULL OR
    (paid_amount_minor >= 0 AND paid_amount_minor <= 9007199254740991)
  ),
  paid_on TEXT CHECK (
    paid_on IS NULL OR
    (length(paid_on) = 10 AND paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
  ),
  resolved_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (bill_id, due_date),

  CHECK (
    (status = 'OPEN'
      AND paid_amount_minor IS NULL
      AND paid_on IS NULL
      AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL
      AND resolution_note IS NULL)
    OR
    (status = 'PAID'
      AND paid_on IS NOT NULL
      AND resolved_at IS NOT NULL)
    OR
    (status IN ('SKIPPED','CANCELLED')
      AND paid_amount_minor IS NULL
      AND paid_on IS NULL
      AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX bills_workspace_status_name
  ON bills(primary_workspace_id, status, name);

CREATE INDEX bill_occurrences_bill_due
  ON bill_occurrences(bill_id, due_date);

CREATE INDEX bill_occurrences_status_due
  ON bill_occurrences(status, due_date);

CREATE TRIGGER bill_primary_workspace_immutable
BEFORE UPDATE OF primary_workspace_id ON bills
WHEN NEW.primary_workspace_id <> OLD.primary_workspace_id
BEGIN
  SELECT RAISE(ABORT, 'Bill primary workspace is immutable');
END;

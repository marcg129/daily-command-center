PRAGMA foreign_keys = ON;

CREATE TABLE income_sources (
  income_source_id TEXT PRIMARY KEY,
  primary_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  payer TEXT CHECK (payer IS NULL OR length(payer) <= 200),
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('FIXED','VARIABLE')),
  default_net_amount_minor INTEGER CHECK (
    default_net_amount_minor IS NULL OR
    (default_net_amount_minor >= 0 AND default_net_amount_minor <= 9007199254740991)
  ),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  schedule_start_date TEXT NOT NULL
    CHECK (length(schedule_start_date) = 10 AND schedule_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recurrence_unit TEXT NOT NULL
    CHECK (recurrence_unit IN ('NONE','WEEK','MONTH','YEAR','SEMIMONTH')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 120),
  recurrence_day_mode TEXT
    CHECK (recurrence_day_mode IS NULL OR recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY')),
  semimonth_day_one INTEGER
    CHECK (semimonth_day_one IS NULL OR semimonth_day_one BETWEEN 1 AND 27),
  semimonth_day_two INTEGER
    CHECK (semimonth_day_two IS NULL OR semimonth_day_two BETWEEN 2 AND 31),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  CHECK (amount_mode = 'VARIABLE' OR default_net_amount_minor IS NOT NULL),
  CHECK (
    (recurrence_unit = 'NONE'
      AND recurrence_interval = 1
      AND recurrence_day_mode IS NULL
      AND semimonth_day_one IS NULL
      AND semimonth_day_two IS NULL)
    OR
    (recurrence_unit = 'WEEK'
      AND recurrence_day_mode IS NULL
      AND semimonth_day_one IS NULL
      AND semimonth_day_two IS NULL)
    OR
    (recurrence_unit IN ('MONTH','YEAR')
      AND recurrence_day_mode IS NOT NULL
      AND recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY')
      AND semimonth_day_one IS NULL
      AND semimonth_day_two IS NULL)
    OR
    (recurrence_unit = 'SEMIMONTH'
      AND recurrence_interval = 1
      AND recurrence_day_mode IS NULL
      AND semimonth_day_one IS NOT NULL
      AND semimonth_day_two IS NOT NULL
      AND semimonth_day_one < semimonth_day_two)
  )
) STRICT;

CREATE TABLE income_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  income_source_id TEXT NOT NULL REFERENCES income_sources(income_source_id) ON DELETE CASCADE,
  pay_date TEXT NOT NULL
    CHECK (length(pay_date) = 10 AND pay_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expected_amount_minor INTEGER CHECK (
    expected_amount_minor IS NULL OR
    (expected_amount_minor >= 0 AND expected_amount_minor <= 9007199254740991)
  ),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  status TEXT NOT NULL DEFAULT 'EXPECTED'
    CHECK (status IN ('EXPECTED','RECEIVED','SKIPPED','CANCELLED')),
  received_amount_minor INTEGER CHECK (
    received_amount_minor IS NULL OR
    (received_amount_minor >= 0 AND received_amount_minor <= 9007199254740991)
  ),
  received_on TEXT CHECK (
    received_on IS NULL OR
    (length(received_on) = 10 AND received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
  ),
  resolved_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (income_source_id, pay_date),

  CHECK (
    (status = 'EXPECTED'
      AND received_amount_minor IS NULL
      AND received_on IS NULL
      AND resolved_by_user_id IS NULL
      AND resolved_at IS NULL
      AND resolution_note IS NULL)
    OR
    (status = 'RECEIVED'
      AND received_on IS NOT NULL
      AND resolved_at IS NOT NULL)
    OR
    (status IN ('SKIPPED','CANCELLED')
      AND received_amount_minor IS NULL
      AND received_on IS NULL
      AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE cashflow_baselines (
  primary_workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL
    CHECK (amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  as_of_date TEXT NOT NULL
    CHECK (length(as_of_date) = 10 AND as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  updated_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX income_sources_workspace_status_name
  ON income_sources(primary_workspace_id, status, name);

CREATE INDEX income_occurrences_source_pay
  ON income_occurrences(income_source_id, pay_date);

CREATE INDEX income_occurrences_status_pay
  ON income_occurrences(status, pay_date);

CREATE TRIGGER income_source_primary_workspace_immutable
BEFORE UPDATE OF primary_workspace_id ON income_sources
WHEN NEW.primary_workspace_id <> OLD.primary_workspace_id
BEGIN
  SELECT RAISE(ABORT, 'Income source primary workspace is immutable');
END;

CREATE TRIGGER cashflow_baseline_workspace_immutable
BEFORE UPDATE OF primary_workspace_id ON cashflow_baselines
WHEN NEW.primary_workspace_id <> OLD.primary_workspace_id
BEGIN
  SELECT RAISE(ABORT, 'Cash-flow baseline workspace is immutable');
END;

# Milestone 1G-D1 — Bills core implementation plan

Date: 2026-09-13

Status: **Execution-ready design. Do not implement/merge until 1G-C is closed and main is rebased/verified.**

This document turns `MILESTONE-1G-D-BILLS-DESIGN.md` into the exact first implementation slice for Bills & Obligations.

## Goal

Deliver only the durable Bills data model, canonical bill/schedule types, validation primitives, and deterministic recurrence engine needed by later Bills APIs and UI.

1G-D1 must be safe to deploy with no Bills UI yet. It should create unused additive tables and pure runtime helpers without changing existing task, calendar, Intel, MCP, or workspace behavior.

## Non-goals

Do **not** add in 1G-D1:

- Bills routes or HTTP handlers;
- a D1 Bill repository;
- bill create/edit UI;
- Today or Calendar bill entries;
- bank/account connections;
- transaction matching;
- automatic bill detection;
- payment execution;
- bill notifications/push transport;
- Household workspace UI;
- ChatGPT bill capture; or
- any Task-table changes.

Those belong to later slices.

## Repository alignment

Current production schema ends at `migrations/0008_workspace_instances.sql`. The next migration is therefore:

`migrations/0009_bills_and_obligations.sql`

Current tests already use Node 24 `node:sqlite` `DatabaseSync` with `PRAGMA foreign_keys=ON` to execute real migration files. 1G-D1 should reuse that proven pattern rather than invent a separate SQL test harness.

Current runtime code also favors small runtime-neutral modules such as `hosted-tasks.ts`, `task-mutations.ts`, `context.ts`, and `primitives.ts`. Bill schedule code should follow that style and remain independent from React, HTTP, Cloudflare bindings, and D1.

## Exact files expected in the first implementation PR

Create:

- `migrations/0009_bills_and_obligations.sql`
- `lib/runtime/bills.ts`
- `lib/runtime/bill-schedule.ts`
- `tests/bills-migration.test.ts`
- `tests/bill-schedule.test.ts`
- `docs/MILESTONE-1G-D1-BILLS-CORE.md` — implementation/validation record produced as the work completes

Avoid modifying unrelated files. `package.json` should not require a new dependency.

## Canonical runtime types

`lib/runtime/bills.ts` should own the canonical enums/types and validation helpers used by both the schedule engine and later repository/API work.

Recommended constants/types:

```ts
export const BILL_AMOUNT_MODES = ["FIXED", "VARIABLE"] as const;
export const BILL_RECURRENCE_UNITS = ["NONE", "WEEK", "MONTH", "YEAR"] as const;
export const BILL_RECURRENCE_DAY_MODES = ["ANCHOR_DATE", "LAST_DAY"] as const;
export const BILL_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const BILL_OCCURRENCE_STATUSES = ["OPEN", "PAID", "SKIPPED", "CANCELLED"] as const;

export type BillAmountMode = (typeof BILL_AMOUNT_MODES)[number];
export type BillRecurrenceUnit = (typeof BILL_RECURRENCE_UNITS)[number];
export type BillRecurrenceDayMode = (typeof BILL_RECURRENCE_DAY_MODES)[number];
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillOccurrenceStatus = (typeof BILL_OCCURRENCE_STATUSES)[number];

export type BillSchedule = Readonly<{
  scheduleStartDate: string; // strict YYYY-MM-DD
  recurrenceUnit: BillRecurrenceUnit;
  recurrenceInterval: number;
  recurrenceDayMode: BillRecurrenceDayMode | null;
}>;

export type BillDefinitionCore = BillSchedule & Readonly<{
  name: string;
  payee: string | null;
  category: string | null;
  amountMode: BillAmountMode;
  defaultAmountMinor: number | null;
  currency: string;
  autopay: boolean;
  paymentUrl: string | null;
  notes: string | null;
  reminderDaysBefore: number | null;
  status: BillStatus;
}>;
```

Do not force a physical workspace ID into `BillDefinitionCore`. Physical ownership is persistence/auth context, not recurrence/business data. 1G-D2 can define stored/view repository records that pair this core with the authorized physical workspace and map back to the logical workspace slot for browser responses.

### Required validation primitives

At minimum expose/test helpers equivalent to:

```ts
validateBillSchedule(schedule: BillSchedule): void;
validateBillDefinitionCore(value: BillDefinitionCore): void;
isDateOnly(value: unknown): value is string;
```

Exact names may vary, but semantics must not.

Validation rules:

- `scheduleStartDate` must be a real calendar date in exact `YYYY-MM-DD` form, not merely a 10-character string.
- `recurrenceInterval` must be an integer from 1 through 120.
- `NONE` requires interval `1` and `recurrenceDayMode = null`.
- `WEEK` requires `recurrenceDayMode = null`.
- `MONTH` and `YEAR` require `ANCHOR_DATE` or `LAST_DAY`.
- `LAST_DAY` requires `scheduleStartDate` itself to be the last day of its anchor month. This keeps the schedule human-readable and prevents ambiguous first occurrences.
- bill name must contain non-whitespace text.
- `FIXED` requires a non-null default amount.
- `VARIABLE` may have a known expected amount or `null`.
- monetary minor-unit values must be non-negative JavaScript safe integers.
- v1 currency accepts uppercase three-letter codes, with UI expected to send `USD`.
- reminder lead time is null or an integer 0..365.
- any later payment URL validation belongs at service/API input boundaries; D1 still applies length/shape constraints.

Do not silently normalize invalid schedules. Reject them.

## Date-only recurrence engine

Create `lib/runtime/bill-schedule.ts` as a pure module with no D1, React, request, or Cloudflare imports.

Recommended public contract:

```ts
export type BillDateRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export function billDueDatesInRange(
  schedule: BillSchedule,
  range: BillDateRange,
): string[];
```

Range boundaries are inclusive.

The function must validate both the schedule and date range. If `endDate < startDate`, reject rather than swap values.

### Core invariant: calculate from the immutable anchor

**Never generate an occurrence by adding the recurrence interval to the previous generated occurrence.**

Every occurrence must be calculated directly from:

`scheduleStartDate + (occurrenceIndex × recurrenceInterval × unit)`

This prevents month-end and leap-year drift.

Required example:

- anchor `2027-01-31`, monthly `ANCHOR_DATE`
- index 0 -> `2027-01-31`
- index 1 -> `2027-02-28`
- index 2 -> `2027-03-31`
- index 3 -> `2027-04-30`
- index 4 -> `2027-05-31`

An iterative algorithm that produces Mar 28 after Feb 28 is incorrect.

### Strict date parser

Implement a small date-only parser rather than relying on permissive `Date.parse`.

Conceptual behavior:

1. match `/^(\d{4})-(\d{2})-(\d{2})$/`;
2. convert parts to integers;
3. validate month 1..12;
4. validate day 1..`daysInMonth(year, month)`;
5. return numeric `{year, month, day}` parts.

This rejects values such as:

- `2026-2-3`
- `2026-02-30`
- `2026-13-01`
- timestamps passed where a date-only value is required.

Use UTC only as an arithmetic implementation detail. Do not convert bill dates through `PRODUCT_TIME_ZONE`, local browser time, or wall-clock timestamps.

### MONTH algorithm

Let:

- anchor year/month/day come from `scheduleStartDate`;
- `absoluteAnchorMonth = year * 12 + (month - 1)`;
- `targetAbsoluteMonth = absoluteAnchorMonth + occurrenceIndex * recurrenceInterval`.

Derive target year/month directly from `targetAbsoluteMonth`.

Then:

- `LAST_DAY`: target day = last calendar day of target month;
- `ANCHOR_DATE`: target day = `min(anchorDay, last calendar day of target month)`.

Do not mutate the anchor day.

### YEAR algorithm

Target year is:

`anchorYear + occurrenceIndex * recurrenceInterval`

Target month remains the anchor month.

Then:

- `LAST_DAY`: use the last day of the anchor month in the target year;
- `ANCHOR_DATE`: `min(anchorDay, lastDay(targetYear, anchorMonth))`.

Therefore a Feb. 29 annual anchor behaves:

- `2024-02-29`
- `2025-02-28`
- `2026-02-28`
- `2027-02-28`
- `2028-02-29`

It must return to the 29th in leap years.

### WEEK algorithm

Use strict date parts and UTC calendar-day arithmetic from the immutable anchor:

`anchor + occurrenceIndex * recurrenceInterval * 7 days`

This preserves weekday without daylight-saving effects because the model is date-only.

### NONE algorithm

A one-time Bill has exactly one candidate occurrence: `scheduleStartDate`.

Return it only when it lies inside the requested inclusive range.

### Efficient range seeking

Do not always loop from occurrence index 0 when the anchor is years before the requested range.

Choose a conservative starting index near `range.startDate`:

- WEEK: estimate from day difference / `(7 * interval)`;
- MONTH: estimate from whole month difference / interval;
- YEAR: estimate from year difference / interval;
- subtract one index from the estimate (clamped to zero) when useful to protect boundary/clamping cases;
- advance until the candidate is >= the requested start.

This allows an old recurring bill to query a current 12-month window without walking every historical occurrence.

### Bounded generation

Use a hard output/candidate guard such as `MAX_BILL_DUE_DATES_PER_RANGE = 512`.

The product horizon is expected to be roughly 12 months, so ordinary schedules are far below that limit. An accidentally gigantic range or malformed recurrence should fail rather than consume unbounded CPU.

The bound must not reject a normal current range merely because the original anchor is old; efficient range seeking is therefore required.

### Ordering and determinism

Return dates:

- ascending;
- unique;
- exact `YYYY-MM-DD` strings;
- never before `scheduleStartDate`; and
- independent of machine timezone.

No random values or current time may be used by this pure function.

## Migration 0009 — exact schema direction

The implementation PR should create `migrations/0009_bills_and_obligations.sql` as an **additive** migration. It does not rebuild existing task/workspace tables.

Recommended migration:

```sql
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
    (recurrence_unit IN ('MONTH','YEAR') AND recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY'))
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
```

### Why `resolved_at` is included

The earlier broad design contained `resolvedByUserId` but no resolution timestamp. Add `resolved_at` now.

A future shared Household needs to answer both **who** resolved a payment and **when** the state was changed. `paid_on` is the financial date chosen by the user and is not the same as the server audit instant. For SKIPPED/CANCELLED there is no paid date at all, so `resolved_at` is especially useful.

`resolved_by_user_id` uses `ON DELETE SET NULL`; therefore SQL must not require that field to remain non-null forever. 1G-D2 service logic should require the authenticated resolver at mutation time, while the database can preserve historical resolution after an application user is later removed.

### SQL vs service validation

SQL checks should protect simple durable invariants, but do not try to express real Gregorian calendar validation or `LAST_DAY` calculations in a complicated CHECK.

The service/runtime validator must reject impossible dates and ensure that a `LAST_DAY` anchor really is the last day of its month before data reaches persistence.

The migration is additive and should not need `PRAGMA defer_foreign_keys` because it does not temporarily violate existing relationships.

## Occurrence identity/materialization contract for later 1G-D2

1G-D1 does not create occurrences through a repository yet, but it must establish these rules so D2 does not revisit identity design:

- occurrence IDs are generated stable IDs (use the existing `IdGenerator` abstraction later), not a hash of bill/date;
- idempotent schedule materialization is enforced by `UNIQUE (bill_id, due_date)`;
- the date remains data, not identity, which leaves room for a future explicit reschedule/override model without changing row IDs;
- occurrence currency is a snapshot copied from the Bill when materialized;
- occurrence expected amount is a snapshot copied from the current expected/default amount when materialized;
- later changes to the Bill do not silently rewrite resolved historical occurrence snapshots.

## 1G-D1 test plan

### `tests/bill-schedule.test.ts`

Use `node:test` + `node:assert/strict`, consistent with the repository.

Required cases:

1. **One-time inside range**
   - anchor `2026-10-15`, NONE
   - range includes date -> exactly one date.

2. **One-time outside range**
   - returns empty.

3. **Ordinary monthly anchor**
   - `2026-01-15` monthly -> Jan 15, Feb 15, Mar 15.

4. **Jan 31 non-leap clamp without drift**
   - `2027-01-31` monthly ANCHOR_DATE -> Jan31, Feb28, Mar31, Apr30, May31.

5. **Jan 31 leap clamp without drift**
   - `2028-01-31` -> Jan31, Feb29, Mar31.

6. **Feb 29 yearly restores leap day**
   - anchor `2024-02-29` yearly -> 2024-02-29, 2025-02-28, 2026-02-28, 2027-02-28, 2028-02-29.

7. **LAST_DAY monthly**
   - anchor `2026-01-31` LAST_DAY -> Jan31, Feb28, Mar31, Apr30.

8. **LAST_DAY annual for February**
   - anchor `2024-02-29` LAST_DAY -> Feb29 2024, Feb28 2025, Feb29 2028 when queried across range.

9. **Every two months**
   - Jan 31 interval 2 -> Jan31, Mar31, May31.

10. **Quarterly**
    - Jan 30 interval 3 -> Jan30, Apr30, Jul30, Oct30.

11. **Semiannual**
    - interval 6.

12. **Every four weeks**
    - WEEK interval 4; verify exact 28-day steps across a DST boundary with no date drift.

13. **Every two years**
    - YEAR interval 2.

14. **Inclusive boundaries**
    - due date exactly equals range start/end and is included.

15. **Range before schedule**
    - returns empty and never emits dates before anchor.

16. **Old anchor efficiently seeks current range**
    - e.g. monthly anchor in 1995 and a 2026 range returns only 2026 dates without hitting generation guard.

17. **Invalid date-only strings reject**
    - malformed format, Feb 30, month 13, timestamp input.

18. **Invalid range rejects**
    - end before start.

19. **Invalid interval rejects**
    - zero, negative, fractional, >120.

20. **Invalid day-mode/unit combinations reject**
    - WEEK + ANCHOR_DATE;
    - NONE + LAST_DAY;
    - MONTH + null.

21. **LAST_DAY requires last-day anchor**
    - Jan 30 + LAST_DAY rejects instead of silently changing first occurrence to Jan 31.

22. **Generation bound**
    - an intentionally huge dense range that would emit >512 dates rejects clearly.

23. **Machine-timezone independence**
    - schedule output is pure date-only logic and does not use `PRODUCT_TIME_ZONE` or process-local time.

### `tests/bills-migration.test.ts`

Use `DatabaseSync(":memory:")`, enable foreign keys, and execute actual migration files through `0009`.

The test helper should apply:

- `0001_workspaces.sql`
- `0002_tasks.sql`
- `0003_collector_snapshots.sql`
- `0004_secrets_and_workspace_domains.sql`
- `0005_task_capture_metadata.sql`
- `0006_principal_workspace_grants.sql`
- `0007_user_workspace_ownership.sql`
- `0008_workspace_instances.sql`
- `0009_bills_and_obligations.sql`

Required cases:

1. `bills` and `bill_occurrences` exist as STRICT tables.
2. expected indexes and immutable-workspace trigger exist.
3. inserting a Bill for a missing workspace fails FK.
4. inserting `created_by_user_id` for a missing user fails FK.
5. an existing arbitrary physical workspace such as `personal:christa` is accepted, proving schema does not hard-code global Personal/Indelitech IDs.
6. whitespace-only Bill name fails.
7. FIXED + null default amount fails.
8. VARIABLE + null default amount succeeds.
9. zero amount succeeds.
10. negative amount fails.
11. amount above JS safe integer fails.
12. lowercase/invalid currency fails.
13. recurrence interval zero, fractional, or >120 fails.
14. NONE with interval !=1 fails.
15. NONE/WEEK with non-null day mode fails.
16. MONTH/YEAR with null day mode fails.
17. Bill primary workspace update fails trigger.
18. occurrence with missing parent Bill fails FK.
19. duplicate occurrence `(bill_id,due_date)` fails.
20. same due date for two different Bills succeeds.
21. OPEN occurrence carrying paid/resolution fields fails.
22. PAID without `paid_on` fails.
23. PAID without `resolved_at` fails.
24. PAID may carry a paid amount that differs from expected amount.
25. SKIPPED/CANCELLED reject paid amount/date but require `resolved_at`.
26. deleting a referenced resolver user sets `resolved_by_user_id` null while preserving resolved occurrence.
27. ARCHIVED Bill retains occurrence history.
28. an explicit physical DELETE of a Bill cascades its occurrences.
29. existing task/workspace rows remain unchanged after applying migration 0009.
30. applying 0009 to a populated 0008 database succeeds without migrating or rewriting existing data.

## Implementation sequence for the future coding session

When 1G-C is complete:

1. Update local `main` / verify GitHub main contains the completed 1G-C merge and no later migration number has been added.
2. If another migration landed first, renumber `0009` before writing any code.
3. Create a focused branch such as `milestone/1g-d1-bills-core` from current main.
4. Add `lib/runtime/bills.ts` with constants/types/validation first.
5. Add `tests/bill-schedule.test.ts` with the failure/edge cases before or alongside the recurrence implementation.
6. Implement `lib/runtime/bill-schedule.ts` using immutable-anchor arithmetic.
7. Add `migrations/0009_bills_and_obligations.sql`.
8. Add `tests/bills-migration.test.ts` executing the real migration chain.
9. Run focused Bill tests.
10. Run full repository checks.
11. Inspect exact diff for accidental changes.
12. Add `docs/MILESTONE-1G-D1-BILLS-CORE.md` recording final schema, recurrence semantics, tests, and any intentionally deferred items.
13. Open one focused PR for 1G-D1 only.
14. Do not start repository/API/UI code in the same PR.

## Validation commands

Run at minimum:

```sh
npm test -- --test-name-pattern="bill"
npm run lint
npm test
npm run build
npm run build:mcp
npm run build:intel
npm run smoke
git diff --check
```

The project's normal CI matrix on Ubuntu, macOS, and Windows remains the final cross-platform gate.

If the test runner does not forward `--test-name-pattern` through the current npm/tsx script as expected, run the focused test files directly with the repository's `tsx --test` invocation rather than changing package scripts just for convenience.

## Acceptance criteria

1G-D1 is complete only when all of the following are true:

- migration 0009 is additive and applies after the full current production migration chain;
- Bills and occurrences are separate first-class tables;
- physical workspace ownership is generic and FK-backed;
- primary Bill workspace ownership is immutable;
- fixed/variable amount invariants are enforced;
- amounts are non-negative integer minor units within JavaScript safe-integer range;
- occurrence resolution invariants are enforced;
- `resolved_at` and resolver identity support later Household audit history;
- date-only schedule validation rejects impossible or malformed dates;
- recurrence is calculated from the immutable original anchor, never the previous occurrence;
- Jan-31 and Feb-29 schedules clamp without permanent drift;
- one-time/weekly/monthly/yearly and interval recurrence are deterministic;
- range generation is inclusive, bounded, efficient for old anchors, timezone-independent, and sorted;
- no Task rows or hidden Tasks are introduced;
- no API/UI behavior is added;
- existing task/workspace/Access/MCP/Intel tests remain green; and
- full CI is green on all supported runners.

## Stop conditions during implementation

Stop and reassess instead of improvising if any of these occur:

- main has a new migration after 0008 that conflicts with the planned number;
- Cloudflare/D1 rejects a documented STRICT/CHECK construct in actual project validation;
- recurrence requirements emerge that require multiple due dates per month or arbitrary RRULE behavior;
- a proposed change would require touching task persistence, workspace identity semantics, or the 1G-C domain configuration;
- the implementation needs to expose physical workspace IDs to the browser;
- a schema choice would make resolved occurrence history mutable or disposable by ordinary Bill edits; or
- a new dependency appears necessary solely for basic calendar arithmetic.

## Handoff to 1G-D2

After 1G-D1 merges, 1G-D2 may assume:

- the two tables and indexes exist;
- the recurrence engine is the sole canonical schedule calculator;
- `BillDefinitionCore` validation is stable;
- occurrences can be materialized idempotently using the `(bill_id,due_date)` unique constraint;
- later repository code can use existing authenticated physical-workspace context and D1 `batch()` for transactional create/resolve flows; and
- API/UI code does not need to solve recurrence or money storage again.

That makes 1G-D2 primarily an authorization/repository/service problem instead of a mixed schema/product-date problem.

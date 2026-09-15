# Milestone 1G-D1 — Bills core implementation record

Date: 2026-09-15

Branch: `milestone/1g-d1-bills-core`

## Scope

This slice adds only the durable Bills/Obligations schema, runtime-neutral bill validation, and deterministic date-only recurrence engine. It does not add Bills APIs, repositories, UI, Today/Calendar projection, banking, payment execution, Household membership changes, MCP behavior, or Cloudflare routing changes.

## Migration

Actual migration: `migrations/0009_bills_and_obligations.sql`

`0009` was confirmed free on current `main` after Milestone 1G-C and the 1G-D design PR were merged.

The migration is additive and creates:

- `bills`
- `bill_occurrences`
- `bills_workspace_status_name`
- `bill_occurrences_bill_due`
- `bill_occurrences_status_due`
- `bill_primary_workspace_immutable`

Key persistence rules:

- physical workspace ownership is FK-backed and immutable;
- arbitrary future physical workspace IDs are allowed;
- Bill definitions and concrete occurrences remain separate records;
- amounts are non-negative integer minor units capped at JavaScript `Number.MAX_SAFE_INTEGER`;
- currency is explicit uppercase three-letter text;
- FIXED bills require a default amount while VARIABLE bills may have an unknown amount;
- recurrence unit/day-mode combinations are constrained in SQL;
- `(bill_id, due_date)` is unique for idempotent occurrence materialization;
- OPEN occurrences have no resolution fields;
- PAID requires `paid_on` and `resolved_at`;
- SKIPPED/CANCELLED require `resolved_at` and cannot contain paid amount/date values;
- resolver user FKs use `ON DELETE SET NULL` so historical resolution survives account deletion;
- normal history is retained when a Bill is ARCHIVED;
- explicit physical Bill deletion cascades to occurrences.

Real Gregorian date validity and LAST_DAY anchor validity intentionally remain runtime/service validation instead of opaque SQL date expressions.

## Runtime validation

`lib/runtime/bills.ts` defines the canonical v1 amount, recurrence, Bill status, and occurrence status constants/types plus:

- strict real-calendar `YYYY-MM-DD` parsing;
- leap-year/month-length helpers;
- schedule validation;
- Bill definition validation;
- non-negative safe-integer money validation;
- fixed/variable amount rules;
- currency/reminder/string-shape validation; and
- LAST_DAY anchor validation.

The runtime core does not contain a physical workspace ID. Workspace ownership remains persistence/auth context for 1G-D2.

## Recurrence engine

`lib/runtime/bill-schedule.ts` is pure and has no D1, React, HTTP, Cloudflare, current-time, or browser dependency.

Canonical API:

```ts
billDueDatesInRange(schedule, { startDate, endDate }): string[]
```

Semantics:

- inclusive date ranges;
- immutable original `scheduleStartDate` anchor;
- NONE/WEEK/MONTH/YEAR recurrence;
- every-N interval support from 1 through 120;
- monthly ANCHOR_DATE clamps only the target month and returns to the original anchor day later;
- yearly Feb-29 anchors clamp to Feb-28 in non-leap years and return to Feb-29 in later leap years;
- LAST_DAY resolves to each target period's actual last calendar day;
- weekly arithmetic uses UTC only as a calendar-day implementation detail, avoiding DST drift;
- range seeking starts near the requested window instead of replaying years of history;
- generation is bounded to 512 returned due dates with a small candidate-seek allowance;
- output is sorted, unique, date-only, and deterministic.

## Tests added

`tests/bill-schedule.test.ts` covers:

- malformed/impossible dates;
- Bill definition and schedule validation;
- Jan-31 non-leap and leap-year monthly behavior without drift;
- Feb-29 yearly clamp and leap-year rebound;
- LAST_DAY recurrence;
- 2/3/6-month intervals;
- every-four-weeks behavior across DST;
- one-time and inclusive boundary behavior;
- old-anchor range seeking; and
- the 512-occurrence generation guard.

`tests/bills-migration.test.ts` executes the real migration chain through 0009 and covers:

- STRICT tables;
- preservation of pre-existing task/workspace rows;
- future physical workspace compatibility;
- workspace FK enforcement and immutable Bill ownership;
- fixed/variable, safe-integer, currency, and recurrence SQL constraints;
- duplicate occurrence prevention;
- resolution-state constraints;
- ARCHIVED history preservation;
- resolver `ON DELETE SET NULL`; and
- explicit Bill DELETE cascade.

## Validation

Validation is performed by the repository's Node 24.19.0 GitHub Actions matrix. Final CI results are recorded in the PR discussion before merge.

## Deferred work

1G-D2 remains responsible for authorized D1 repository/service/API behavior and transaction boundaries. 1G-D3 remains responsible for the Bills management surface. 1G-E remains responsible for canonical occurrence projection into Today and Calendar without creating duplicate Task rows.

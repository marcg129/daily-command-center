# Codex-ready task — Milestone 1G-D1 Bills core

Use this only **after Milestone 1G-C is merged, deployed, and verified** and the Bills design documents have been merged to current `main`.

## Objective

Implement Milestone 1G-D1: the additive Bills/Obligations schema plus runtime-neutral bill validation and deterministic date-only recurrence engine, with exhaustive migration/schedule tests. Do not implement Bills APIs, repositories, UI, Today/Calendar integration, banking, or payment execution.

## Read first

Before changing code, read these repository documents and treat them as the authoritative requirements:

1. `docs/MILESTONE-1G-D-BILLS-DESIGN.md`
2. `docs/MILESTONE-1G-D1-IMPLEMENTATION-PLAN.md`
3. `docs/ROADMAP.md`

Also inspect current:

- `migrations/`
- `lib/runtime/context.ts`
- `lib/runtime/primitives.ts`
- `lib/runtime/hosted-tasks.ts`
- `lib/runtime/task-mutations.ts`
- `tests/workspaces-d1.test.ts`
- `tests/workspace-instance-isolation.test.ts`
- `package.json`

Do not assume the migration number from the design document is still free. Inspect current `main` first. If `0009` is still next, use `0009_bills_and_obligations.sql`. If a new migration landed before this work starts, use the next available sequential number and update the implementation record accordingly. Do not renumber or rewrite an already-deployed migration.

## Branch

Create a fresh branch from the current verified `main`:

`milestone/1g-d1-bills-core`

Do not continue implementation directly on the old design branch.

## Required files

Add the focused equivalents of:

- `migrations/<NEXT>_bills_and_obligations.sql`
- `lib/runtime/bills.ts`
- `lib/runtime/bill-schedule.ts`
- `tests/bills-migration.test.ts`
- `tests/bill-schedule.test.ts`
- `docs/MILESTONE-1G-D1-BILLS-CORE.md`

Do not add a new dependency for calendar/date arithmetic.

## Domain rules that are already decided

Do not redesign these during implementation:

- Bills are first-class entities, not Tasks.
- A Bill definition and a concrete Bill occurrence are separate records.
- Money is integer minor units plus explicit currency.
- `FIXED` requires a known default amount; `VARIABLE` may be unknown.
- AutoPay is informational and never automatically means Paid.
- Due dates are strict date-only `YYYY-MM-DD` values.
- Recurrence units are `NONE`, `WEEK`, `MONTH`, `YEAR` with integer interval 1..120.
- `NONE` has interval 1 and no day mode.
- `WEEK` has no day mode.
- `MONTH`/`YEAR` use `ANCHOR_DATE` or `LAST_DAY`.
- A `LAST_DAY` schedule must itself start on the last day of its anchor month.
- Recurrence is always calculated from the immutable original `scheduleStartDate`, never the prior generated occurrence.
- Jan-31 monthly schedules clamp in short months and return to the 31st when possible.
- Feb-29 yearly schedules clamp to Feb-28 in non-leap years and return to Feb-29 in later leap years.
- Occurrence generation is inclusive-range, sorted, unique, bounded, and timezone-independent.
- Occurrence IDs are generated stable IDs later; date is not identity. `(bill_id,due_date)` provides materialization idempotency.
- Bill physical workspace ownership is FK-backed and immutable.
- The schema must accept future arbitrary physical workspace IDs; do not hard-code Personal/Indelitech.
- Occurrence resolution includes both user-selected `paid_on` and server audit `resolved_at`.
- Normal product behavior later will archive Bills rather than physically delete financial history.

## Implementation requirements

### 1. Runtime bill definitions/validation

Implement canonical constants/types and validators in `lib/runtime/bills.ts` as specified in the implementation plan.

Validators must reject malformed data rather than silently repairing it.

Use strict real-calendar validation for date-only inputs; do not trust `Date.parse` alone.

Monetary values must be non-negative safe integers.

### 2. Pure recurrence engine

Implement `lib/runtime/bill-schedule.ts` with a pure API equivalent to:

```ts
billDueDatesInRange(schedule, { startDate, endDate }): string[]
```

No D1, HTTP, React, current-time, Cloudflare, or browser dependencies.

Use explicit date-part helpers and UTC only as a calendar arithmetic implementation detail.

For monthly recurrence, calculate the target absolute month from the original anchor and occurrence index. For yearly recurrence, calculate target year from the original anchor and occurrence index. Never chain from the prior occurrence.

Seek efficiently to a starting occurrence near the requested range so an old anchor does not require scanning its entire history.

Enforce a hard generation guard of 512 due dates/candidates per requested range without penalizing old anchors queried over a normal current window.

### 3. Additive migration

Implement the schema from `MILESTONE-1G-D1-IMPLEMENTATION-PLAN.md`, including:

- `bills`
- `bill_occurrences`
- indexes
- immutable Bill primary-workspace trigger
- `resolved_at`
- workspace/user/bill foreign keys
- fixed/variable amount invariant
- recurrence-unit/day-mode invariant
- resolution-state invariant
- safe-integer amount limits
- uppercase 3-letter currency shape
- unique `(bill_id,due_date)`

Keep SQL checks readable. Real Gregorian date validity and LAST_DAY anchor validity stay in runtime/service validation rather than opaque SQL date expressions.

The migration must be additive and must not rebuild or modify existing Task/workspace data.

### 4. Schedule tests

Implement every case in the plan, especially:

- Jan31 -> Feb28/29 -> Mar31 (no drift)
- Feb29 yearly -> Feb28 in non-leap years -> Feb29 in next leap year
- LAST_DAY monthly/yearly
- 2/3/6-month intervals
- every 4 weeks across DST
- old anchor efficiently querying a current range
- inclusive range boundaries
- invalid dates/intervals/day modes
- LAST_DAY with non-last-day anchor rejects
- >512 output guard

### 5. Migration tests

Use the repository's existing Node 24 `node:sqlite` pattern and execute the actual full migration chain through the new migration.

Prove all schema invariants in the implementation plan, including future physical workspace compatibility (`personal:christa`-style ID), immutable Bill ownership, duplicate occurrence prevention, resolution constraints, explicit DELETE cascade, ARCHIVED history preservation, and preservation of pre-existing task/workspace rows.

## Explicitly forbidden in this PR

Do not add:

- `app/api/.../bills` routes;
- a D1 Bills repository;
- React Bills components/navigation;
- Calendar or Today changes;
- Task schema/type changes;
- bank/finance connectors;
- payment APIs;
- notification jobs;
- Household UI/membership changes;
- MCP changes;
- Cloudflare domain/Access changes; or
- unrelated cleanup/refactors.

If one of those seems necessary, stop and explain why instead of broadening scope.

## Validation

Run focused Bills tests first, then the full project suite.

At minimum:

```sh
npm run lint
npm test
npm run build
npm run build:mcp
npm run build:intel
npm run smoke
git diff --check
```

Use the repository's Node 24.19.0 CI target. Do not weaken the engine requirement.

Inspect the final exact diff before opening the PR and remove accidental unrelated changes.

## Documentation/PR

Create `docs/MILESTONE-1G-D1-BILLS-CORE.md` recording:

- actual migration filename/number;
- final table/constraint decisions;
- final recurrence algorithm and no-drift semantics;
- test coverage;
- validation results;
- any deviation from the implementation plan and why;
- explicit deferral of repository/API/UI to 1G-D2/1G-D3.

Open one focused PR to `main` titled along the lines of:

`Milestone 1G-D1: add Bills core schema and recurrence engine`

Do not merge or deploy automatically unless explicitly instructed after CI/review.

## Completion response

Return:

- branch name;
- commit SHA(s);
- PR number/link;
- migration number used;
- concise summary of files/behavior added;
- focused/full validation results;
- any unresolved issue or deviation.

# Milestone 1G-F — Payday & Cash-Flow Forecasting design

Date: 2026-09-16

Branch: `milestone/1g-f-payday-cashflow`

## Objective

Build the first cash-flow planning layer on top of the verified Bills domain without requiring bank linking. The product should answer:

1. When is the next expected income date?
2. What open obligations are due before that date?
3. What obligations are due on the same day?
4. How much of those amounts are exact, estimated, or unknown?
5. If the user supplies a manual current-cash baseline, what is the projected known balance before and after that payday?

This milestone is forecasting from user-entered canonical records, not bank reconciliation and not financial advice.

## Domain boundaries

### Income is not a negative Bill

Expected income has a different lifecycle from an obligation. Use a first-class Income Source plus concrete Income Occurrence ledger.

### Forecasting does not own Bills

Open Bill occurrences remain canonical outgoing obligations. Forecasting reads them and never copies them into another persistence table.

### Financial workspace boundaries are stricter than visual roll-ups

Personal Today/Calendar may visually roll up Indelitech work, but Personal and Indelitech cash must not be silently netted together. Forecast calculations operate on one authorized physical workspace at a time.

### Manual cash baseline is optional

A user may enter a current available-cash amount and as-of date. Without it, the product still shows next payday and obligations but does not fabricate a projected balance.

No bank/card credentials, account numbers, access tokens, or transaction feeds belong in 1G-F.

## Proposed persistence model

### `income_sources`

A reusable expected-income definition.

Fields:

- `income_source_id`
- immutable `primary_workspace_id`
- `name`
- optional `payer`
- `amount_mode`: `FIXED | VARIABLE`
- nullable `default_net_amount_minor`
- explicit `currency`
- `schedule_start_date`
- `recurrence_unit`: `NONE | WEEK | MONTH | YEAR | SEMIMONTH`
- `recurrence_interval`
- nullable `recurrence_day_mode`: `ANCHOR_DATE | LAST_DAY`
- nullable `semimonth_day_one`
- nullable `semimonth_day_two`
- `status`: `ACTIVE | PAUSED | ARCHIVED`
- nullable `created_by_user_id`
- timestamps

Rules:

- FIXED requires a default net amount; VARIABLE may be unknown.
- NONE uses interval 1 and no day-mode/semimonth fields.
- WEEK uses every-N-weeks and no day-mode/semimonth fields.
- MONTH/YEAR use ANCHOR_DATE or LAST_DAY and no semimonth fields.
- SEMIMONTH uses interval 1, no recurrence day mode, and two configured calendar days.
- Semimonth days must not collapse to the same date in February; a simple v1 guard is `min(dayOne, 28) < min(dayTwo, 28)`.
- The semimonth `schedule_start_date` must itself be one of that month’s generated configured paydays.
- Normal UI flow archives rather than physically deletes.

### `income_occurrences`

Concrete expected or resolved income events.

Fields:

- `occurrence_id`
- `income_source_id`
- `pay_date`
- nullable `expected_amount_minor`
- `currency`
- `status`: `EXPECTED | RECEIVED | SKIPPED | CANCELLED`
- nullable `received_amount_minor`
- nullable `received_on`
- nullable `resolved_by_user_id`
- nullable `resolved_at`
- nullable `resolution_note`
- timestamps
- unique `(income_source_id, pay_date)`

Rules mirror Bill occurrence audit behavior:

- EXPECTED has no resolution fields.
- RECEIVED requires `received_on` and `resolved_at`; received amount may remain unknown if the user chooses not to enter it.
- SKIPPED/CANCELLED require `resolved_at` and cannot carry received amount/date.
- Resolver user deletion uses `ON DELETE SET NULL` so history survives.

### `cashflow_baselines`

One optional manual snapshot per physical workspace.

Fields:

- `primary_workspace_id` primary key
- signed safe-integer `amount_minor`
- `currency`
- `as_of_date`
- nullable `updated_by_user_id`
- `updated_at`

Negative values are allowed because a manual cash position can legitimately be below zero. The UI must label this as user-entered/manual, never bank-verified.

## Pay schedule engine

The engine is pure, deterministic, date-only, and independent from D1/React/HTTP/current time.

Recommended API:

```ts
incomePayDatesInRange(schedule, { startDate, endDate }): string[]
```

Semantics:

- inclusive date range;
- original schedule start remains the anchor;
- weekly arithmetic advances by `recurrenceInterval * 7` days;
- monthly/yearly ANCHOR_DATE clamps only the target period and rebounds to the original anchor later;
- LAST_DAY always resolves to the actual period end;
- semimonthly generates the two configured clamped dates per month after the schedule start;
- no duplicate semimonth dates;
- one-time income generates exactly once;
- bounded output and range seeking prevent unbounded replay.

## Materialization

As with Bills, concrete future income occurrences should be persisted, not invented only in the browser.

Target a 12-month future horizon. Bill and Income occurrence materialization remain independent but can use parallel service patterns.

Schedule edits preserve resolved history and overdue/past expected records. Future EXPECTED occurrences on/after an explicit effective date can be regenerated.

## Forecast engine

Forecast math should be a pure function over already-authorized records.

Inputs:

- product `today` date;
- expected Income occurrences for exactly one workspace;
- open Bill occurrences for exactly one workspace;
- optional manual cash baseline;
- amount exactness metadata from Bill/Income definitions.

### Next payday

Find the earliest EXPECTED income date `P` where `P >= today`.

If multiple expected income occurrences share `P`, aggregate them as that payday group. Known amounts may be summed only when currencies match. Unknown income remains an explicit count.

### Bill windows

For open Bill occurrences:

- overdue/open Bills remain included;
- `dueDate < P` belongs to “due before payday”;
- `dueDate === P` belongs to a separate “due on payday” group;
- `dueDate > P` is outside the immediate payday window.

This avoids assuming whether a same-day AutoPay charge occurs before or after a deposit.

### Amount semantics

Each group returns:

- exact known total;
- estimated known total;
- unknown amount count;
- combined known total;
- item count.

FIXED Bill amounts count as exact. VARIABLE Bill amounts with a value count as estimated. Null amounts are unknown.

Income follows the same principle: FIXED known amounts are exact; VARIABLE known amounts are estimated; null amounts are unknown.

### Manual baseline projections

Only calculate balance projections when a baseline exists in the same currency.

`knownBeforePayday = baseline - knownBillsBeforePayday`

`knownAfterPayday = knownBeforePayday + knownIncomeOnPayday - knownBillsOnPayday`

These are **known-amount projections**, not guaranteed balances. If any relevant amount is unknown or estimated, surface that uncertainty with the number. Never replace unknown values with zero silently.

Do not call either value “safe to spend.”

## 1G-F delivery slices

### 1G-F1 — Core

- migration `0010_income_and_cashflow.sql`;
- runtime income types/validation;
- pure pay-schedule engine;
- pure cash-flow forecast math;
- migration and engine tests.

No hosted API or UI.

### 1G-F2 — Authorized API

- D1 income repository;
- authenticated workspace-scoped CRUD;
- occurrence materialization/resolution;
- cash baseline read/write;
- hosted routes with `Cache-Control: no-store`;
- fail-closed cross-workspace tests.

### 1G-F3 — UI

- focused Cash Flow surface;
- next payday card;
- due-before-payday and same-day obligation groups;
- exact/estimated/unknown totals;
- manual cash baseline editor;
- projected known balance when data supports it;
- Personal and Indelitech remain financially separate.

## Explicitly out of scope

- bank or brokerage linking;
- transaction import/matching;
- automatic balance detection;
- payment execution;
- account credentials;
- credit optimization;
- debt payoff recommendations;
- envelope budgeting;
- Household invitations/shared-family finance UI;
- investment tracking;
- financial advice or spending recommendations.

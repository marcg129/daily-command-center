# Milestone 1G-D — Bills & Obligations design preparation

Date: 2026-09-13

Branch: `design/1g-d-bills-obligations`

Status: **Design/research only. Do not merge ahead of 1G-C. No production migration or runtime behavior is introduced by this document.**

## Objective

Add a first-class Bills & Obligations domain so known expenses can be captured once and reliably surfaced by due date, amount, recurrence, status, and workspace without pretending a bill is an ordinary task.

1G-D is the core model and management layer. 1G-E remains the milestone that projects bills into Today and Calendar.

## Product boundary already established

The product should eventually replace separate bill trackers for the everyday question: **what money needs attention, when, and how much?**

Initial Bills scope should support:

- name and optional payee;
- expected amount;
- due date;
- recurrence;
- fixed vs. variable amount;
- category;
- AutoPay flag;
- payment status/history;
- upcoming due dates;
- reminder timing;
- optional payment URL;
- notes; and
- workspace ownership/security.

Explicitly not part of 1G-D:

- bank/card linking;
- transaction import or matching;
- automatic bill detection;
- full budgeting/envelope planning;
- income/paycheck forecasting;
- safe-to-spend calculations;
- payment execution;
- storing bank/card credentials or biller passwords;
- Household invitations/shared-workspace UI; and
- Today/Calendar bill projection (1G-E).

## Repository findings that constrain the design

1. Hosted authorization already resolves a user-facing workspace key to an exact physical D1 workspace instance. Bills must reuse that boundary rather than invent another ownership model.
2. Workspace membership is server-authoritative and role-bearing. A bill row should therefore be scoped to a physical `workspace_id`; a browser-supplied workspace identifier is never sufficient authorization.
3. Tasks already use physical workspace ownership plus server-side visibility. Bills should **not** piggyback on `tasks` or add amount fields to tasks.
4. Calendar currently projects date-bearing task fields into display entries. 1G-E should extend that projection pattern rather than manufacturing hidden tasks for bills.
5. Current D1 schemas use `STRICT` tables, CHECK constraints, foreign keys, and parameterized repositories. Bills should continue that pattern.
6. `ProductWorkspaceId` currently exposes only Personal and Indelitech, but the database model must not hard-code that set because Household is planned later.

## Research conclusions

### Money representation

Store money as an integer in the currency's smallest unit, paired with a currency code. This avoids floating-point rounding and matches established payment-system practice; Stripe uses integer smallest-unit amounts with currency stored separately.

The initial UI can remain USD-only while the schema carries `currency = 'USD'` so stored values never need reinterpretation later.

Cloudflare D1 supports SQLite `INTEGER` in STRICT tables and 64-bit signed integers internally. Normal household bill amounts are far below JavaScript safe-integer limits.

### Recurrence semantics

Do not make an opaque iCalendar RRULE the canonical v1 bill schedule.

RFC 5545 ignores recurrence instances that land on invalid dates such as February 30. That is poor bill behavior: an obligation anchored near month-end should not silently disappear in a shorter month.

Use a small bill-specific recurrence model instead. YNAB's current Scheduled Transactions behavior provides a useful consumer-finance precedent: a transaction scheduled on the 31st repeats on the last day of shorter months.

Recommended v1 recurrence support:

- one-time;
- every N weeks;
- every N months;
- every N years;
- explicit last-day-of-month anchoring; and
- normal anchor-date semantics that clamp invalid month/year dates to the last valid date.

This covers monthly, quarterly, semiannual, annual, every-other-month, every-four-weeks, etc. Multiple due dates per month and arbitrary RRULE-style schedules can wait until a real need appears.

The schedule should use **one canonical anchor date** (`scheduleStartDate`) rather than separately storing duplicate anchor month/day fields. That avoids contradictory schedule state.

### Bills need an occurrence ledger

A recurring Bill definition and an individual month's obligation are not the same thing.

Use two layers:

1. **Bill definition** — name/payee, normal amount, schedule, AutoPay, category, reminder preference, notes.
2. **Bill occurrence** — the concrete scheduled obligation for one due date, with expected amount and resolution state.

This preserves history when the normal amount or schedule changes and allows multiple open/overdue obligations if needed. The occurrence is also the correct place for actual paid amount/date.

### AutoPay is not payment confirmation

`autopay = true` means automatic payment is expected. It does **not** mean an occurrence should automatically become PAID.

Until later transaction/bank integration exists, an occurrence becomes PAID only through an explicit user action or a future verified transaction-match workflow. That prevents a failed AutoPay attempt from being falsely cleared.

### Upcoming visibility is high-value

Current consumer-finance products consistently emphasize upcoming-by-date obligations. Rocket Money exposes Upcoming, All, and Calendar views and has an Upcoming Bills widget. YNAB uses scheduled transactions to make future obligations visible before they occur.

That supports the planned Daily Command Center sequence:

- 1G-D: reliable bill data + lifecycle;
- 1G-E: Today/Calendar/upcoming totals;
- later finance work: due-before-next-payday and cash-flow forecasting.

### Security/data minimization

Bill names, amounts, notes, and payment links are sensitive application data.

Cloudflare D1 already provides encryption at rest and in transit. Application rules still matter:

- reuse Access + application workspace authorization;
- never store bank/card numbers, credentials, authentication tokens, or biller passwords;
- store only a stable user-facing payment URL, never an embedded secret;
- reject URLs with embedded username/password components;
- prefer HTTPS payment URLs;
- use parameterized D1 statements;
- prevent cross-workspace access server-side; and
- use `Cache-Control: no-store` for hosted financial responses unless a stronger architecture-specific reason exists.

OWASP's data-protection guidance supports minimizing sensitive information and disabling client-side caching for sensitive pages/data.

### Atomic lifecycle changes

Marking an occurrence PAID may update the occurrence and replenish future occurrences as one logical operation. D1 `batch()` is transactional and rolls the sequence back if one statement fails, which fits this lifecycle.

## Recommended domain model

### Bill definition

```ts
type Bill = {
  billId: string;
  primaryWorkspaceId: string; // physical persistence boundary server-side
  name: string;
  payee: string | null;
  category: string | null;

  amountMode: "FIXED" | "VARIABLE";
  defaultAmountMinor: number | null;
  currency: "USD"; // v1 UI boundary; persistence keeps currency explicit

  autopay: boolean;
  paymentUrl: string | null;
  notes: string | null;

  scheduleStartDate: string; // YYYY-MM-DD; also the recurrence anchor
  recurrenceUnit: "NONE" | "WEEK" | "MONTH" | "YEAR";
  recurrenceInterval: number; // >= 1
  recurrenceDayMode: "ANCHOR_DATE" | "LAST_DAY" | null;

  reminderDaysBefore: number | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";

  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Notes:

- `defaultAmountMinor` may be null when a variable bill's amount is not yet known.
- A VARIABLE bill may still carry an expected amount; it is an estimate, not a guarantee.
- `PAUSED` stops generation of new future occurrences without destroying history.
- `ARCHIVED` removes the definition from normal views while preserving history.
- `primaryWorkspaceId` should be immutable after creation unless a future explicit transfer workflow is designed.

### Bill occurrence

```ts
type BillOccurrence = {
  occurrenceId: string;
  billId: string;
  dueDate: string; // YYYY-MM-DD
  expectedAmountMinor: number | null;
  currency: string;
  status: "OPEN" | "PAID" | "SKIPPED" | "CANCELLED";

  paidAmountMinor: number | null;
  paidOn: string | null; // YYYY-MM-DD
  resolvedByUserId: string | null;
  resolutionNote: string | null;

  createdAt: string;
  updatedAt: string;
};
```

Derived states are deliberately not stored:

- **DUE TODAY** = `status = OPEN && dueDate === today`;
- **OVERDUE** = `status = OPEN && dueDate < today`;
- **UPCOMING** = `status = OPEN && dueDate > today`.

This prevents stale duplicated status flags.

## Draft D1 schema direction

This is not a migration yet. The sketch below was syntax-validated against SQLite STRICT tables; 1G-D1 must still validate it against the project's D1 migration/test path before production use.

```sql
CREATE TABLE bills (
  bill_id TEXT PRIMARY KEY,
  primary_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  payee TEXT,
  category TEXT,
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('FIXED','VARIABLE')),
  default_amount_minor INTEGER CHECK (default_amount_minor IS NULL OR default_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  autopay INTEGER NOT NULL DEFAULT 0 CHECK (autopay IN (0,1)),
  payment_url TEXT,
  notes TEXT,
  schedule_start_date TEXT NOT NULL CHECK (length(schedule_start_date) = 10),
  recurrence_unit TEXT NOT NULL CHECK (recurrence_unit IN ('NONE','WEEK','MONTH','YEAR')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
  recurrence_day_mode TEXT CHECK (recurrence_day_mode IS NULL OR recurrence_day_mode IN ('ANCHOR_DATE','LAST_DAY')),
  reminder_days_before INTEGER CHECK (reminder_days_before IS NULL OR reminder_days_before BETWEEN 0 AND 365),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE bill_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  due_date TEXT NOT NULL CHECK (length(due_date) = 10),
  expected_amount_minor INTEGER CHECK (expected_amount_minor IS NULL OR expected_amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','SKIPPED','CANCELLED')),
  paid_amount_minor INTEGER CHECK (paid_amount_minor IS NULL OR paid_amount_minor >= 0),
  paid_on TEXT CHECK (paid_on IS NULL OR length(paid_on) = 10),
  resolved_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bill_id, due_date),
  CHECK ((status = 'PAID' AND paid_on IS NOT NULL) OR (status <> 'PAID' AND paid_on IS NULL)),
  CHECK (status = 'PAID' OR paid_amount_minor IS NULL)
) STRICT;

CREATE INDEX bills_workspace_status ON bills(primary_workspace_id, status, name);
CREATE INDEX bill_occurrences_bill_due ON bill_occurrences(bill_id, due_date);
CREATE INDEX bill_occurrences_status_due ON bill_occurrences(status, due_date);
```

The final migration should add stronger schedule-consistency checks only where they remain readable. Complex recurrence validation belongs in the service layer with focused tests rather than an opaque SQL CHECK expression.

## Occurrence generation strategy

The browser never invents canonical recurring instances.

A pure server-side schedule function should accept a Bill definition and date range and deterministically return due dates.

Semantics:

- date-only arithmetic;
- no timestamp/time-zone conversion for bill due dates;
- `scheduleStartDate` is the stable anchor;
- monthly/yearly `ANCHOR_DATE` recurrence clamps an invalid day to that period's last valid date;
- `LAST_DAY` always resolves to the period's final calendar day;
- weekly schedules retain the weekday implied by the anchor;
- `recurrenceInterval` advances by the selected unit;
- one-time bills generate exactly one occurrence;
- generation is bounded by an explicit horizon; and
- duplicate generation is harmless because `(bill_id, due_date)` is unique.

### Materialization policy

Persist concrete occurrences rather than generating anonymous browser-only rows.

For 1G-D, maintain a bounded future horizon (target: next 12 months). A server-side `ensureBillOccurrencesThrough()` can idempotently fill missing rows. Exact invocation timing belongs to implementation, but valid triggers include bill create/edit, authenticated Bills reads when the horizon is short, or a future low-frequency maintenance job.

When a schedule changes:

- resolved history remains immutable;
- open future occurrences on/after an explicit effective date may be regenerated;
- overdue/open past occurrences are not silently rewritten; and
- the UI must warn when editing a schedule will replace future generated obligations.

## Core lifecycle behavior

### Create bill

1. Resolve the authenticated physical workspace through existing membership logic.
2. Validate/sanitize the definition.
3. Insert the Bill.
4. Generate a bounded initial set of occurrences.
5. Commit Bill + occurrences atomically where practical.

### Mark paid

The action targets an occurrence, not the Bill definition.

- authorize through the parent Bill's physical workspace;
- set occurrence `status = PAID`;
- record `paidOn` and optional actual `paidAmountMinor`;
- record the authenticated resolver;
- replenish the future horizon if needed; and
- commit the lifecycle mutation atomically.

### Skip / cancel

`SKIPPED` means an intentionally non-payable occurrence of an otherwise active series. `CANCELLED` means that specific obligation was cancelled. Both remain in history.

### Pause / archive

PAUSED stops future generation. ARCHIVED removes the definition from normal active management while preserving history. Normal product flow should archive rather than physically delete financial history.

## Authorized API/repository direction

Suggested hosted actions/endpoints:

- list bills for an authorized logical workspace;
- create Bill;
- update Bill definition;
- list Bill occurrences;
- mark occurrence paid;
- skip occurrence;
- cancel occurrence;
- pause/archive Bill.

Exact URL structure should fit existing Next/Vinext route conventions. The authorization rule is fixed:

> Every bill read/write starts from the authenticated application user and authorized physical workspace instance. A bill ID or browser-supplied workspace ID never grants access.

Repository queries should validate current membership the same way hosted task repositories do rather than trusting the Bill row alone.

## Bills management UI boundary for 1G-D

1G-D should provide a dedicated Bills surface sufficient to maintain the data before Today/Calendar integration exists.

Recommended minimal UI:

- **Upcoming** default, sorted by occurrence due date;
- **All bills** for active/paused definitions;
- add/edit Bill;
- mark occurrence paid;
- skip/cancel occurrence;
- pause/archive definition;
- visible AutoPay badge that never implies Paid;
- Exact vs Estimated/Variable amount treatment;
- obvious Overdue treatment; and
- optional external `Pay bill` link.

Do not build a second full calendar inside Bills during 1G-D. Shared Calendar integration is 1G-E.

## 1G-E projection contract to preserve now

1G-D should expose enough deterministic data for 1G-E to produce:

- `3 bills due in the next 7 days — $486 total`;
- bill entries on the existing Calendar/Agenda;
- overdue bill attention cards;
- due-today bills;
- upcoming payment totals; and
- later widget payloads.

Calendar/Today entries reference canonical `occurrenceId` and open the Bill occurrence/definition. They must not create duplicate task rows.

For totals:

- FIXED amounts are expected exact values;
- VARIABLE amounts are explicitly estimated;
- unknown amounts are excluded from numeric totals and separately counted (`+ 1 amount unknown`) rather than silently treated as $0.

## Household/family compatibility

The schema must be workspace-generic now even though Household UI comes later.

Future state:

- Marc Personal bills live in Marc's physical Personal workspace;
- Christa Personal bills live in her physical Personal workspace;
- shared family bills live in a Household physical workspace where both are members;
- a sister's Personal bills remain isolated unless intentionally shared.

Therefore:

- no `CHECK (workspace_id IN ('personal','indelitech'))` in Bill tables;
- no email-based row authorization;
- no assumption that logical `personal` maps to one global physical row; and
- occurrence actions record the authenticated resolver for useful future Household audit history.

## Privacy rules for later mobile/widgets

Canonical Bill data should support later widget privacy without separate widget records.

Possible projection tiers:

- private: counts/status only;
- normal: bill names + due dates;
- full: names + amounts + due dates.

The widget never receives bill-payment credentials because the core model never stores them.

## Implementation slicing recommendation

### 1G-D1 — Schema + schedule engine

- migration for `bills` and `bill_occurrences`;
- canonical runtime types;
- money validation/formatting boundary;
- recurrence generator;
- month-end/leap-year edge cases;
- occurrence generation/idempotency tests;
- migration tests.

### 1G-D2 — Authorized repository + hosted API

- D1 Bill repository;
- physical workspace authorization;
- CRUD/lifecycle handlers;
- transactional pay/skip/cancel flows;
- cross-user/cross-workspace negative tests;
- `Cache-Control: no-store` on hosted financial responses.

### 1G-D3 — Bills management surface

- Upcoming + All;
- create/edit form;
- paid/skip/cancel actions;
- pause/archive;
- AutoPay and variable-amount semantics;
- responsive phone layout;
- accessibility and smoke coverage.

Then move to **1G-E — Bills integration into Today + Calendar**.

## Required test matrix

### Recurrence/date

- Jan 31 -> Feb 28 non-leap year;
- Jan 31 -> Feb 29 leap year;
- Feb 29 yearly -> Feb 28 in non-leap year;
- explicit last-day-of-month;
- monthly day 15;
- every 2 months;
- every 3 months (quarterly);
- every 6 months;
- every 4 weeks;
- yearly;
- one-time;
- repeated generation produces no duplicates;
- schedule edit preserves resolved history.

### Money

- integer minor units only;
- $0 accepted where legitimate;
- negative amounts rejected;
- variable amount may be unknown;
- paid amount may differ from expected amount;
- non-PAID occurrence cannot carry a paid amount/date;
- occurrence currency is preserved as a snapshot.

### Lifecycle

- AutoPay occurrence remains OPEN until resolved;
- OPEN -> PAID records date/user;
- SKIPPED remains in history;
- PAUSED stops future generation;
- ARCHIVED preserves history;
- normal UI does not physically delete history.

### Authorization

- another user's bill ID cannot be read;
- another user's occurrence ID cannot be mutated;
- forged logical workspace ID fails closed;
- forged physical workspace ID fails closed;
- inactive user fails closed;
- missing membership fails closed;
- future Household access exists only after explicit membership;
- occurrence access cannot escape the parent Bill's physical workspace.

## Decisions intentionally deferred

These do not block 1G-D:

- bank-link provider selection;
- automatic transaction matching;
- biller email parsing;
- push notification transport;
- paycheck/income model;
- safe-to-spend math;
- credit-card minimum-vs-statement-balance automation;
- shared Household invitations;
- split bills between people;
- attachments/statements;
- multiple currencies in the UI;
- arbitrary RRULE schedules; and
- payment execution.

## Research references

- Cloudflare D1 Worker API / STRICT types: https://developers.cloudflare.com/d1/worker-api/
- Cloudflare D1 foreign keys: https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- Cloudflare D1 data security: https://developers.cloudflare.com/d1/reference/data-security/
- Cloudflare D1 batch transactions: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Stripe amount/currency representation: https://docs.stripe.com/api/payment_intents
- RFC 5545 recurrence semantics: https://datatracker.ietf.org/doc/html/rfc5545
- YNAB Scheduled Transactions: https://support.ynab.com/scheduled-transactions-a-guide-BygrAIFA9
- Rocket Money Bills/Subscriptions: https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions
- Rocket Money Upcoming/All/Calendar: https://help.rocketmoney.com/en/articles/3117398-where-can-i-view-my-subscriptions-and-bills
- Rocket Money Payday View: https://help.rocketmoney.com/en/articles/6235627-enabling-payday-view
- OWASP Cryptographic Storage: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Protect Data Everywhere: https://devguide.owasp.org/en/04-design/02-web-app-checklist/08-protect-data/

## Design conclusion

The right 1G-D foundation is **a workspace-scoped Bill definition plus a concrete occurrence ledger**, with integer minor-unit money, one explicit anchor date, bill-specific recurrence semantics, server-authoritative occurrence generation, and no coupling to the Task model.

That model is small enough for the current D1/Workers architecture but strong enough to support 1G-E Today/Calendar, 1G-F Household sharing, later due-before-payday cash-flow forecasting, and eventual bank transaction matching without a destructive rewrite.

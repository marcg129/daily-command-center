# Milestone 1G-F2 — Authorized Income & Cash-Flow API

Date: 2026-09-16

Branch: `milestone/1g-f2-income-api`

## Objective

Expose the 1G-F1 Income and manual cash-baseline domain through the same fail-closed hosted authorization boundary already used by Tasks and Bills. This slice adds server persistence, lifecycle behavior, and hosted APIs only. The user-facing Cash Flow surface remains 1G-F3.

## Security boundary

Every read and mutation begins with the authenticated Cloudflare Access principal and resolves the requested logical `personal` or `indelitech` workspace through the existing server-side workspace resolver. The resolved physical workspace ID is the persistence boundary.

A browser-supplied income source ID, occurrence ID, or workspace-like value never grants access. Repository queries bind source, occurrence, and cash-baseline records to the authenticated physical workspace. Forged user/workspace combinations fail closed.

Financial API responses use `Cache-Control: no-store`.

Personal and Indelitech remain financially separate in this milestone. No Today/Calendar visual roll-up is reused for cash-flow calculations.

## Repository behavior

`D1IncomeRepository` provides:

- workspace-scoped Income Source create, update, and list;
- archived-source inclusion only when explicitly requested;
- deterministic 12-month occurrence materialization for ACTIVE sources;
- complete occurrence-history reads with optional source/date filters;
- RECEIVED, SKIPPED, and CANCELLED occurrence resolution with authenticated resolver audit fields;
- future-horizon replenishment after reads, source creation, source updates, and occurrence resolution;
- occurrence-affecting source edits only with an explicit effective date that is not before the product date;
- preservation of resolved history and past expected records while replacing only future EXPECTED rows on/after the effective date;
- manual cash-baseline read/upsert/clear for exactly one physical workspace; and
- signed baseline amounts, including legitimate negative manual cash positions.

PAUSED and ARCHIVED Income Sources do not project EXPECTED occurrences in normal summary reads, but their existing occurrence history remains preserved and queryable.

## Hosted routes

### `/api/hosted/income`

- `GET` — list Income Sources and current ACTIVE/EXPECTED materialized occurrences; optional `includeArchived=true|false`.
- `POST` — create an Income Source and initial occurrence horizon.
- `PATCH` — update an Income Source; occurrence-affecting changes require `effectiveDate`.

### `/api/hosted/income/occurrences`

- `GET` — list authorized occurrence history; optional `incomeSourceId`, `fromDate`, and `throughDate` filters.
- `POST` — resolve one EXPECTED occurrence as RECEIVED, SKIPPED, or CANCELLED.

RECEIVED requires a valid `receivedOn` date. `receivedAmountMinor` remains optional because actual income may be intentionally left unknown. SKIPPED/CANCELLED cannot carry received amount/date fields.

### `/api/hosted/cashflow/baseline`

- `GET` — read the current manual baseline or null.
- `PUT` — create or replace the workspace baseline.
- `DELETE` — clear the workspace baseline.

The baseline is explicitly user-entered. Its `asOfDate` cannot be after the current product date. Nothing in this API claims a bank-verified balance.

## Materialization rules

Income occurrences use the deterministic date-only schedule engine from 1G-F1. ACTIVE sources maintain a 12-month future horizon. One-time income retains its one canonical pay date even when that date is already in the past. Recurring sources with old anchors do not manufacture years of historical expected income during creation/read; they materialize the current/future horizon.

Occurrence IDs are deterministic per source/pay-date and the database unique constraint keeps repeated materialization idempotent.

## Acceptance coverage

Automated tests cover:

- physical workspace isolation for reads and writes;
- forged context denial;
- idempotent future materialization;
- resolved-history preservation;
- explicit-effective-date source edits;
- pause/resume behavior;
- past one-time versus old recurring materialization;
- signed, replaceable, workspace-isolated manual baselines;
- future baseline-date rejection;
- Access authentication and logical-workspace authorization;
- no-store response headers;
- occurrence resolution through the hosted API;
- baseline GET/PUT/DELETE lifecycle; and
- exact hosted-proxy allowlisting with cross-origin rejection.

## Explicitly deferred to 1G-F3 or later

- Cash Flow user interface;
- next-payday cards and obligation grouping;
- client-side forecast presentation;
- bank or card linking;
- transaction import/matching;
- automatic balance detection;
- payment execution;
- safe-to-spend or spending recommendations;
- Personal/Indelitech cash netting;
- Household shared-finance UI; and
- financial advice.

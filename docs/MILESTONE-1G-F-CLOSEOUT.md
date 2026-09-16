# Milestone 1G-F — Closeout

Date: 2026-09-16

Status: **Complete, merged, deployed, and verified.**

## Production revision

Milestone 1G-F closed after PR #68 merged as `a388f3ef32e3e1483f7f903010f95759a8f68d92` and the resulting `main` revision passed the full Ubuntu/macOS/Windows Check matrix.

The protected Cloudflare production workflow then deployed that exact revision through run `35105770757`. Production reported no pending D1 migrations, built the vinext web bundle, verified the Access-scoped Worker configuration, and successfully deployed the web Worker, cron-only Intel Worker, and fail-closed task-capture MCP Worker.

## Delivered slices

### 1G-F1 — Income + forecast core

- durable first-class income/payday records and concrete occurrences;
- optional workspace-scoped manual cash baseline;
- deterministic one-time, every-N-weeks, monthly, yearly, and semimonthly schedule generation;
- exact / estimated / unknown amount semantics; and
- pure next-payday cash-flow forecast math that reads canonical Bill occurrences without mutating them.

Primary design reference: `docs/MILESTONE-1G-F-PAYDAY-CASHFLOW-DESIGN.md`.

### 1G-F2 — Authorized hosted income API

- membership-authorized Income Source and occurrence repositories;
- received / skipped / cancelled occurrence resolution;
- effective-date protection for occurrence-shape changes;
- authorized manual cash-baseline read/write/clear behavior;
- logical-to-physical workspace isolation matching Tasks and Bills; and
- financial responses kept non-cacheable.

Reference: `docs/MILESTONE-1G-F2-INCOME-API.md`.

### 1G-F3 — Cash Flow surface

- selected-workspace next-payday summary;
- overdue and due-before-payday Bill grouping;
- same-day Bills separated so deposit/payment order is never assumed;
- optional manual available-cash baseline;
- known-balance projections only when sufficient data exists;
- visible uncertainty rather than coercing unknown values to zero;
- Income Source management and expected-occurrence resolution;
- overdue EXPECTED income resolution;
- currency-preserving edits for existing sources; and
- fail-closed workspace switching so Personal and Indelitech financial state cannot bleed across workspaces.

Reference: `docs/MILESTONE-1G-F3-CASHFLOW-UI.md`.

## Verification boundary

The final milestone state passed:

- clean pull-request CI on Ubuntu, macOS, and Windows;
- merged-`main` CI on Ubuntu, macOS, and Windows;
- repository tests, type-checking, builds, and smoke checks;
- generated Worker Custom Domain and Access-posture validation;
- production D1 migration validation through `0010_income_and_cashflow.sql` with no pending migrations;
- production web Worker deployment;
- cron-only Intel Worker deployment;
- fail-closed MCP Worker deployment; and
- final deployment-posture validation.

Authenticated production acceptance also passed all 1G-F3 user-facing checks:

1. a temporary Income Source produced the expected next payday and expected-income amount;
2. a Bill due before payday appeared in the due-before-payday group;
3. a Bill due on payday appeared separately;
4. a manual cash baseline produced the expected known projection while retaining uncertainty / non-bank-verified disclosure;
5. switching Personal to Indelitech and back preserved strict financial isolation with no stale Personal data shown under Indelitech; and
6. all temporary acceptance Income, Bill, occurrence, and baseline records were resolved, archived, or cleared after verification.

## Closed boundary

1G-F intentionally does **not** add bank/card linking, transaction ingestion or matching, payment execution, bank-verified balances, investment tracking, Household shared-finance permissions, debt optimization, or “safe to spend” financial-advice claims.

Those are not implicit follow-ups to 1G-F and should not be added without a separately approved milestone.

## Next milestone

No 1G-G scope is committed at closeout. The next milestone should be selected from observed product use, friction, and highest-value workflow gaps now that 1G-A through 1G-F are live in production.

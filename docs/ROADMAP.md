# Project roadmap

Last updated: 2026-09-16

This document is the canonical near-term delivery order. Completed milestone notes preserve implementation detail; this roadmap records the current boundary and what comes next.

## Milestone status

| Milestone | Status | Scope |
| --- | --- | --- |
| 1G-A | **Complete, merged, deployed, and verified** | Durable application users, principals, workspace memberships, and server authorization |
| 1G-B | **Complete, merged, deployed, and verified** | Physical per-user workspace isolation, conversational ChatGPT task capture, and stronger overdue treatment |
| 1G-C | **Complete, merged, deployed, and verified** | `command.coreyg.dev` Worker Custom Domain, Cloudflare Access protection, DNS/DNSSEC, rollback route |
| 1G-D | **Complete, merged, deployed, and verified** | First-class Bills & Obligations model, authorized API, management UI, recurrence, resolution history |
| 1G-E | **Complete, merged, deployed, and verified** | Canonical Bills projection into Today and Calendar without fake task rows |
| 1G-F | **Complete, merged, deployed, and verified** | Payday schedules, authorized Income APIs, manual cash baseline, and workspace-scoped Cash Flow forecasting without bank linking |

Milestones 1G-A through 1G-F are closed. Do not reopen them unless a regression, security issue, or explicitly approved enhancement requires it.

## Closed milestone references

### 1G-A — User/workspace ownership foundation

Delivered durable application users, cryptographically verified principals, role-bearing memberships, and fail-closed server authorization.

See `docs/MILESTONE-1G-A-USER-WORKSPACE-OWNERSHIP.md`.

### 1G-B — Multi-user identity + conversational task capture

Delivered per-user physical workspace instances, logical-to-physical workspace resolution, ChatGPT task capture, and stronger overdue visibility.

See:

- `docs/MILESTONE-1G-B1-WORKSPACE-INSTANCES.md`
- `docs/MILESTONE-1G-B2-CONVERSATIONAL-CAPTURE.md`
- `docs/MILESTONE-1G-B3-OVERDUE-VISIBILITY.md`
- `docs/MILESTONE-1G-B-CLOSEOUT.md`

### 1G-C — `command.coreyg.dev`

Delivered the canonical Worker Custom Domain, preserved Cloudflare Access, kept the old `workers.dev` hostname as an Access-protected rollback route, and left the MCP Worker independent.

See `docs/MILESTONE-1G-C-CUSTOM-DOMAIN.md`.

### 1G-D — Bills & Obligations

Delivered a first-class financial-obligation domain rather than extending Tasks with money fields. Bills use physical workspace ownership, integer minor-unit money, explicit currency, deterministic date-only recurrence, concrete occurrence history, fixed/variable amount semantics, AutoPay as informational state only, and archive-not-delete product flow.

Delivered slices:

- 1G-D1: schema, validation, recurrence engine;
- 1G-D2: authorized D1 repository and hosted API;
- 1G-D3: Bills management UI.

See:

- `docs/MILESTONE-1G-D-BILLS-DESIGN.md`
- `docs/MILESTONE-1G-D1-BILLS-CORE.md`
- `docs/MILESTONE-1G-D2-BILLS-API.md`
- `docs/MILESTONE-1G-D3-BILLS-UI.md`

### 1G-E — Bills in Today and Calendar

Delivered canonical open Bill occurrence projections into Today and Calendar. Personal rolls up authorized Personal + Indelitech obligations; Indelitech remains Indelitech-only. Projections never create Task rows and route back to the canonical Bills surface.

Production acceptance verified create/projection/workspace isolation/canonical navigation/cancel/archive behavior.

See `docs/MILESTONE-1G-E-BILL-PROJECTIONS.md`.

### 1G-F — Payday & Cash-Flow Forecasting

Delivered first-class expected-income/payday schedules, authorized hosted Income and manual-baseline APIs, deterministic forecast math, and a hosted Cash Flow surface that combines canonical Income and Bill occurrences without bank linking or payment execution.

Production acceptance verified next-payday display, due-before-payday and same-day Bill grouping, manual baseline projections, uncertainty treatment, Personal/Indelitech financial isolation, and cleanup of temporary acceptance records.

See:

- `docs/MILESTONE-1G-F1-INCOME-FORECAST-CORE.md`
- `docs/MILESTONE-1G-F2-INCOME-API.md`
- `docs/MILESTONE-1G-F3-CASHFLOW-UI.md`
- `docs/MILESTONE-1G-F-CLOSEOUT.md`

## Closed milestone 1G-F — Payday & Cash-Flow Forecasting

Status: **Complete, merged, deployed, and verified on 2026-09-16.**

### Goal

Answer the next practical money question after Bills: **what obligations are due before my next income arrives, and what does the known cash picture look like?**

1G-F remains useful without requiring bank credentials or transaction feeds. It introduced first-class expected-income/payday schedules and an optional manual cash baseline, then combined those records with canonical open Bill occurrences.

### Product rules

- Income/payday records are first-class financial records, not Tasks and not negative Bills.
- Money remains integer minor units with explicit currency.
- Expected income and actual received income are distinct states.
- Variable or unknown income remains visibly uncertain; the app never invents an amount.
- Open Bills remain the canonical outgoing obligations. Forecasting reads them; it does not duplicate or mutate them.
- A manual cash baseline is optional. Without one, the product can still show bills due before payday and expected income, but must not fabricate a projected balance.
- Forecast output distinguishes exact, estimated, and unknown amounts.
- No forecast number is labeled “safe to spend.” It is a projection from known user-entered records, not a bank-verified balance.
- Financial netting is workspace-scoped. Personal and Indelitech money are not silently combined merely because Personal Today/Calendar can visually roll up Indelitech work.
- Bank/card linking, transaction import/matching, payment execution, credentials, and automated balance detection remain out of scope.

### Delivered slices

#### 1G-F1 — Income + forecast core

Added the durable income/payday schema, concrete income occurrences, optional workspace cash baseline, runtime validation, deterministic pay-schedule generation, and pure forecast math.

Schedule support covers:

- one-time income;
- every-N-weeks schedules, including weekly/biweekly;
- monthly/yearly anchor or last-day schedules; and
- common semimonthly schedules such as the 1st/15th or 15th/last-day pattern without duplicate short-month dates.

#### 1G-F2 — Authorized hosted income API

Added membership-authorized D1 repositories and hosted routes for income sources, occurrences, received/skipped/cancelled resolution, and the manual cash baseline. It reuses the same logical-to-physical workspace boundary as Tasks and Bills, and financial responses remain `Cache-Control: no-store`.

#### 1G-F3 — Cash-flow surface

Added a focused hosted surface that shows, for the selected workspace:

- next expected payday/date and known amount;
- overdue/open Bills and Bills due before the next payday;
- Bills due on payday separately;
- exact/estimated/unknown obligation totals;
- optional manually entered cash baseline; and
- projected known balance before/after payday only when sufficient data exists.

The UI explains uncertainty instead of converting unknown values to zero.

### Forecast window semantics

For a next payday `P` and product date `T`:

- overdue/open Bills with `dueDate < T` remain obligations and are included;
- “due before payday” means open Bills with `dueDate < P`;
- Bills with `dueDate === P` are shown separately because deposit/payment ordering on the same day is not assumed;
- next-payday income aggregates expected income occurrences on the earliest expected income date at or after `T`;
- known monetary totals are computed only within one currency; and
- unknown amounts remain separate counts/labels.

### Explicitly deferred beyond 1G-F

- Plaid or other bank/account linking;
- automatic transaction matching or bill detection;
- bank-verified balances;
- payment initiation;
- credit-card payoff optimization;
- envelope/category budgeting;
- Household invitations/shared-family finance UI;
- investment tracking; and
- financial-advice scoring or “safe to spend” claims.

## Next milestone

No 1G-G scope is committed yet. The next milestone should be selected from observed product use, friction, and highest-value workflow gaps now that 1G-A through 1G-F are live in production.

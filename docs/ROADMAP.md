# Project roadmap

Last updated: 2026-10-31

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
| 1G-G | **Complete, merged, deployed, and verified** | Read-only hosted Today Financial Pulse using the canonical 1G-F forecast, with strict per-workspace financial isolation |
| 1G-H | **Implementation complete; PR and production acceptance pending** | Automated Daily Intake, proposal review, source freshness, 45-day Google Calendar projection, Upcoming Events, and lightweight Today summaries |

Milestones 1G-A through 1G-G are closed. 1G-H is the active release/acceptance milestone. Do not reopen closed milestones unless a regression, security issue, or explicitly approved enhancement requires it.

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

- `docs/MILESTONE-1G-F-PAYDAY-CASHFLOW-DESIGN.md`
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

## Closed milestone 1G-G — Today Financial Pulse & Command Summary

Status: **Complete, merged, deployed, and verified.**

### Goal

Make hosted Today reflect the live 1G-F money picture without turning Today into a second financial-management surface.

The Financial Pulse is a read-only projection of existing canonical Income, Bills, and optional manual cash-baseline data. It reuses `buildPaydayForecast` and shows the selected workspace's next payday, expected income, Bills due before payday, projected known cash after payday when a baseline exists, and visible uncertainty.

### Financial isolation boundary

- Personal Financial Pulse reads Personal financial records only.
- Indelitech Financial Pulse reads Indelitech financial records only.
- Personal and Indelitech cash-flow totals are never rolled up or netted together.
- Workspace switches fail closed so stale values cannot render under the newly selected workspace.
- Local mode does not fetch or render hosted financial records.
- Today performs no Bill, Income, baseline, transaction, bank, or payment mutation.

See:

- `docs/MILESTONE-1G-G-TODAY-FINANCIAL-PULSE.md`
- `docs/superpowers/plans/2026-09-16-today-financial-pulse.md`

## Operational integration — Todoist task ingress

The Todoist v0.1 relay is merged, deployed, and production-accepted. It provides a reliable transport when the custom DCC ChatGPT integration is not exposed in the client:

**ChatGPT → Todoist `Daily Command Center Inbox` → private scheduled Cloudflare importer → canonical Daily Command Center persistence**

Daily Command Center remains the system of record. The dedicated Todoist project ID is `6hWfF7hXXMj9XpV5`. The importer remains cron-only/private, resolves the configured durable DCC user and exact authorized workspace, closes relay items only after canonical persistence succeeds, preserves transient failures for retry, and leaves permanent failures visible with bounded diagnostics. Legacy explicit task capture remains supported while 1G-H extends the same transport with typed Intake, Calendar, and scan-status envelopes.

## Active milestone 1G-H — Automated Daily Intake & Upcoming Events

Status: **Implementation complete on `milestone/1g-h-daily-intake`; PR review, merge, deployment, and production acceptance remain.**

### Goal

Turn approved Gmail and Google Calendar signals into a durable, review-first command layer without letting inferred work silently become canonical Tasks or Bills.

Delivered implementation scope on the milestone branch includes:

- typed Todoist envelopes for Intake proposals, Calendar sync batches, and source scan status while preserving legacy task capture;
- durable Intake, Calendar projection, workspace override, sync/reconciliation, and source-freshness persistence;
- membership-authorized hosted Intake and Upcoming Events APIs with `Cache-Control: no-store`;
- idempotent approval into canonical Tasks/Bills, with Awareness remaining non-actionable;
- 45-day Primary + Family Google Calendar projections, including editable DCC workspace classification and recurring-series defaults with occurrence-level exceptions;
- a dedicated Intake review surface with Pending, Deferred, Awareness, and History states;
- Calendar Month/Agenda integration plus a dedicated Upcoming view with Personal / Indelitech / All filtering;
- lightweight Today cards for Today's Events, the next 7 days, pending Intake review counts, and stale/failed source disclosure; and
- deployment/smoke protection for migration `0012_daily_intake_events.sql`, the canonical Todoist project binding, private Worker posture, and hosted Intake/Event routes.

### Approved recurring source scope

- Personal Gmail → Personal;
- Professional Gmail → Personal;
- Indelitech Gmail → Indelitech;
- Primary Calendar → Personal by default, with strong-evidence/manual Indelitech classification;
- Family Calendar → Personal.

Harvest Fire Gmail, HF IT Gmail, the HFWC Praise Team/AV calendar, and US Holidays remain out of recurring 1G-H scope.

### Safety and product boundaries

- Inferred Tasks, Follow-ups, and Bills require review/approval before canonical creation.
- Important non-actionable information stays Awareness-only.
- Missing deadlines remain blank; vague urgency never becomes an invented date.
- Full Gmail bodies/attachments and full Calendar descriptions/attendee lists are not persisted by default.
- Google Calendar events stay projections, not Tasks, and DCC workspace corrections do not modify Google Calendar.
- Personal task/calendar surfaces may visibly roll up authorized Indelitech work, but financial data remains strictly workspace-isolated.
- Historical mailbox work older than the controlled 7-day bootstrap is a separate one-time workflow, not part of the recurring 48-hour Daily Intake scans.

### Release boundary

Before 1G-H can be marked closed, the implementation PR must be reviewed and explicitly approved for merge, the web + Todoist workers must be deployed through the protected workflows, manual typed-envelope and legacy-task relay acceptance must pass, the controlled 7-day bootstrap must succeed, and the three approved 7:00 AM / 12:30 PM / 5:30 PM America/New_York Automations must be enabled and verified.

See:

- `docs/superpowers/specs/2026-09-17-1g-h-daily-intake-design.md`
- `docs/superpowers/plans/2026-09-17-daily-intake-and-upcoming-events.md`


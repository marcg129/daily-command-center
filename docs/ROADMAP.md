# Project roadmap

Last updated: 2026-09-18

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
| 1G-H | **Production operational; closeout evidence cleanup pending** | Conservative Daily Intake, 45-day Google event projections, review/approval workflow, Today summaries, and operational Todoist relay |
| 2A | **Active** | Consumer-ready multi-user identity, automatic private Personal provisioning, first-class integrations, DCC-owned scheduling, and family pilot |

Milestones 1G-A through 1G-G are closed. 1G-H is deployed and operational in production; its remaining work is closeout/evidence cleanup rather than product blocking. Milestone 2A is the active product milestone and moves DCC from owner-specific hosted plumbing toward a nontechnical multi-user onboarding and integration model. Do not reopen closed milestones unless a regression, security issue, or explicitly approved enhancement requires it.

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

The Financial Pulse is a read-only projection of existing canonical Income, Bills, and optional manual cash-baseline data. It reuses the canonical payday forecast and shows the selected workspace's next payday, expected income, Bills due before payday, projected known cash after payday when a baseline exists, and visible uncertainty.

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

## Operational integration — Todoist relay

The Todoist relay is now an operational, private scheduled bridge rather than an experiment. It uses the dedicated `Daily Command Center Inbox` project and a cron-only Cloudflare Worker with `workers.dev` and preview URLs disabled.

The bridge is:

**ChatGPT / source collectors → Todoist capture project → scheduled Cloudflare importer → canonical Daily Command Center persistence**

The importer supports the existing structured task-capture relay and the versioned 1G-H Daily Intake envelopes. Daily Command Center remains the system of record. Relay processing is idempotent, preserves Personal/Indelitech authorization, closes successfully persisted items, and leaves permanent failures visible rather than silently dropping them. Todoist credentials and the durable DCC user identity remain Cloudflare Worker secrets rather than repository or GitHub secrets.

The production deployment workflow preserves the canonical Todoist project ID, verifies the private Worker posture, applies D1 migrations before deployment, and now explicitly requires the 1G-H migration file before the remote migration step.

## Production milestone 1G-H — Daily Intake & Upcoming Events

Status: **Deployed and operational. Formal closeout/evidence cleanup remains.**

### Goal

Turn high-signal Gmail and Google Calendar findings into a conservative review inbox and useful calendar awareness without letting source automation silently mutate canonical Tasks or Bills.

### Implemented slices

- durable Daily Intake schema, source freshness, calendar projection, override, and scan-run state;
- versioned Todoist ingress envelopes for Gmail/Calendar findings and scan status;
- hosted Intake APIs with exact user/workspace authorization, terminal-state protection, defer/dismiss/archive, and conservative approval;
- idempotent approval into canonical Tasks, Follow-ups, and source-supported Bills;
- dedicated Intake review UI with Pending, Deferred, Awareness, and History modes;
- 45-day Google Calendar projections in Month/Agenda plus a dedicated Upcoming view;
- explicit Personal/Indelitech/All event scoping assembled from authorized reads rather than a synthetic server-side All workspace;
- recurring-event workspace correction with series scope by default and explicit occurrence-only override;
- lightweight Today summaries for today's events, the next seven days, Pending Intake count, and source-health warnings;
- deployment hardening that verifies `migrations/0012_daily_intake_events.sql` before the Todoist remote migration step; and
- launcher smoke coverage proving hosted Intake and Events routes remain registered, no-store, and fail closed when hosted Cloudflare bindings are unavailable.

### Safety and data boundaries

- Gmail and calendar automation creates reviewable Intake/projection records first; it does not directly manufacture canonical Bills or Tasks from inferred source data.
- Awareness findings cannot be approved.
- Bills require source-supported due date, amount, and currency before approval; missing values are not invented.
- Cross-workspace moves require authorization for the destination workspace.
- Personal roll-up behavior does not collapse Personal and Indelitech authorization boundaries.
- Calendar events remain projections and never inherit Task completion, priority, or overdue semantics.
- Hosted Intake/Event responses remain `Cache-Control: no-store`.

### Recurring scan boundary

Recurring 1G-H scans are intentionally bounded to the current operating window. After controlled bootstrap/acceptance, recurring Gmail collection should use the rolling recent window defined by the 1G-H automation plan rather than repeatedly mining the entire mailbox.

Historical Gmail cleanup is a **separate one-time activity**, not part of recurring 1G-H scans. Messages older than the approved bootstrap window should only be imported through an explicit historical-cleanup workflow with its own review/acceptance boundary; they must not silently expand the recurring scan scope.

### Remaining acceptance boundary

Before 1G-H can be marked closed:

- open the protected 1G-H PR and require the full Linux/macOS/Windows Check matrix plus review;
- merge only after explicit approval;
- deploy current main through the protected web/Todoist workflows and apply production migration `0012`;
- verify production Todoist relay behavior and source freshness;
- perform the controlled Gmail/Calendar bootstrap and the three planned source scans;
- create/enable the approved scheduled Automations only after source acceptance; and
- record production evidence in `docs/MILESTONE-1G-H-CLOSEOUT.md`.

See:

- `docs/superpowers/specs/2026-09-17-1g-h-daily-intake-design.md`
- `docs/superpowers/plans/2026-09-17-daily-intake-and-upcoming-events.md`


## Active milestone 2A — Consumer-ready identity, provisioning, and integrations

### Goal

Make DCC usable by nontechnical additional users without requiring customer-facing Cloudflare, Todoist, GitHub, API-key, or infrastructure setup, while preserving the existing physical workspace isolation model and preparing for a later commercial product.

### Immediate delivery order

1. safe automatic private Personal provisioning for a newly authenticated human user;
2. product authentication adapter behind the existing provider-neutral principal model;
3. first-class user-owned integration accounts and encrypted token storage;
4. DCC-owned scheduling instead of per-user ChatGPT Automations;
5. direct Gmail/Calendar collection into Intake and projections;
6. direct DCC conversational/task capture with Todoist retained only as a temporary fallback;
7. onboarding + Integration Health UI;
8. family pilot with cross-user isolation, lifecycle, and upgrade verification.

See `docs/MILESTONE-2A-CONSUMER-IDENTITY-INTEGRATIONS.md`.

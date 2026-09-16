# Milestone 1G-F3 — Cash Flow UI

Date: 2026-09-16

Branch: `milestone/1g-f3-cashflow-ui`

## Objective

Make the 1G-F forecasting foundation usable from the hosted Daily Command Center without adding bank connectivity or turning a forecast into financial advice.

The new `/cash-flow` surface works with exactly one authorized financial workspace at a time. Personal and Indelitech remain separate even though other product surfaces may visually roll Indelitech work into Personal.

## User-facing behavior

The Cash Flow surface provides:

- a next-payday summary from canonical EXPECTED Income occurrences;
- known expected income on that payday, preserving exact / estimated / unknown semantics;
- open Bills due before payday;
- a separate same-day Bills group so deposit-versus-charge ordering is never assumed;
- an optional manual available-cash baseline editor;
- projected known balance before/after payday only when a manual baseline exists;
- visible uncertainty when any relevant amount is estimated or unknown;
- Income Source create/edit/pause/resume/archive/restore controls;
- RECEIVED/SKIPPED/CANCELLED resolution for expected Income occurrences; and
- links back to the canonical Bills surface instead of mutating Bill occurrences from Cash Flow.

The workspace switcher now exposes both Bills and Cash Flow launchers while preserving the active logical workspace in the destination URL.

## Income editing

The UI supports the full 1G-F schedule model:

- one-time;
- weekly/every-N-weeks (including biweekly);
- monthly/every-N-months;
- yearly/every-N-years; and
- semimonthly with two configured calendar days.

FIXED income requires a normal net amount. VARIABLE income may intentionally leave the amount unknown.

Edits that change occurrence shape (amount semantics, currency, schedule anchor/frequency/rule) require an explicit effective date. The server remains authoritative for the persisted materialization boundary introduced by the 1G-F2 hotfix.

## Manual baseline

The baseline is explicitly labeled user-entered/manual and not bank verified. Signed values are allowed. The as-of date cannot be in the future.

The UI never labels a projection as an account balance or “safe to spend.”

## Forecast integrity

`buildPaydayForecast()` remains the source of forecast math. The UI adapts already-authorized canonical Income and Bill occurrences into its pure input model; it does not duplicate financial records into browser-owned persistence.

V1 presentation is USD-only. Any non-USD records are excluded from the USD calculation with a visible disclosure rather than silently converted.

## Explicitly out of scope

- bank/card/brokerage linking;
- transaction import or reconciliation;
- automatic balance detection;
- payment execution;
- safe-to-spend guidance;
- spending recommendations;
- debt optimization;
- investment tracking;
- Personal/Indelitech cash netting;
- Household shared-finance permissions; and
- financial advice.

## Acceptance expectations

Before closing 1G-F:

1. full Ubuntu/macOS/Windows Check passes;
2. hosted build still verifies the custom domain and Access posture;
3. production migration state remains current through 0010;
4. `/cash-flow` can create an Income Source and display the next payday;
5. a due-before-payday Bill appears in the correct group;
6. a same-day Bill appears separately;
7. adding a manual baseline produces a known-amount projection with uncertainty disclosure when appropriate;
8. Personal and Indelitech data remain financially isolated during workspace switching; and
9. temporary acceptance records are resolved/archived after verification.

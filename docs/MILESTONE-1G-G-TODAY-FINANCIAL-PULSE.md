# Milestone 1G-G — Today Financial Pulse & Command Summary

Date: 2026-09-16

Status: **Approved for implementation.**

## Goal

Make the hosted Today surface reflect the newly delivered 1G-F cash-flow domain so Daily Command Center answers both **what needs my attention today?** and **what is the near-term money picture?** without requiring the user to open Cash Flow first.

## Product behavior

Hosted Today gains a compact **Financial pulse** panel beneath the existing task-attention / 45-day-horizon area.

For the currently selected logical workspace, the panel shows:

- next expected payday/date;
- expected income on that payday;
- open Bills due before that payday, including overdue open Bills already counted by the canonical forecast;
- projected known cash after payday only when a manual baseline exists and the canonical forecast can calculate it; and
- visible uncertainty when estimated or unknown amounts remain.

The panel links to the canonical `/cash-flow?workspaceId=<workspace>` surface for full details and management.

## Workspace and financial-isolation rules

Financial Pulse does **not** inherit the Personal Today task/bill visual roll-up rule.

- Personal Financial Pulse reads Personal financial records only.
- Indelitech Financial Pulse reads Indelitech financial records only.
- Personal and Indelitech income, cash baselines, and forecast totals are never combined or netted.
- The logical workspace selected in the UI must be authorized through the existing hosted application session before financial data is requested.
- During a workspace change or stale response boundary, old financial state must fail closed and must never render under the newly selected workspace.

These rules preserve the 1G-F financial-integrity boundary even though task and bill projections elsewhere in Personal Today can visually include authorized Indelitech work.

## Canonical calculation rule

The panel must reuse `buildPaydayForecast` from `lib/runtime/cashflow-forecast.ts` rather than implement parallel money math.

The forecast inputs come from the existing authorized hosted endpoints:

- `/api/hosted/income?workspaceId=<logical-workspace>`
- `/api/hosted/bills?workspaceId=<logical-workspace>`
- `/api/hosted/cashflow/baseline?workspaceId=<logical-workspace>`

Bills and Income remain their canonical domain records. Financial Pulse is read-only projection UI and must not create, copy, resolve, edit, or delete financial records.

## Display semantics

### Next payday

Show the earliest expected income date at or after the product date using the existing forecast semantics. If no active expected income exists, show `Not set` and a short prompt to open Cash Flow.

### Expected income

Use the forecast's known total plus visible unknown-count language. Preserve exact / estimated / unknown semantics rather than converting unknown values to zero.

### Due before payday

Use the forecast's canonical `billsBeforePayday` summary. Same-day Bills remain excluded from this number because deposit/payment ordering on payday is intentionally not assumed.

### Projected known after payday

If no manual baseline exists, show `No baseline` rather than `$0.00`.

If a projection exists but estimated or unknown items remain, label it as a known-amount projection with uncertainty. Do not imply bank verification or spending safety.

## Failure, loading, and empty states

- The panel must clear previously loaded financial values before loading a different workspace.
- A read failure must not block Today task functionality.
- Loading state should be compact and non-disruptive.
- A financial-data error may be shown inside the panel with a retry path, but must not replace Today.
- Local mode does not expose Financial Pulse.

## Navigation

The panel's primary action is **Open Cash Flow**, preserving the active logical workspace in the query string.

No direct financial mutations occur from Today in 1G-G.

## Security and privacy

- Use only existing authenticated hosted financial routes.
- Preserve `Cache-Control: no-store` behavior from the underlying endpoints.
- Do not expose physical workspace IDs.
- Do not add browser-persisted copies of financial records.
- Do not log financial amounts as analytics or diagnostics.

## Explicitly out of scope

- bank/card linking;
- bank-verified balances;
- transaction import or matching;
- payment initiation;
- safe-to-spend calculations or financial advice;
- Household shared-finance UI;
- financial totals combining Personal and Indelitech;
- direct Bill/Income resolution from Today;
- changing the existing task/bill Today schedule behavior;
- changing 1G-F recurrence or forecast semantics.

## Acceptance criteria

1. Hosted Personal Today shows a Personal-only Financial Pulse.
2. Hosted Indelitech Today shows an Indelitech-only Financial Pulse and retains the existing Intel pulse.
3. Next payday, expected income, due-before-payday, and projected-known-after-payday values match the canonical Cash Flow forecast for the same workspace.
4. Missing baseline is represented as missing, never as zero.
5. Estimated/unknown amounts remain visibly uncertain.
6. Switching workspaces cannot show old financial values under the new workspace.
7. Financial read failure does not block tasks or the rest of Today.
8. Local mode does not fetch or render hosted financial records.
9. Clicking Open Cash Flow preserves the current logical workspace.
10. Normal Linux, macOS, and Windows repository checks pass before merge.

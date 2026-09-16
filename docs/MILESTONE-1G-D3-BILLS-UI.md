# Milestone 1G-D3 — Bills management UI

## Scope

This slice adds the first user-facing Bills & Obligations management surface on top of the 1G-D1 schema/recurrence engine and 1G-D2 authorized hosted API.

The UI is deliberately a dedicated `/bills` route rather than another large block inside `components/control-center.tsx`. The existing workspace header exposes Bills for the currently selected Personal or Indelitech workspace, and the Bills page preserves the same workspace identity/theme.

## Included

- Upcoming is the default Bills view.
- All Bills shows active/paused definitions and can explicitly include archived definitions.
- Add and edit Bill definitions.
- Fixed versus variable/estimated amount treatment.
- Unknown variable amounts remain visibly unknown and are never counted as `$0`.
- AutoPay is visibly labeled but never implies PAID.
- Overdue and due-today occurrences receive explicit non-color-only labels.
- Mark an occurrence PAID with paid date and optional actual amount/note.
- SKIP and CANCEL occurrence actions with optional resolution note.
- Pause/resume/archive/restore Bill definitions.
- Optional credential-free HTTPS `Pay bill` links.
- Occurrence-affecting edits expose an explicit effective date so resolved history and older open obligations are preserved.
- Financial API reads remain `no-store` through 1G-D2.
- Workspace access is still enforced entirely by the 1G-D2 server authorization boundary; the browser never sends a physical workspace ID.

## Navigation decision

`WorkspaceSwitcher` now includes a compact Bills launcher next to the current workspace controls. This avoids expanding the already crowded desktop/mobile tab strip and avoids adding more logic to the legacy monolithic `ControlCenter` component. `/bills?workspaceId=personal|indelitech` resolves the authenticated application session again and refuses unauthorized workspace switches.

The Bills page hides that launcher from its own switcher and provides a Dashboard return action.

## UI semantics

### Upcoming totals

The seven-day summary counts only OPEN occurrences in the inclusive seven-calendar-day window starting today.

- known amounts are summed;
- unknown amounts are counted separately;
- variable known amounts are called estimates;
- unknown values are never silently treated as zero.

### Schedule edits

The client mirrors the 1G-D2 occurrence-shape contract. Changing amount mode/default amount/currency/anchor date/recurrence unit/interval/day mode requires an `effectiveDate` no earlier than today. Metadata-only edits and status changes do not.

### Payment URLs

The form reuses `validateHostedBillDefinition`, so payment links must be HTTPS and cannot contain embedded username/password credentials. The UI does not store payment credentials, bank/card data, or biller passwords.

## Explicit non-goals

Still deferred:

- Today projection;
- shared Calendar projection;
- bank/card connections;
- automatic transaction matching;
- automatic bill discovery;
- payment execution;
- budgeting/envelopes;
- income/paycheck forecasting;
- Household invitation UI;
- ChatGPT/MCP Bills capture;
- lock-screen/mobile widget payloads.

Those remain later milestones, with Today/Calendar projection specifically reserved for 1G-E.

## Validation target

Before merge, the full Node 24.19.0 Ubuntu/macOS/Windows `Check` matrix must pass, including lint, tests, Next build, vinext Custom Domain verification on Ubuntu, MCP/Intel dry-run builds, and smoke.

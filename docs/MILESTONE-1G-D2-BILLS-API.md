# Milestone 1G-D2 — Authorized Bills repository and hosted API

Date: 2026-09-15

## Scope

This slice adds the server-authoritative Bills lifecycle on top of the 1G-D1 schema and recurrence engine. It intentionally does not add a Bills UI or Today/Calendar projection.

## Security boundary

- Every read/write starts from a verified Cloudflare Access session and a resolved logical workspace membership.
- `D1BillRepository` requires an authenticated hosted workspace instance and revalidates the current membership before touching Bill rows.
- Physical `workspace_id` remains server-only; browser responses expose the logical `personal` / `indelitech` workspace slot.
- Bill and occurrence IDs never grant access by themselves. Queries always include the authorized physical workspace boundary.
- Hosted financial responses use `Cache-Control: no-store`.
- Payment URLs must be valid HTTPS URLs without embedded username/password credentials.

## Lifecycle behavior

- Create inserts the Bill and its bounded initial occurrence horizon atomically with D1 `batch()`.
- Active recurring Bills materialize only current/future obligations; old anchors do not manufacture years of historical debt.
- One-time Bills may be created already overdue so a real outstanding obligation is not silently hidden.
- Authenticated reads idempotently replenish the next 12 months of active occurrences using deterministic `(bill_id, due_date)` uniqueness.
- PAID/SKIPPED/CANCELLED actions target the concrete occurrence, preserve history, record the authenticated resolver and a separate server `resolved_at` audit instant, and never infer payment from AutoPay.
- Occurrence-affecting edits (schedule, expected amount mode/value, or currency) require an explicit effective date that is not before today. Only future OPEN occurrences on/after that date are replaced; resolved history is preserved.
- PAUSED/ARCHIVED Bills stop new occurrence generation without deleting existing history.
- There is no destructive Bill delete endpoint in this slice.

## Hosted API

`/api/hosted/bills`

- `GET` — list authorized Bill definitions and current OPEN occurrences; optional `includeArchived=true|false`.
- `POST` — create a Bill definition.
- `PATCH` — replace the mutable Bill definition; occurrence-affecting edits require `effectiveDate`.

`/api/hosted/bills/occurrences`

- `GET` — list authorized occurrence history with optional `billId`, `fromDate`, and `throughDate` filters.
- `POST` — resolve one OPEN occurrence as PAID, SKIPPED, or CANCELLED.

## Deferred

1G-D3 will add the Bills management surface. 1G-E will project canonical occurrences into Today and Calendar. Banking, transaction matching, payment execution, automatic bill detection, Household invitation UI, and ChatGPT Bill capture remain out of scope.

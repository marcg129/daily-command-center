# Milestone 1G-E — Bills in Today and Calendar

## Goal
Project canonical open bill occurrences into the existing hosted Today and Calendar surfaces without creating task rows, copying bill data into tasks, or changing task mutation behavior.

## Product behavior
- **Personal Today/Calendar** rolls up authorized Personal + Indelitech bill occurrences, matching the existing task visibility model.
- **Indelitech Today/Calendar** shows only authorized Indelitech bill occurrences.
- Today surfaces overdue and due-today open bill occurrences beside today's task due dates, reminders, and follow-ups.
- Calendar surfaces all materialized open bill occurrences alongside task calendar entries.
- Bill entries use a bill icon and amount semantics and open the canonical Bills surface for their source logical workspace.
- Resolved, paused, and archived bills do not project as open obligations.
- AutoPay remains informational only; it never marks a projected occurrence paid.

## Security and data boundaries
The browser first resolves the authenticated hosted application session and requests Bills only for logical workspaces present in that session. The existing hosted Bills endpoint remains responsible for physical workspace resolution and fail-closed authorization. No physical workspace IDs are exposed to the browser.

## Canonical-record rule
Calendar and Today are projections only. They do not create or mutate TaskItem records for bills. Task clicks continue to open canonical Tasks; bill clicks route to `/bills?workspaceId=<logical-workspace>`.

## Out of scope
- resolving or editing a bill directly from Today/Calendar
- bank or transaction integrations
- new reminder notifications for bills
- Household workspace invitations
- deleting bill history

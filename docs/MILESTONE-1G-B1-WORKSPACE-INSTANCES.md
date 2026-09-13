# Milestone 1G-B1 — Physical workspace instances

## Objective

Allow different application users to have separate physical Personal workspaces while preserving the current product vocabulary (`personal` / `indelitech`), Marc's existing production rows, and the Indelitech-to-Marc-Personal roll-up.

## Architecture

1G-A made application users and workspace memberships canonical, but a membership still pointed directly at the product ID. That meant every user whose UI said **Personal** would ultimately address the same physical D1 row named `personal`.

1G-B1 separates two concepts:

- **workspace key** — the stable user-facing product slot (`personal` or `indelitech`);
- **workspace ID** — the exact physical D1 persistence and authorization boundary.

`workspace_memberships` now maps one active user and logical `workspace_key` to one exact physical `workspace_id`. The unique `(user_id, workspace_key)` constraint fails closed if a user is ever given two physical instances for the same product slot.

Examples:

| User | Logical slot | Physical workspace |
| --- | --- | --- |
| Marc | `personal` | `personal` |
| Marc | `indelitech` | `indelitech` |
| Future second user | `personal` | a distinct Personal workspace row |

The physical ID never needs to leave the hosted server. `/api/hosted/session` continues returning safe logical workspace choices, and browser requests continue asking for `personal` or `indelitech`.

## Server authorization

`D1WorkspaceResolver` now performs the complete mapping:

verified Cloudflare Access principal → active application user → exact logical membership → physical workspace instance.

It returns an internal request context containing the application user, physical workspace ID, and logical workspace key. Directly supplying a physical workspace ID through a hosted route is rejected as an unknown product workspace.

Task persistence uses physical IDs in D1 but translates task ownership back to the authenticated user's logical workspace key before returning the task model. Reads also require the authenticated user to be a member of the task's physical source workspace, providing defense in depth if a bad visibility row were ever introduced.

## Roll-up policy

The old task-visibility trigger hard-coded `indelitech -> personal` as two global IDs. Migration `0008_workspace_instances.sql` replaces that special case with `workspace_rollups(source_workspace_id, target_workspace_id)`.

The migration seeds the existing physical relationship:

`indelitech -> personal`

This preserves Marc's current behavior without moving or rewriting production tasks. Future roll-ups can be explicit physical relationships instead of assuming every user's Personal workspace is the global `personal` row.

## Migration safety

Migration 0008:

- preserves existing workspace IDs and application users;
- rebuilds `workspace_memberships` with `workspace_key` and a per-user logical-slot uniqueness constraint;
- backfills existing `personal` and `indelitech` memberships to the matching logical keys;
- preserves all existing task rows and visibility rows;
- adds the physical `workspace_rollups` relationship table;
- replaces the task-visibility trigger with a generic physical-workspace rule; and
- does not create or invite any additional production user.

A rollback across this schema change requires restoring the matching pre-migration D1 recovery point/backup together with the earlier application revision.

## Boundaries

This slice does not add invitations, Household UI, Bills, domain changes, PWA/native mobile work, widgets, or user-facing RBAC. It does not provision Christa or Marc's sister into production; it establishes and tests the safe architecture that later provisioning will use.

## Validation targets

- Marc still resolves logical Personal to physical `personal` and Indelitech to physical `indelitech`.
- A second user can resolve logical Personal to a different physical workspace.
- Physical workspace IDs cannot be used as public route selectors.
- Separate Personal instances isolate task reads and mutations.
- Task rows and visibility rows are written to the correct physical workspace IDs while the returned task model remains logical.
- Disabled/unmapped users and missing/ambiguous memberships fail closed.
- Existing Indelitech-to-Marc-Personal roll-up behavior remains intact.
- Existing hosted collector/system paths continue to work with physical workspace contexts.

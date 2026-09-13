# Milestone 1G-A — User/workspace ownership foundation

Date: 2026-09-13

Branch: `milestone/1g-a-user-workspace-ownership`

## Goal

Introduce a durable application-user and workspace-membership boundary without changing the current Personal or Indelitech experience.

Cloudflare Access still answers who authenticated. The application now independently resolves that verified principal to an active application user and an exact workspace membership before any hosted task or Intel repository access.

## Canonical ownership model

Migration `0007_user_workspace_ownership.sql` adds:

- `users`: durable, provider-neutral application users with an active/disabled state;
- `user_principals`: authentication principals mapped to exactly one application user;
- `workspace_memberships`: exact user/workspace relationships with minimal `OWNER` or `MEMBER` role semantics.

`workspace_memberships` is the sole authorization source. The previous `principal_workspace_grants` table is migrated and removed rather than retained as a competing authorization path.

Both roles currently authorize the existing workspace read/write surface. The distinction records durable ownership without prematurely creating feature-level RBAC. Later milestones may narrow member capabilities through this same boundary.

## Migration and production-data safety

Every existing principal is deterministically backfilled to one `legacy:<principal-id>` user, every principal mapping is retained, and every exact grant becomes an `OWNER` membership. Existing workspace IDs and all task, visibility, collector, and workspace-domain foreign keys are unchanged.

The migration deliberately does not guess that two different authentication principals represent the same person. If production ever contains more than the expected owner principal, each is preserved as a separate legacy user instead of silently merging identities.

Migration tests prove that:

- Personal and Indelitech grants survive as exact owner memberships;
- existing private task rows and visibility rows are unchanged;
- duplicate memberships and missing workspace references fail closed;
- future workspace rows such as Household are no longer blocked by the old two-workspace grant constraint.

Before applying `0007` in production, retain a recoverable pre-migration D1 backup or recovery point. Rolling application code back across this migration also requires restoring the matching pre-migration database; old code expects the removed grant table.

## Authorization behavior

`D1WorkspaceResolver` now authorizes only when all of these are true:

1. the request has a cryptographically verified, unexpired Access identity;
2. the principal maps to a durable application user;
3. that user is active;
4. that exact user has an `OWNER` or `MEMBER` relationship to the requested workspace.

Missing mappings, disabled users, missing memberships, wrong workspace IDs, and authenticated cross-user requests all fail closed. Route handlers still construct or use workspace-scoped repositories only after this resolver succeeds.

## Operational changes

The existing **Cloudflare bootstrap workspace grants** workflow now idempotently creates the legacy owner user and principal mapping, creates exact Personal and Indelitech owner memberships, and verifies the joined active-user result. The workflow name remains unchanged to avoid unnecessary operational churn.

## Explicit boundaries

This milestone does not:

- change Cloudflare Access session verification or expose identity-provider attributes;
- add user invitations, profile UI, Household, or additional Personal workspaces;
- change current workspace IDs, task visibility, Indelitech-to-Personal roll-up, or task APIs;
- add enterprise RBAC, field-level permissions, or a second authorization system;
- change DNS, the production hostname, Workers exposure, D1/KV bindings, or deployment credentials;
- implement Bills, PWA/native mobile behavior, widgets, or banking integrations.

## Validation

Focused tests cover migration preservation, active/disabled users, missing principal mappings, exact memberships, unknown workspaces, duplicate memberships, authenticated cross-user task reads and deletes, unauthorized capture, hosted Intel grants, owner bootstrap wiring, and the existing Personal/Indelitech roll-up.

The normal repository Check, MCP build, Intel Worker build, smoke tests, and final diff review remain required before merge.

# Milestone 1B-B: hosted workspaces and D1 persistence

Date: 2026-09-11  
Branch: `milestone/1b-workspaces-d1`  
Baseline: `47b220dfe398eca8cbddda5ca32aaa3351ebf79f`

## Outcome and boundaries

This milestone defines the first hosted, multi-workspace persistence model while leaving the existing local application, routes, UI, SQLite database, JSON files, scheduler, and loopback security policy as the runtime defaults. Nothing selects a workspace in the UI, accepts hosted traffic, authenticates a production user, stores a hosted secret, configures Cloudflare, or deploys.

The hosted repository code is dependency-injected with a small D1-compatible database contract. It is not connected to a route. The local `LocalWorkspaceRepository` and `LocalCollectorSnapshotRepository` remain unchanged and continue to reject every context except `legacy-local`.

## Stable workspace identities

Runtime constants define three stable IDs:

| Constant | ID | Meaning |
| --- | --- | --- |
| `PERSONAL_WORKSPACE_ID` | `personal` | Future Personal product workspace |
| `INDELITECH_WORKSPACE_ID` | `indelitech` | Future Indelitech product workspace |
| `LEGACY_WORKSPACE_ID` | `legacy-local` | Existing single-machine, pre-import context only |

Names and theme keys are metadata and cannot change identity. Migration `0001` creates an extensible `workspaces` table and seeds Personal (`personal-tech-blue`) and Indelitech (`indelitech-business`). It does not constrain the table to exactly two rows, so later migrations may add workspaces.

## Authorization architecture

```text
Authenticated principal
          ↓
  WorkspaceResolver
          ↓
    RequestContext
          ↓
     Repositories
       ↙      ↘
   Local       D1
  adapter    adapter
```

`WorkspaceResolver` is the future authenticated boundary. The milestone includes only a fake, grant-backed resolver for contract tests. It denies a missing/unknown principal, an unknown product workspace, and a principal without an explicit grant. Supplying `personal` or `indelitech` is never itself proof of authorization. No HTTP code invokes this fake.

Hosted adapters require a non-null, validated product `RequestContext` on every operation. `legacy-local` is rejected by hosted adapters, just as product IDs remain rejected by local adapters. Every workspace-owned D1 query binds `workspace_id`; there is no ambient/default hosted tenant.

## Versioned D1 schema

These ordered migrations use ordinary D1/SQLite SQL and deliberately do not use the local request-time `PRAGMA user_version` strategy:

1. `migrations/0001_workspaces.sql` creates and seeds workspace metadata.
2. `migrations/0002_tasks.sql` creates normalized tasks, task visibility, indexes, constraints, and visibility/ownership triggers.
3. `migrations/0003_collector_snapshots.sql` creates workspace-scoped collector cache state with `(workspace_id, collector, scope)` uniqueness.

The task row retains separate `due_at`, `remind_at`, and `follow_up_at` fields. Recurrence-series membership and its calendar anchor are queryable first-class data in nullable `series_id` and `recurrence_anchor_day` columns; they are semantically separate from the nullable `dependency` blocker field. Canonical types, priorities, and statuses have SQL checks and matching TypeScript unions. Ownership is explicit through `primary_workspace_id`; visibility never changes ownership. The primary workspace is immutable. No production task or collector data is seeded.

`due_is_date_only=1` requires a ten-character calendar date in `due_at`. Such a value is not converted to an instant or midnight. A timestamp deadline remains an actual ISO instant.

## Visibility and isolation

```text
       Indelitech task
              ↓
        one task row
          ↙       ↘
 Indelitech     Personal
 visibility   visibility
```

`task_visibility` is a normalized many-to-many relation, not a task boolean and not a duplicated task. V1 policy permits a row in its primary workspace and permits an Indelitech-owned task in Personal. A Personal-owned task cannot be exposed in Indelitech. This is enforced three times: create validation, scoped read predicates, and a database trigger. Consequently, even a malformed relation cannot turn into a cross-workspace read. A shared task read from Personal and Indelitech has the same `task_id`; mutation through either authorized view updates that one row.

The generic relation can support later reviewed sharing rules through a versioned policy migration. Broadening it must never broaden secret access.

## Adapters

`D1TaskRepository` implements the normalized Promise-based `HostedTaskRepository`. It supports scoped list/get/create/update, validates primary ownership and allowed visibility, uses a batched create for one task plus its visibility rows, and makes ownership immutable at its contract boundary. It accepts an injected `D1Database`, allowing contract tests to execute the exact SQL without routes or Cloudflare deployment.

`D1CollectorSnapshotRepository` implements the existing `CollectorSnapshotRepository`. Reads, writes/upserts, and archive updates bind the context workspace. Cache keys are unique inside a workspace, so identical collector/scope values across Personal and Indelitech remain independent.

The existing UI `WorkspaceState` shape is intentionally not declared to be the normalized hosted task model. Replacing all route/UI DTOs is a non-goal. The hosted task contract is the task-workspace persistence seam; a later application service can map DTOs deliberately rather than losing the additional hosted fields. The local `WorkspaceRepository` remains the current route default.

## Effective overdue attention and horizon

`isTaskOverdue`, `effectivePriorityRank`, and `taskHorizonGroup` are pure query-model helpers. Stored priority remains exactly `LOW`, `MEDIUM`, or `HIGH`; overdue computes rank 4, ahead of non-overdue `HIGH` rank 3, without a write. Timestamp deadlines compare instants. Date-only deadlines compare the due calendar date with today's calendar date in the explicitly supplied IANA time zone, becoming overdue only after that local date passes.

The grouping helper yields `OVERDUE`, `TODAY`, `NEXT_7_DAYS`, `DAYS_8_14`, `DAYS_15_30`, `DAYS_31_45`, or `LATER_OR_UNSCHEDULED`. This supports a later 45-day view without adding that UI now.

## Deterministic legacy import plan

No import runs automatically. `transformLegacyWorkspace` is pure and requires one explicit V1 destination policy:

- `personal`: assign every legacy task to Personal;
- `indelitech`: assign every legacy task to Indelitech;
- `review`: produce an unassigned review list and no hosted tasks.

There is no AI classification. A safe legacy ID is preserved. Unsafe IDs receive a deterministic `legacy-<hash>` ID; deterministic numeric suffixes resolve collisions, references use the resulting ID map, and the returned map makes the decision auditable. Legacy date strings remain date-only. Active recurring rows and completed occurrence rows are both transformed; completion timestamps are retained, while legacy `seriesId` and `recurrenceAnchorDay` become the first-class hosted `seriesId` and `recurrenceAnchorDay` fields (and remain in source context for audit). Legacy tasks have no genuine dependency field, so import always leaves hosted `dependency` null rather than misusing it for recurrence membership. Reminders are not imported because this milestone does not justify a hosted reminder schema; an importer must report them for a future explicit plan rather than dropping them silently.

## Settings and secret ownership

Hosted secret storage is intentionally absent. Its future authorization model has three disjoint owners:

- **application-level:** platform-operated credentials needed independently of a user/workspace;
- **user-level:** credentials belonging to an authenticated principal and not inherited by workspace viewers;
- **workspace-level:** credentials usable only under an explicit grant for that owning workspace.

Indelitech content visibility in Personal grants access only to the visible content record. It never grants Personal access to Indelitech OAuth tokens, AI keys, collector credentials, or settings secrets. Content visibility and secret authorization must remain separate repository contracts and checks.

## Verification

Before changes, `npm ci`, lint, all 220 tests, standalone TypeScript checking, and the production build passed. The environment supplies Node 24.15.0 while the repository requires Node 24.19.0, so setup rejected the runtime and smoke could not start. This is an environment limitation.

`npx vinext check` was attempted without running `vinext init`. npm again returned `403 Forbidden` while retrieving `https://registry.npmjs.org/vinext`; therefore no checker ran and compatibility remains inconclusive rather than failed.

Focused tests cover identity validation, missing/invalid contexts, D1 task CRUD behavior (including series ID and recurrence-anchor round trips), positive and negative workspace isolation, Indelitech-to-Personal visibility, prohibited Personal-to-Indelitech visibility, malformed direct visibility, shared-record mutation, effective overdue priority, local date-only behavior, all 45-day groups, collector cache isolation, fake resolver grants/spoof resistance, and all legacy import policies/determinism. Import assertions prove active/completed recurrence relationships and anchors survive while dependency remains null. The pre-existing local adapter test continues to prove its fail-closed behavior.

## Remaining blockers and exact next milestone

Before user-facing workspaces, the application still needs real authentication/session validation; a production `WorkspaceResolver`; reviewed application/user/workspace secret storage; D1 adapters and migrations for every remaining workspace-owned store; transaction/idempotency validation against real D1; hosted outbound-fetch controls; Scheduled Events/Queues; authenticated mutation/CSRF/origin policy; export/backup/operations; an actual vinext compatibility result; and a non-production integration environment. None should be bypassed by exposing the new adapters directly.

**Exact recommended next task — Milestone 1B-C:** implement production-independent authentication/session and secret-ownership contracts, add encrypted-provider abstractions and authorization contract tests, then adapt the remaining workspace-owned persistence interfaces to scoped D1 migrations/adapters and run the complete contract suite against a real local D1 emulator; retain local defaults and do not enable hosted traffic or UI workspace switching.

# Milestone 1D-A — Task-Level Persistence

## Goal

Replace the active UI's whole-workspace task autosave with atomic task-level persistence while preserving all Milestone 1C behavior and the existing local recovery/import path.

This is the persistence prerequisite for safe `SEND TO TASKS` ingestion and later hosted D1 wiring.

The problem being solved is concrete: today the client saves `{ reminders, tasks }` as one workspace blob. If a future external capture endpoint appends a task while the browser still has an older task array, the next whole-workspace save could silently overwrite that captured task. Milestone 1D-A must remove that lost-update path before external task capture is added.

This milestone remains local/SQLite. It does **not** deploy Cloudflare or expose an external capture endpoint.

## Principles

- One task record, one canonical ID.
- Task changes persist at task granularity, not by replacing the entire workspace task array.
- Multi-record task transitions such as recurring completion must persist atomically.
- Reminders and tasks must no longer overwrite each other.
- Existing first-run import and recovery remain safe.
- The active UI should remain optimistic and responsive.
- Preserve Personal/Indelitech visibility and ownership semantics.
- Primary workspace ownership is immutable after task creation.
- Completed recurring occurrence history remains protected.
- Build the service boundary so a later D1 adapter can replace local SQLite without redesigning the UI contract.

## Scope

### 1. Task mutation contract

Add a runtime-neutral task mutation contract for the compatibility `TaskItem` surface.

Support operations equivalent to:

- CREATE
- UPDATE
- DELETE

A batch contains one or more operations and is applied atomically.

Example conceptual shape:

```ts
type TaskMutation =
  | { kind: "CREATE"; task: TaskItem }
  | { kind: "UPDATE"; taskId: TaskItem["id"]; task: TaskItem }
  | { kind: "DELETE"; taskId: TaskItem["id"] };
```

Exact naming may differ, but the contract must be typed, validated, runtime-neutral, and deterministic.

Do not accept arbitrary partial JSON and spread it directly into persisted state.

### 2. Pure task diff helper

Add a pure helper that compares two canonical task arrays and produces a mutation batch.

It must correctly detect:

- new task -> CREATE
- changed existing task -> UPDATE
- removed task -> DELETE
- unchanged task -> no operation

Requirements:

- deterministic operation ordering;
- no duplicate operations for the same ID;
- recurring completion, which creates a completed occurrence and advances the series, produces the required CREATE + UPDATE in one batch;
- same-ID cross-workspace mutation remains an UPDATE, never a clone;
- compare canonical persisted fields, not object identity.

This helper must have focused tests.

### 3. Atomic local task persistence

Add a local SQLite task-mutation adapter/service that operates on the existing saved task data without creating a second conflicting local source of truth.

It may continue using the existing `workspace_state` `tasks` row during this compatibility stage, but task mutation must happen inside one `BEGIN IMMEDIATE` transaction.

For each batch:

1. begin transaction;
2. read current persisted tasks;
3. normalize safely using existing task normalization;
4. validate and apply the entire mutation batch;
5. preserve protected recurring completion history;
6. write the resulting task list once;
7. commit;
8. rollback on any failure.

No partial batch may survive a failed operation.

The adapter must not mutate reminders.

### 4. Task mutation validation

CREATE:

- requires a valid unique task ID;
- requires non-empty title;
- requires canonical `primaryWorkspaceId` (`personal` or `indelitech`);
- does not default an invalid new owner to Personal;
- accepts the already-supported canonical task fields;
- runs through canonical task normalization before persistence.

UPDATE:

- target ID must exist;
- replacement task ID must equal target ID;
- `primaryWorkspaceId` must remain unchanged;
- preserve protected recurring-history semantics;
- canonicalize status/priority/timestamps using existing task normalization;
- must not create a second task record.

DELETE:

- removes exactly the requested mutable record;
- completed recurring occurrence/history records remain protected under the same rule used by existing workspace persistence;
- deleting an active recurring series must not silently erase its prior completed occurrences.

Unknown operation kinds, malformed payloads, duplicate conflicting operations, or invalid task data must reject the entire batch.

### 5. Local task API

Add a local task API boundary.

Preferred shape:

- `GET /api/tasks` -> canonical task list
- `POST /api/tasks/mutations` -> atomically apply one mutation batch and return the canonical resulting task list

If a slightly different REST shape materially improves maintainability, document the choice, but preserve one atomic batch endpoint.

The route should use a handler/service factory with injected dependencies where practical so business logic is testable without HTTP or a real database.

This local route is **not** an external integration endpoint and needs no new public auth scheme in 1D-A.

Do not add `SEND TO TASKS` or a bearer-token capture route yet.

### 6. Reminder-specific persistence

Normal reminder edits must stop causing a whole-workspace task rewrite.

Add a reminder-only persistence path, for example:

- `PUT /api/reminders`

or an equivalent narrowly scoped handler.

It must update only reminders and leave the persisted task row untouched.

Do not expand the old standalone Reminders product concept; this is only compatibility persistence for inherited reminder data and existing internal save-story functionality.

### 7. Preserve `/api/workspace` for bootstrap/recovery only

The legacy workspace endpoint remains useful for:

- first-run browser/local import;
- explicit recovery before the UI becomes writable;
- backwards compatibility tests.

Do not delete it in this milestone.

However, after normal bootstrap completes, task edits must no longer be persisted through whole-workspace PUTs.

Normal reminder edits must also use the reminder-specific path.

### 8. Client task persistence queue

Keep the existing React task state and optimistic UI.

Do **not** perform network side effects inside a React state-updater function.

Use a safe pattern such as:

- a `lastScheduledTasksRef` / canonical baseline;
- an effect that observes committed task state;
- pure diff from last scheduled state -> current state;
- immediately advance the scheduled baseline;
- enqueue the resulting mutation batch on the existing or a dedicated promise queue;
- execute batches sequentially in creation order.

Rapid UI changes must preserve ordering.

A recurring completion's CREATE occurrence + UPDATE series must be one HTTP batch, not two unrelated requests.

If no task difference exists, make no task request.

### 9. Reminder persistence queue

Persist reminder changes independently from tasks.

A reminder save must never send or replace the task array.

Task mutations must never send or replace the reminder array.

The existing recovery copy may continue containing both arrays because it is an emergency/bootstrap snapshot, not the normal mutation path.

### 10. Error and recovery behavior

Preserve the existing visible save-error behavior and local recovery snapshot.

On a failed task mutation:

- do not silently claim success;
- leave the user's optimistic state/recovery data intact;
- show the existing save-error treatment or an equivalent task-specific message;
- later queued mutations must not be silently reordered ahead of the failed batch.

Use a deterministic recovery strategy. Do not automatically overwrite server state with stale browser state after a failed mutation.

On successful persistence, the normal recovery snapshot may be cleared only when it corresponds to the latest successfully persisted UI state.

Do not weaken the current protection against corrupt/incomplete workspace data.

## Compatibility requirements

Preserve all Milestone 1C semantics:

- Personal sees Personal + Indelitech roll-up;
- Indelitech sees Indelitech only;
- one record across workspace views;
- immutable task ownership;
- Quick Add ownership;
- LOW/MEDIUM/HIGH normalization;
- overdue attention;
- 45-day due-date horizon;
- due date independent from reminder;
- WAITING/follow-up behavior;
- Resume restoration rules;
- Cancel vs Delete;
- recurring monthly anchoring;
- recurring completion history;
- America/New_York date/time semantics;
- no standalone Reminders navigation.

Do not reintroduce the stale `Control Center` smoke branding expectation.

## Hosted architecture alignment

Do not wire production D1 in this milestone, but avoid choices that block it.

Existing hosted pieces already include:

- `HostedTaskRepository`;
- `D1TaskRepository`;
- canonical workspace visibility;
- hosted task schema/migrations.

The 1D-A HTTP/service boundary should be structured so 1D-B/1D-C can replace the local mutation adapter with a hosted D1-backed adapter without changing the visible task UX or inventing a second API contract.

If a small extension to an existing runtime-neutral repository interface clearly reduces future duplication, make it deliberately and update both affected adapters/tests. Do not perform a broad hosted rewrite in 1D-A.

## Do not implement in 1D-A

- SEND TO TASKS external ingestion;
- natural-language/AI task parsing;
- bearer-token public capture endpoint;
- automatic reminder inference;
- background reminder delivery;
- Telegram/email/push;
- Google Calendar sync;
- Cloudflare scheduled workers;
- Cloudflare Access configuration;
- production D1 route composition;
- production deployment;
- unrelated Industry/Mentions/Newsletter refactors.

## Required tests

At minimum prove:

1. pure diff returns no operations for identical canonical task arrays;
2. adding one task produces one CREATE;
3. editing one task produces one UPDATE;
4. removing one mutable task produces one DELETE;
5. recurring completion produces completed-occurrence CREATE + series UPDATE in one batch;
6. same-ID Personal roll-up mutation is UPDATE, not CREATE;
7. duplicate task IDs in a mutation batch reject the batch;
8. CREATE with invalid workspace owner rejects instead of defaulting to Personal;
9. UPDATE cannot change `primaryWorkspaceId`;
10. UPDATE cannot change the task ID;
11. failed second operation rolls back the first operation;
12. task batch never modifies reminders;
13. reminder-only persistence never modifies tasks;
14. DELETE of an active recurring series preserves existing completed occurrence history;
15. protected recurring completed occurrence cannot disappear through an ordinary task-state diff/save;
16. task API GET returns canonical normalized tasks;
17. task mutation API returns the resulting canonical task list;
18. malformed/unknown mutation payload returns 400 without changing persistence;
19. legacy `/api/workspace` first-run import still imports both task and reminder data;
20. normal post-bootstrap task persistence no longer sends a whole-workspace task replacement;
21. normal reminder persistence no longer sends the task array;
22. existing workspace/task/reminder recovery tests remain green;
23. all existing recurring, workspace visibility, D1, task-action, and smoke tests remain green.

Add more tests where required by the implementation.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run smoke`
- `git diff --check`

CI Node remains 24.19.0. Do not weaken engines for an older local environment.

## Branch / PR

Work on:

`milestone/1d-task-persistence`

PR target:

`main`

Keep the PR focused on 1D-A. Do not mix structured capture or production hosting into this change.

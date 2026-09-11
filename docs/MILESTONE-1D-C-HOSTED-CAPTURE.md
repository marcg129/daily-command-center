# Milestone 1D-C — Hosted Structured Capture Composition

## Goal

Make the structured `SEND TO TASKS` contract completed in Milestone 1D-B usable through the existing hosted/D1 task architecture without exposing a public Internet endpoint yet.

This milestone is about **hosted composition and schema parity**, not deployment.

By the end of 1D-C:

- the same structured capture input can create a canonical hosted `HostedTask`;
- hosted capture requires an already-authorized product `RequestContext`;
- the capture workspace must match the authorized context;
- idempotency remains stable even after the saved task is later edited/completed;
- D1 preserves the immutable capture fingerprint;
- D1 preserves the exact duration label (`5m`, `15m`, `30m`, `1h`, `2h+`, `Project`) without breaking the existing numeric duration field;
- Personal/Indelitech visibility remains the existing V1 policy;
- no public/auth-bypass route is introduced.

## Do not change the product boundary

Do **not** add:

- a public bearer-token endpoint;
- permissive CORS;
- Cloudflare Access configuration;
- production deployment;
- webhook auth;
- natural-language/LLM parsing;
- Telegram/email/push delivery;
- Google Calendar sync;
- background schedulers.

The existing local `/api/tasks/capture` route remains local/development-only.

## Shared structured-capture contract

Reuse the 1D-B contract and validation from `lib/runtime/task-capture.ts`.

Do not create a second parser with slightly different rules.

Refactor/export small pure helpers where useful so local and hosted capture share:

- parsing/normalization;
- deterministic task ID derivation (`capture:<requestId>`);
- immutable capture fingerprint calculation;
- timing/default semantics;
- duration enum values;
- interpretation output semantics.

The exact replay fingerprint must continue to be based on immutable normalized capture input, not mutable task state.

## Hosted schema additions

Add migration:

`migrations/0005_task_capture_metadata.sql`

Add two nullable columns to `tasks`:

1. `capture_fingerprint TEXT`
2. `estimated_duration_label TEXT`

`estimated_duration_label` must allow only:

- `5m`
- `15m`
- `30m`
- `1h`
- `2h+`
- `Project`

or `NULL`.

Do not rewrite migration 0002.

Existing rows must remain valid and receive `NULL` for both new fields.

No new index is required solely for capture fingerprint because hosted idempotency continues to use deterministic `task_id` lookup.

## HostedTask compatibility

Extend `HostedTask` with nullable/optional capture metadata in a backward-compatible way:

- `captureFingerprint`
- `estimatedDurationLabel`

Prefer a shared duration type if it can be introduced without a dependency cycle.

Do not remove or repurpose the existing numeric `estimatedDuration` field.

For structured capture map duration as follows:

- `5m` -> numeric `5`, label `5m`
- `15m` -> numeric `15`, label `15m`
- `30m` -> numeric `30`, label `30m`
- `1h` -> numeric `60`, label `1h`
- `2h+` -> numeric `120`, label `2h+`
- `Project` -> numeric `NULL`, label `Project`
- omitted -> numeric `NULL`, label `NULL`

The label is the canonical lossless structured value. The numeric field remains useful for existing/future minute-based consumers.

## D1 repository changes

Update `D1TaskRepository` to round-trip both new columns on:

- list
- get
- create
- update

Avoid hard-coded placeholder counts that can drift from the column list. If practical, derive the insert placeholder count from the canonical column list.

Preserve all current repository protections:

- hosted context required;
- primary workspace immutable;
- create must come from primary workspace;
- visibility policy enforced both in repository and DB trigger;
- Personal cannot leak into Indelitech;
- Indelitech may roll up into Personal.

A normal hosted task update must preserve whatever capture fingerprint is already present unless the caller explicitly passes the identical value. Do not allow the hosted capture fingerprint to be silently replaced by a different value through an ordinary update path.

If the simplest safe implementation is to reject a changed `captureFingerprint` when an existing non-null fingerprint differs, do that.

## Hosted capture service

Add a runtime-neutral hosted capture service, for example:

`createHostedStructuredTaskCaptureService(repository, clock)`

with an invocation shape equivalent to:

`capture(context, value)`

where `context` is an already-authorized `RequestContext`.

The service must:

1. call the same structured capture parser used by local capture;
2. require `requireHostedContext(context)`;
3. require `input.workspaceId === context.workspaceId`;
4. derive deterministic task ID `capture:<requestId>`;
5. build one canonical `HostedTask`;
6. calculate/persist the same immutable capture fingerprint used by local capture;
7. use `HostedTaskRepository.get()` for idempotency within the authorized view;
8. create through `HostedTaskRepository.create()` with canonical visibility;
9. return `created`, the saved hosted task, and the same concise interpretation semantics used by 1D-B;
10. never update an existing task merely because a request ID was replayed.

Visibility on create:

Personal capture:

`[personal]`

Indelitech capture:

`[indelitech, personal]`

Use the existing shared V1 visibility policy rather than duplicating unrelated rules.

## Hosted idempotency and privacy

Exact replay behavior:

- same request ID + same immutable capture fingerprint -> return existing task with `created: false`;
- later user edits/completion/snooze must not break exact replay;
- same request ID + different fingerprint in the authorized view -> conflict;
- non-capture task occupying the deterministic ID in the authorized view -> conflict.

Do not weaken workspace isolation to discover hidden cross-workspace collisions.

Example:

- if Indelitech context attempts to create a deterministic ID that happens to collide with a hidden Personal-only task, the DB create may fail;
- do not perform a privileged/global lookup merely to reveal that hidden task;
- surface a safe persistence failure rather than leaking hidden workspace existence.

## Hosted task conversion

Map structured capture to `HostedTask` deterministically.

Required semantics:

- `taskId` -> `capture:<requestId>`
- ownership -> capture workspace
- `context` -> task context
- category/project/person/dependency/sourceContext preserved
- type/defaults identical to 1D-B
- priority default MEDIUM
- status WAITING only for WAITING capture, otherwise OPEN
- date-only due -> `dueAt` exact `YYYY-MM-DD`, `dueIsDateOnly=true`
- no due -> `dueAt=null`, `dueIsDateOnly=false`
- reminder/follow-up timestamps normalized by the shared parser
- recurrence preserves the capture meaning
- `source="send-to-tasks"`
- `captureFingerprint` persisted
- `lastNotifiedAt=null`
- `completedAt=null`
- `seriesId=null`
- `recurrenceAnchorDay=null` unless there is a clear existing requirement; do not invent one during capture
- timestamps from injected clock.

For one-time recurrence, either `null` or `One-time` may remain the hosted internal representation, but the returned interpretation must preserve the same semantic meaning as local capture. Do not make local and hosted validation differ.

## Local 1D-B compatibility

Do not regress local capture.

The local `/api/tasks/capture` service must continue to:

- accept the same input;
- preserve fingerprint;
- return exact replay after task mutation;
- conflict on reused request ID with different immutable capture input.

If capture helper refactoring is required, keep all existing 1D-B tests green.

## D1 migration/proof updates

Update every hard-coded migration list to include 0005.

At minimum:

- `tests/workspaces-d1.test.ts`
- `.github/workflows/cloudflare-proof.yml`

In the Cloudflare proof workflow:

- copy migrations 0001 through 0005;
- update human-readable step labels from 0001–0004 to 0001–0005.

Do not change the proof workflow branch trigger or turn it into a production deployment.

## Tests

Add focused tests proving at minimum:

1. migration 0005 preserves existing task rows and yields null new fields;
2. D1TaskRepository create/get/list round-trip `captureFingerprint`;
3. D1TaskRepository round-trips `estimatedDurationLabel`;
4. D1 update rejects changing a non-null capture fingerprint to a different value;
5. ordinary update with the same fingerprint remains valid;
6. hosted Personal structured capture creates Personal-only visibility;
7. hosted Indelitech structured capture creates Indelitech + Personal visibility;
8. hosted capture rejects missing/legacy/mismatched workspace context;
9. hosted capture uses deterministic `capture:<requestId>` ID;
10. hosted exact replay returns `created:false`;
11. hosted replay still succeeds after title/status/reminder/task mutations because fingerprint is immutable;
12. hosted same request ID with materially different capture input conflicts when visible;
13. non-capture deterministic-ID collision conflicts when visible;
14. hosted capture preserves category/project/person/dependency/sourceContext;
15. due remains date-only and independent from reminder;
16. WAITING semantics match local capture;
17. recurring validation/semantics match local capture;
18. duration mappings are exact for 5m/15m/30m/1h/2h+;
19. Project preserves `estimatedDurationLabel="Project"` while numeric duration is null;
20. omitted duration leaves both hosted duration fields null;
21. source is `send-to-tasks`;
22. fingerprint produced for the same parsed capture is identical between local and hosted conversions;
23. all existing 1C/1D-A/1D-B tests remain green;
24. Cloudflare proof migration list includes 0005.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run smoke`
- `git diff --check`

CI remains Node 24.19.0.

If local Codex Node is below 24.19.0, report the smoke limitation honestly and rely on GitHub Actions for the authoritative matrix.

## Branch / PR

Work on:

`milestone/1d-c-hosted-capture`

PR target:

`main`

Keep this PR focused on hosted structured capture/schema parity only.
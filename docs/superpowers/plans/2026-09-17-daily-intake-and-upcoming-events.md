# 1G-H Daily Intake and Upcoming Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation-gated Daily Intake inbox plus a reconciled 45-day Google Calendar projection, delivered through the existing Todoist relay and exposed in DCC without turning inferred work or calendar events into canonical Tasks automatically.

**Architecture:** Extend the production Todoist bridge with strict versioned envelopes while preserving legacy task capture. Persist inferred email/calendar findings as user/workspace-scoped Intake records; persist calendar events as user-owned projections with separate manual workspace overrides; reconcile calendar deletions only after a complete batch set; record per-source freshness with `scan_status`; and create canonical Tasks/Bills only from explicit authenticated approval. ChatGPT Automations remain the semantic scanner and briefing layer; DCC remains the durable system of record.

**Tech Stack:** TypeScript, Next.js 16/Vinext, React 19, Cloudflare Workers/Cron Triggers, Cloudflare D1, Todoist REST API v1, existing Cloudflare Access session/auth stack, Node/tsx test runner.

**Spec:** `docs/superpowers/specs/2026-09-17-1g-h-daily-intake-design.md`

## Global Constraints

- DCC remains the system of record; Todoist is transport only.
- Existing legacy ChatGPT → Todoist → DCC task capture must remain backward-compatible.
- Every inferred Task/Bill remains a proposal until the authenticated user explicitly approves it in DCC.
- Calendar events are projections, never Tasks. They do not inherit completion or overdue semantics.
- Gmail recurring scans use a 48-hour overlap after one controlled 7-day bootstrap; DCC semantic dedupe absorbs repeated observations.
- Store only source metadata/short evidence needed by DCC. Do not persist complete Gmail bodies, attachments, Calendar descriptions, or attendee lists.
- Transport may select only logical `personal` / `indelitech`; physical workspace IDs stay server-side.
- Personal and Indelitech canonical financial records remain isolated. A Bill proposal is created only in its explicitly approved workspace.
- Manual event workspace overrides beat automatic classification; occurrence override beats series override.
- Partial calendar batches may upsert positively observed events but may never reconcile removals until the full batch set is complete.
- DCC persistence must complete before the Todoist relay item is closed.
- All hosted Intake/Event responses use `Cache-Control: no-store`.
- No scheduled ChatGPT Automations are enabled until relay/API/UI code is deployed and manual production acceptance passes.
- Use TDD for every implementation task. Keep commits task-scoped and independently reviewable.

---

### Task 1: Add 1G-H domain contracts and D1 schema

**Files:**
- Create: `lib/runtime/daily-intake.ts`
- Create: `lib/runtime/calendar-projections.ts`
- Create: `migrations/0012_daily_intake_events.sql`
- Create: `tests/daily-intake-migration.test.ts`
- Create: `tests/daily-intake-domain.test.ts`

**Interfaces:**
- Consumes: `ProductWorkspaceId`, existing Task priorities, `BillDefinitionCore`-compatible proposal fields.
- Produces: stable Intake, Calendar projection, override, sync-run, and source-status types/validators used by relay, repositories, APIs, and UI.

- [ ] **Step 1: Write failing migration/domain tests**

Cover:
- migration creates `intake_items`, `projected_calendar_events`, `calendar_workspace_overrides`, `calendar_sync_runs`, `calendar_sync_batches`, and `daily_intake_source_status`;
- `intake_items` has a unique `(user_id, semantic_key)` boundary plus a durable `user_edited_at` marker;
- Intake type/status/source/workspace checks fail closed;
- event rows are user-owned and source/event identity is unique;
- override scope is only `SERIES` or `OCCURRENCE`;
- sync batch identity is unique per user/source/run/batch;
- Bills gain nullable `source_intake_id` plus a unique partial index for idempotent Intake-origin creation;
- complete email bodies/attachments and complete Calendar descriptions/attendees have no schema columns.

- [ ] **Step 2: Verify RED**

Run:
```bash
npm test -- tests/daily-intake-migration.test.ts tests/daily-intake-domain.test.ts
```
Expected: FAIL because the migration/domain modules do not exist.

- [ ] **Step 3: Implement the minimal domain types/validators**

Use explicit discriminated contracts. Keep provider transport data separate from persisted models. The core shape should be equivalent to:

```ts
export const INTAKE_TYPES = ["TASK", "FOLLOW_UP", "BILL", "AWARENESS"] as const;
export const INTAKE_STATUSES = ["PENDING", "DEFERRED", "APPROVED", "DISMISSED", "ARCHIVED"] as const;
export const DAILY_INTAKE_SOURCE_KEYS = [
  "personal_gmail",
  "professional_gmail",
  "indelitech_gmail",
  "primary_calendar",
  "family_calendar",
] as const;

export type IntakeProposalInput = Readonly<{
  scanRunId: string;
  workspaceId: ProductWorkspaceId;
  sourceKey: DailyIntakeSourceKey;
  sourceType: "gmail" | "calendar";
  messageId?: string;
  threadId?: string;
  eventId?: string;
  seriesId?: string;
  proposalOrdinal: number;
  sourceTimestamp: string;
  sender?: string;
  subject?: string;
  sourceUrl?: string;
  intakeType: IntakeType;
  title: string;
  summary: string;
  classificationReason: string;
  dueDate?: string;
  followUpAt?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  amountMinor?: number;
  currency?: string;
  recurrence?: BillProposalRecurrence;
}>;
```

Calendar transport contract:

```ts
export type CalendarSyncInput = Readonly<{
  scanRunId: string;
  sourceKey: "primary_calendar" | "family_calendar";
  windowStart: string;
  windowEnd: string;
  batchIndex: number; // 1-based
  batchCount: number;
  events: readonly CalendarEventInput[];
}>;
```

Validate exact dates/timestamps, bounded strings, supported source/workspace combinations, ordinals >= 1, batch `1..batchCount`, and HTTPS Google source URLs only when present.

- [ ] **Step 4: Implement the exact persistence schema**

Use STRICT tables and existing FK boundaries. Required schema shape:

```sql
CREATE TABLE intake_items (
  intake_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workspace_key TEXT NOT NULL CHECK (workspace_key IN ('personal','indelitech')),
  intake_type TEXT NOT NULL CHECK (intake_type IN ('TASK','FOLLOW_UP','BILL','AWARENESS')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','DEFERRED','APPROVED','DISMISSED','ARCHIVED')),
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail','calendar')),
  source_key TEXT NOT NULL CHECK (source_key IN ('personal_gmail','professional_gmail','indelitech_gmail','primary_calendar','family_calendar')),
  source_message_id TEXT,
  source_thread_id TEXT,
  source_event_id TEXT,
  source_series_id TEXT,
  proposal_ordinal INTEGER NOT NULL CHECK (proposal_ordinal >= 1),
  source_timestamp TEXT NOT NULL,
  source_sender TEXT,
  source_subject TEXT,
  source_url TEXT,
  source_summary TEXT NOT NULL,
  classification_reason TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  follow_up_at TEXT,
  priority TEXT CHECK (priority IS NULL OR priority IN ('LOW','MEDIUM','HIGH')),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency TEXT,
  target_payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_payload_json)),
  semantic_key TEXT NOT NULL,
  user_edited_at TEXT,
  defer_until TEXT,
  approved_target_kind TEXT CHECK (approved_target_kind IS NULL OR approved_target_kind IN ('TASK','BILL')),
  approved_target_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, semantic_key)
) STRICT;

CREATE TABLE projected_calendar_events (
  event_projection_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  google_event_id TEXT NOT NULL,
  series_id TEXT,
  occurrence_key TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL CHECK (all_day IN (0,1)),
  location TEXT,
  source_url TEXT,
  automatic_workspace_key TEXT NOT NULL CHECK (automatic_workspace_key IN ('personal','indelitech')),
  last_seen_scan_run_id TEXT NOT NULL,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source_key, google_event_id)
) STRICT;

CREATE TABLE calendar_workspace_overrides (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  scope TEXT NOT NULL CHECK (scope IN ('SERIES','OCCURRENCE')),
  identity_key TEXT NOT NULL,
  workspace_key TEXT NOT NULL CHECK (workspace_key IN ('personal','indelitech')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key, scope, identity_key)
) WITHOUT ROWID, STRICT;

CREATE TABLE calendar_sync_runs (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('primary_calendar','family_calendar')),
  scan_run_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  batch_count INTEGER NOT NULL CHECK (batch_count >= 1),
  state TEXT NOT NULL CHECK (state IN ('RECEIVING','COMPLETE')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, source_key, scan_run_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE calendar_sync_batches (
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  scan_run_id TEXT NOT NULL,
  batch_index INTEGER NOT NULL CHECK (batch_index >= 1),
  received_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key, scan_run_id, batch_index),
  FOREIGN KEY (user_id, source_key, scan_run_id)
    REFERENCES calendar_sync_runs(user_id, source_key, scan_run_id) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;

CREATE TABLE daily_intake_source_status (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (source_key IN ('personal_gmail','professional_gmail','indelitech_gmail','primary_calendar','family_calendar')),
  state TEXT NOT NULL CHECK (state IN ('SUCCESS','FAILED')),
  last_attempt_at TEXT NOT NULL,
  last_successful_at TEXT,
  diagnostic TEXT,
  scan_run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key)
) WITHOUT ROWID, STRICT;

ALTER TABLE bills ADD COLUMN source_intake_id TEXT;
CREATE UNIQUE INDEX bills_source_intake_uidx
  ON bills(source_intake_id) WHERE source_intake_id IS NOT NULL;
```

Add indexes for Intake status/workspace sorting, event date/source reads, and sync-run cleanup without changing the uniqueness rules above.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/daily-intake-migration.test.ts tests/daily-intake-domain.test.ts
```
Commit: `Add 1G-H intake and calendar schema`

---

### Task 2: Implement the D1 Intake repository and semantic dedupe

**Files:**
- Create: `lib/runtime/intake-repository.ts`
- Create: `lib/server/d1-intake-repository.ts`
- Create: `tests/d1-intake-repository.test.ts`

**Interfaces:**
- Consumes: authorized `RequestContext`, validated `IntakeProposalInput`, `Clock`, `IdGenerator`.
- Produces: idempotent ingest/list/edit/defer/dismiss/archive/get operations; no canonical Task/Bill writes.

- [ ] **Step 1: Write failing repository tests**

Cover exact-workspace authorization for user mutations/reads, Gmail semantic slots, later-message/new-action behavior, replay through a different Todoist task, no resurrection after APPROVED/DISMISSED/ARCHIVED, manual workspace correction, duplicate delivery after manual correction, defer visibility, Awareness restrictions, and cross-user isolation.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/d1-intake-repository.test.ts
```

- [ ] **Step 3: Implement server-derived semantic keys**

Never accept a semantic key from transport. Compute it after validation:

```ts
function semanticKey(input: IntakeProposalInput): string {
  if (input.sourceType === "gmail") {
    return `${input.sourceKey}:message:${input.messageId}:${input.proposalOrdinal}`;
  }
  return `${input.sourceKey}:event:${input.eventId}:${input.proposalOrdinal}`;
}
```

Ingest dedupes by `(user_id, semantic_key)` across that user's own logical workspaces. That is required so a user moving a proposal from Personal to Indelitech does not allow a later source replay to insert a duplicate in the old workspace.

- [ ] **Step 4: Implement lifecycle methods with explicit edit protection**

Repository contract:

```ts
interface IntakeRepository {
  ingest(context: RequestContext, input: IntakeProposalInput): Promise<IntakeIngestResult>;
  list(context: RequestContext, filter: IntakeListFilter): Promise<HostedIntakeItem[]>;
  get(context: RequestContext, intakeId: string): Promise<HostedIntakeItem | null>;
  edit(
    context: RequestContext,
    intakeId: string,
    patch: IntakeEditablePatch,
    destinationContext?: RequestContext,
  ): Promise<HostedIntakeItem>;
  defer(context: RequestContext, intakeId: string, until: string): Promise<HostedIntakeItem>;
  dismiss(context: RequestContext, intakeId: string): Promise<HostedIntakeItem>;
  archive(context: RequestContext, intakeId: string): Promise<HostedIntakeItem>;
  markApproved(context: RequestContext, intakeId: string, target: ApprovedTarget): Promise<HostedIntakeItem>;
}
```

Every user `edit()` sets `user_edited_at`. If a later duplicate source delivery finds `user_edited_at IS NULL`, it may refresh source-derived proposal fields. If `user_edited_at IS NOT NULL`, it may refresh source metadata (`source_summary`, `classification_reason`, source timestamp/link) but **must not** overwrite user-editable fields: workspace, title, due/follow-up timing, priority, amount/currency, recurrence, or target payload. Moving workspace requires a separately authorized `destinationContext` and updates both physical `workspace_id` and logical `workspace_key` atomically.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/d1-intake-repository.test.ts
```
Commit: `Add authorized intake repository`

---

### Task 3: Implement Calendar projection, overrides, reconciliation, and source freshness

**Files:**
- Create: `lib/runtime/calendar-projection-repository.ts`
- Create: `lib/runtime/source-freshness-repository.ts`
- Create: `lib/server/d1-calendar-projection-repository.ts`
- Create: `lib/server/d1-source-freshness-repository.ts`
- Create: `tests/d1-calendar-projection-repository.test.ts`
- Create: `tests/d1-source-freshness-repository.test.ts`

**Interfaces:**
- Consumes: active DCC `userId`, validated `CalendarSyncInput`, validated scan-status payloads, requested logical workspace for reads/overrides.
- Produces: 45-day projection rows with resolved workspace and related Intake/Task references, complete-run reconciliation, manual series/occurrence overrides, per-source freshness.

- [ ] **Step 1: Write RED tests for Calendar sync**

Cover batch replay, out-of-order batches, partial batch no-delete, complete batch reconciliation, event changes, removed events, same Google event ID in different source calendar, and 45-day bounded reads.

- [ ] **Step 2: Write RED tests for override precedence**

Prove:
1. occurrence override wins;
2. series override is next;
3. automatic classification next;
4. source default last.

Also prove a series correction affects later synced occurrences and an occurrence-only correction does not rewrite the series.

- [ ] **Step 3: Write RED tests for freshness and event relationships**

Missing status = unknown/stale; FAILED does not advance last successful time; SUCCESS advances it even when the scan produced zero Intake items/events. For an event with a source-matched Intake proposal, Calendar reads return a relationship summary containing Intake status and, after approval, canonical target kind/ID.

- [ ] **Step 4: Implement repositories**

`ingestBatch()` must transact the batch marker and event upserts together. Only when the count of distinct received batch indexes equals `batchCount` may it perform a reconciliation query for the covered window and mark unseen rows removed.

Resolved workspace helper:

```ts
resolvedWorkspace = occurrenceOverride
  ?? seriesOverride
  ?? event.automaticWorkspaceId
  ?? sourceDefaultWorkspace(event.sourceKey);
```

When listing events, join/lookup `intake_items` by the same `user_id + source_key + source_event_id` and return only relationship metadata needed by UI (`intakeId`, Intake type/status, approved target kind/ID). Do not copy proposal/source bodies into the event record.

Source status API should expose `lastAttemptAt`, `lastSuccessfulAt`, `state`, `diagnostic`, and `scanRunId` without copying provider message bodies.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/d1-calendar-projection-repository.test.ts tests/d1-source-freshness-repository.test.ts
```
Commit: `Add calendar projection and source freshness repositories`

---

### Task 4: Add strict versioned Todoist envelopes without breaking legacy capture

**Files:**
- Create: `lib/runtime/todoist-ingress-envelope.ts`
- Modify: `lib/runtime/todoist-task-ingress.ts`
- Create: `tests/todoist-ingress-envelope.test.ts`
- Modify: `tests/todoist-task-ingress.test.ts`

**Interfaces:**
- Consumes: existing `TodoistRelayTask`.
- Produces: `intake_proposal`, `calendar_sync`, or `scan_status` parsed envelope; legacy items continue to the existing parser unchanged.

- [ ] **Step 1: Write failing parser/backward-compatibility tests**

Cover exact three-line envelope metadata, version `1` only, supported kinds only, strict single-line JSON payload, maximum DCC envelope size, required `scanRunId`, unknown fields failing closed, physical workspace selectors rejected, malformed JSON permanent failure, and legacy descriptions still parsing exactly as before.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/todoist-ingress-envelope.test.ts tests/todoist-task-ingress.test.ts
```

- [ ] **Step 3: Implement detection + parser**

Use a small discriminator rather than changing legacy metadata rules:

```ts
export function isVersionedDccEnvelope(task: TodoistRelayTask): boolean {
  return /^dccEnvelopeVersion:/m.test(task.description ?? "");
}

export type ParsedDccEnvelope =
  | { kind: "intake_proposal"; payload: IntakeProposalInput }
  | { kind: "calendar_sync"; payload: CalendarSyncInput }
  | { kind: "scan_status"; payload: ScanStatusInput };
```

Set and test one explicit serialized payload ceiling (8 KiB for v1 unless a stricter existing Todoist client limit is lower). Reject unknown top-level payload keys. Do not allow envelope transport to supply `userId`, physical workspace IDs, canonical Task IDs, or canonical Bill IDs.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `Add typed Todoist ingress envelopes`

---

### Task 5: Add envelope ingestion orchestration and wire the production Todoist Worker

**Files:**
- Create: `lib/runtime/daily-intake-ingress-service.ts`
- Create: `lib/runtime/todoist-ingress-dispatcher.ts`
- Modify: `lib/server/d1-user-workspace-resolver.ts`
- Modify: `workers/todoist-task-ingress.ts`
- Modify: `tests/d1-user-workspace-resolver.test.ts`
- Create: `tests/daily-intake-ingress-service.test.ts`
- Modify: `tests/todoist-ingress-worker.test.ts`
- Modify: `tests/todoist-task-ingress-service.test.ts`

**Interfaces:**
- Consumes: parsed envelopes, configured durable `DCC_USER_ID`, D1 repositories, existing relay close/failure actions.
- Produces: the existing ingress outcome semantics (`imported`, `already-imported`, `permanent-failure`, `transient-failure`) so `runTodoistIngressBatch` remains usable.

- [ ] **Step 1: Write RED orchestration tests**

Prove persistence occurs before relay close for each new kind; permanent validation/authorization failures stay visible; transient D1/provider failures remain retryable; duplicate delivery is safe; and one bad envelope does not block the rest of the bounded Worker batch.

- [ ] **Step 2: Extend configured-user resolver safely**

Add a method that verifies the configured user is active independently of a workspace:

```ts
resolveUser(): Promise<{ userId: string }>;
resolve(workspaceId: string): Promise<RequestContext>; // existing behavior unchanged
```

`intake_proposal` additionally resolves its logical workspace. `calendar_sync` and `scan_status` require an active configured user. Before a Calendar batch persists any event automatically classified to Indelitech, resolve `indelitech` once for that batch; fail the batch closed if the configured user lacks that membership.

- [ ] **Step 3: Implement dispatcher**

```ts
if (!isVersionedDccEnvelope(task)) return legacyImportTask(task);
const envelope = parseTodoistIngressEnvelope(task);
return dailyIntakeIngress.import(task.id, envelope);
```

The Worker keeps the same private scheduled deployment, D1 binding, project ID, cursor/backoff store, and one-minute polling cron. Do not add a public HTTP write endpoint.

- [ ] **Step 4: Verify legacy + new paths**

```bash
npm test -- tests/daily-intake-ingress-service.test.ts tests/todoist-task-ingress-service.test.ts tests/todoist-ingress-worker.test.ts tests/d1-user-workspace-resolver.test.ts
npm run build:todoist
```

- [ ] **Step 5: Commit**

Commit: `Extend Todoist ingress for Daily Intake envelopes`

---

### Task 6: Add idempotent Intake approval into canonical Tasks and Bills

**Files:**
- Create: `lib/runtime/intake-approval.ts`
- Create: `lib/server/intake-approval-service.ts`
- Modify: `lib/server/d1-bill-repository.ts`
- Modify: `lib/runtime/hosted-bills.ts` only if a typed create option belongs there
- Create: `tests/intake-approval.test.ts`
- Modify: `tests/hosted-bills.test.ts`

**Interfaces:**
- Consumes: authenticated `RequestContext`, unresolved Intake item, edited proposal fields, existing structured Task capture and Bills repository.
- Produces: exactly one canonical Task or Bill plus terminal APPROVED Intake record.

- [ ] **Step 1: Write RED approval tests**

Cover Task approval, Follow-up approval, Bill approval, Awareness rejection, terminal item rejection, workspace authorization re-check, retry after post-canonical timeout, and no cross-workspace financial write.

- [ ] **Step 2: Make Task approval reuse canonical idempotency**

Build the existing structured capture request with:

```ts
{
  requestId: `intake:${item.intakeId}`,
  confirmedByUser: true,
  workspaceId: item.workspaceKey,
  title: item.title,
  due: item.dueDate ?? undefined,
  followUpAt: item.followUpAt ?? undefined,
  priority: item.priority ?? undefined,
  source: "daily-intake",
  sourceContext: item.sourceSummary,
}
```

Use `createHostedStructuredTaskCaptureService`; do not create a second Task persistence path.

- [ ] **Step 3: Make Bill approval replay-safe**

Extend `D1BillRepository.create` with optional `{ sourceIntakeId }`. Before inserting, look up an existing Bill with that source ID in the same authorized workspace and return it as replay. Insert `source_intake_id` on first creation.

Map proposal to canonical Bill only after user approval. For a one-time proposal, operational defaults may be constructed only from values visible in the review form: recurrence `NONE`, interval `1`, day mode `null`, status `ACTIVE`; missing due date/currency or other canonical-required data returns a validation error so the user can Edit & Approve rather than guessing.

- [ ] **Step 4: Preserve approval ordering**

Canonical persistence happens first; Intake is marked APPROVED second. Task and Bill canonical writes are both replay-safe, so a retry after the first write but before Intake status update cannot duplicate the canonical record.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/intake-approval.test.ts tests/hosted-bills.test.ts
```
Commit: `Add idempotent Intake approval service`

---

### Task 7: Add authorized hosted Intake API

**Files:**
- Create: `lib/server/authorized-hosted-intake-handler.ts`
- Create: `lib/server/hosted-intake-route-runtime.ts`
- Create: `app/api/hosted/intake/route.ts`
- Create: `app/api/hosted/intake/status/route.ts`
- Create: `tests/hosted-intake.test.ts`

**Interfaces:**
- Consumes: Cloudflare Access session, exact logical workspace membership, `D1IntakeRepository`, approval service, source freshness repository.
- Produces: no-store JSON for list/edit/defer/dismiss/archive/approve and source freshness.

- [ ] **Step 1: Write RED handler/route tests**

Cover auth required, workspace required, exact-workspace reads, status/type filters, no cross-user reads, malformed edits, workspace move requiring destination membership, single Bill approval only, conservative non-Bill bulk approve/dismiss, partial bulk-result reporting, and no-store headers.

- [ ] **Step 2: Implement API contract**

Use:
- `GET /api/hosted/intake?workspaceId=<logical>&status=PENDING|...&type=...`
- `PATCH /api/hosted/intake?workspaceId=<logical>` with `{ intakeId, action: "EDIT" | "DEFER" | "DISMISS" | "ARCHIVE", ... }`
- `POST /api/hosted/intake?workspaceId=<logical>` with `{ action: "APPROVE" | "APPROVE_BULK" | "DISMISS_BULK", intakeIds: [...] }`
- `GET /api/hosted/intake/status?workspaceId=<logical>` returns the five known source freshness records visible to the authenticated user.

Bulk operations return a per-item result array and never imply atomic all-or-nothing behavior. Bills are rejected from `APPROVE_BULK` in v1.

For the UI's explicit `All` view, fetch Personal and Indelitech separately and combine client-side with visible workspace labels. Do not introduce a hidden financial roll-up API.

- [ ] **Step 3: Reuse existing route-runtime pattern**

Follow `authorized-hosted-bills-handler.ts` + `hosted-bills-route-runtime.ts` + thin App Route wrappers. Keep validation errors 400, auth/workspace denial 403, missing Intake 404, state conflict 409, and unexpected persistence failures 500.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- tests/hosted-intake.test.ts
```
Commit: `Add hosted Intake API`

---

### Task 8: Add authorized hosted Upcoming Events API and workspace overrides

**Files:**
- Create: `lib/server/authorized-hosted-events-handler.ts`
- Create: `lib/server/hosted-events-route-runtime.ts`
- Create: `app/api/hosted/events/route.ts`
- Create: `tests/hosted-events.test.ts`

**Interfaces:**
- Consumes: Cloudflare Access session, authorized logical workspace selection, D1 Calendar projection repository.
- Produces: bounded event reads with related Intake/approved-target references and explicit series/occurrence override mutations.

- [ ] **Step 1: Write RED tests**

Cover 45-day maximum read window, exact logical workspace filter, Personal vs Indelitech event classification, no user leakage, related Intake metadata, approved Task/Bill target IDs when present, series/occurrence override updates, clearing overrides, invalid source/event IDs, target workspace authorization, and no-store responses.

- [ ] **Step 2: Implement API**

Use:
- `GET /api/hosted/events?workspaceId=<logical>&fromDate=YYYY-MM-DD&throughDate=YYYY-MM-DD`
- `PATCH /api/hosted/events` body:

```ts
{
  sourceKey: "primary_calendar" | "family_calendar";
  eventId: string;
  scope: "SERIES" | "OCCURRENCE";
  workspaceId: "personal" | "indelitech";
  clear?: boolean;
}
```

Each GET event includes a compact `relatedIntake` array with `{ intakeId, intakeType, status, approvedTargetKind, approvedTargetId }` for source-matched proposals. The mutation must prove the authenticated user owns the projection and is currently authorized for the target logical workspace.

- [ ] **Step 3: Verify GREEN and commit**

```bash
npm test -- tests/hosted-events.test.ts
```
Commit: `Add hosted Upcoming Events API`

---

### Task 9: Build the Intake review surface

**Files:**
- Create: `components/intake-view.tsx`
- Create: `components/intake-view.module.css`
- Create: `components/use-intake.ts`
- Modify: `components/control-center.tsx`
- Modify: `lib/workspace-ui.ts`
- Create: `tests/intake-ui.test.ts`
- Modify: `tests/workspace-ui.test.ts`
- Modify: `tests/navigation-overflow.test.ts`
- Modify: `tests/ui-accessibility.test.ts`

**Interfaces:**
- Consumes: hosted Intake/status APIs, current DCC workspace selection.
- Produces: Pending/Deferred/Awareness/history views; edit/approve/defer/dismiss/archive actions; explicit All filter assembled client-side.

- [ ] **Step 1: Write RED UI contract/accessibility tests**

Assert Intake navigation exists in Personal and Indelitech, Pending is default, workspace/type/source/date evidence is visible, Awareness has no Approve action, Bills cannot bulk approve, keyboard/focus behavior works, and narrow layouts do not break navigation.

- [ ] **Step 2: Add Intake navigation with minimal `control-center.tsx` impact**

Extend `WorkspacePageId` and the `Tab` union with `intake`; add an Inbox icon entry after Tasks. Keep data fetching and review logic inside `IntakeView`, not the large control-center component.

- [ ] **Step 3: Implement review cards and edit flow**

Show title, type, workspace, source, source timestamp, supported date/amount, short reason, freshness warning when relevant, and source link if present. `Edit & Approve` must expose only canonical-supported fields; blank unknown values remain blank. A workspace correction resolves destination authorization before PATCH and remains durable through future source replays.

- [ ] **Step 4: Implement explicit All behavior**

All = two authorized requests (`personal`, `indelitech`) merged client-side. Workspace chips remain visible on every item, especially Bills.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/intake-ui.test.ts tests/workspace-ui.test.ts tests/navigation-overflow.test.ts tests/ui-accessibility.test.ts
```
Commit: `Add Daily Intake review surface`

---

### Task 10: Integrate real Google events into Calendar with a 45-day Upcoming view

**Files:**
- Create: `components/use-projected-events.ts`
- Create: `components/calendar-event-item.tsx`
- Modify: `components/task-calendar.tsx`
- Modify: `lib/task-calendar.ts`
- Create: `tests/upcoming-events-ui.test.ts`
- Modify: `tests/task-calendar.test.ts`

**Interfaces:**
- Consumes: `/api/hosted/events`, existing canonical Task and Bill projections, workspace selection.
- Produces: Calendar month/agenda entries plus a distinct 45-day Upcoming Events view and workspace override controls.

- [ ] **Step 1: Write RED projection/UI tests**

Cover event rendering without task completion/overdue semantics, 45-day limit, grouping by date, Personal/Indelitech/All filter, source calendar labels, recurring indication, override defaulting to whole series, occurrence-only exception, and related Intake/approved Task links.

- [ ] **Step 2: Extend Calendar projection union**

Add `EVENT` beside `TASK` and `BILL`, but give it a distinct item renderer:

```ts
type CalendarProjection =
  | { source: "TASK"; ... }
  | { source: "BILL"; ... }
  | { source: "EVENT"; id: string; date: string; event: ProjectedCalendarEvent };
```

Do not reuse priority/overdue CSS classes for EVENT.

- [ ] **Step 3: Add Upcoming segmented view**

Extend `month | agenda` to `month | agenda | upcoming`. `upcoming` is the canonical next-45-days event surface; existing month/agenda continue to show Tasks/Bills and include Google events where dates overlap. The Upcoming panel displays event relationships from `relatedIntake`; approved Task targets navigate to the canonical task when available.

- [ ] **Step 4: Add override interaction**

Default correction scope to `SERIES` when `seriesId` exists; offer `OCCURRENCE` explicitly. PATCH the hosted Events API and refresh locally without changing the Google event.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/upcoming-events-ui.test.ts tests/task-calendar.test.ts
```
Commit: `Add 45-day Upcoming Events view`

---

### Task 11: Add lightweight Today event and Intake summaries

**Files:**
- Create: `components/today-events.tsx`
- Create: `components/today-events.module.css`
- Create: `components/today-intake-summary.tsx`
- Create: `components/today-intake-summary.module.css`
- Modify: `components/control-center.tsx`
- Create: `tests/today-intake-events.test.ts`

**Interfaces:**
- Consumes: hosted Events and Intake APIs, current workspace selection.
- Produces: Today's Events, next-7-day preview, and Intake-review count/card without duplicating the 45-day Calendar or full Intake inbox.

- [ ] **Step 1: Write RED Today tests**

Assert today's events are time-ordered, next 7 days is compact, Intake count links to Intake, events have no checkbox/overdue treatment, errors/stale sources are disclosed without breaking Tasks/Financial Pulse, and Personal/Indelitech scope remains visible.

- [ ] **Step 2: Implement focused components**

Do not add provider logic to `control-center.tsx`; mount the two focused components in Today near the existing task agenda/financial pulse.

- [ ] **Step 3: Verify GREEN and commit**

```bash
npm test -- tests/today-intake-events.test.ts tests/today-task-agenda.test.ts tests/today-financial-pulse-ui.test.ts
```
Commit: `Surface Daily Intake and events on Today`

---

### Task 12: Harden deployment, update roadmap, and perform manual production acceptance

**Files:**
- Modify: `.github/workflows/cloudflare-todoist-deploy.yml` only if new build/migration verification is required; preserve the current protected deployment command and project-ID guard.
- Modify: `scripts/smoke.mjs`
- Modify: `tests/todoist-ingress-deploy.test.ts`
- Modify: `tests/cloudflare-deploy-workflow.test.ts` if the production web migration path changes.
- Modify: `docs/ROADMAP.md`
- Create after acceptance: `docs/MILESTONE-1G-H-CLOSEOUT.md`

**Interfaces:**
- Consumes: completed implementation, existing protected web/Todoist deployment workflows, connected Gmail/Calendar/Todoist sources, ChatGPT Automations.
- Produces: verified production deployment, controlled bootstrap, three scheduled scans, acceptance evidence, roadmap closeout.

- [ ] **Step 1: Add RED deployment/smoke assertions**

Prove the Todoist Worker build still runs, production migrations include `0012_daily_intake_events.sql`, canonical Todoist project ID remains `6hWfF7hXXMj9XpV5`, Worker stays private/scheduled, and smoke coverage detects Intake/Event hosted route regressions.

- [ ] **Step 2: Run full local verification before PR**

```bash
npm run check
npm run build:mcp
npm run build:intel
npm run build:todoist
npm run smoke
```
Expected: all green.

- [ ] **Step 3: Update roadmap accurately**

In the implementation PR, update `docs/ROADMAP.md` to:
- mark 1G-G complete;
- mark the Todoist bridge operational rather than experimental;
- add 1G-H with its actual implementation status;
- keep historical-mail cleanup explicitly separate from recurring 1G-H scans.

- [ ] **Step 4: Open the 1G-H PR and stop at merge boundary**

Require Linux/macOS/Windows CI and review. Do not merge without Marc's explicit approval.

- [ ] **Step 5: After approved merge, deploy DCC + Todoist ingress through protected workflows**

Deploy schema/API/UI and relay support before enabling Automations. Verify exact deployed main SHA and production migration success.

- [ ] **Step 6: Manual relay acceptance before scheduling**

Send one safe `intake_proposal` envelope and one small `calendar_sync` run through the dedicated Todoist project. Verify:
- Todoist items close only after DCC persistence;
- the Intake proposal appears but does not create a Task;
- calendar events appear in Upcoming;
- replay creates no duplicates;
- event relationship metadata appears when the proposal references the event;
- the existing simple ChatGPT → Todoist → DCC Task capture still works.

- [ ] **Step 7: Run the controlled 7-day bootstrap**

Use ChatGPT with the approved sources only:
- Personal Gmail → Personal
- Professional Gmail → Personal
- Indelitech Gmail → Indelitech
- Primary Calendar + Family Calendar → 45-day projection

Do not scan Harvest Fire/HF IT/HFWC/Holidays. Historical mail older than the bootstrap window remains a separate one-time workflow.

- [ ] **Step 8: Create three ChatGPT Automations only after bootstrap acceptance**

Create separate scheduled runs in `America/New_York`:
- 7:00 AM daily — morning briefing emphasis;
- 12:30 PM daily — delta/midday emphasis;
- 5:30 PM daily — end-of-day/tomorrow emphasis.

Each run must:
1. create one stable `scanRunId`;
2. search the rolling prior 48 hours in all three approved Gmail accounts;
3. read Primary + Family Calendar for the next 45 days;
4. classify findings under the approved conservative rules;
5. send typed Todoist envelopes in safe serialized-size batches;
6. send a final `scan_status` envelope covering all five sources;
7. return a concise ChatGPT briefing that names failed/stale sources explicitly.

- [ ] **Step 9: Verify all three scheduled executions**

Confirm at least one successful 7:00, 12:30, and 5:30 run in production, including a zero-findings success case so `scan_status` freshness is proven independently of proposal creation.

- [ ] **Step 10: Write closeout doc and final regression check**

Document deployment SHA, Worker version/run evidence, Automation schedules, source scope, accepted limitations, and rollback notes. Run:

```bash
npm run check
npm run smoke
```

Commit: `Close out 1G-H Daily Intake`

---

## Plan Self-Review Checklist

Before implementation begins, confirm:

- [x] Every approved spec requirement maps to a task above.
- [x] No `TODO`, `TBD`, placeholder function, or unspecified security boundary remains.
- [x] Transport types line up across parser → ingress service → D1 repositories.
- [x] Hosted API types line up with UI hooks/components.
- [x] User-edited Intake fields have an explicit durable overwrite-protection marker.
- [x] Event reads explicitly return source-matched Intake/approved-target relationships.
- [x] Task approval reuses `requestId=intake:<id>` idempotency.
- [x] Bill approval has independent replay safety through `source_intake_id`.
- [x] Calendar deletion reconciliation cannot occur from partial batches.
- [x] `scan_status` can mark successful zero-result scans fresh.
- [x] Legacy Todoist task capture remains covered by regression tests.
- [x] Automation creation remains after protected deployment/manual acceptance, not before.

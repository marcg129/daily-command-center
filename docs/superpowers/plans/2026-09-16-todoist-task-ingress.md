# Todoist Task Ingress v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import explicitly structured ChatGPT-created Todoist relay tasks into the authenticated user's canonical Daily Command Center task store with deterministic idempotency, visible failures, and no second task system to manage.

**Architecture:** Keep Todoist as a transport queue only. Parse a small structured envelope from tasks in one dedicated Todoist project, resolve the configured durable DCC user to an exact authorized logical/physical workspace, delegate persistence to the existing hosted structured-capture service, then close the Todoist relay only after DCC persistence/replay succeeds. Run ingestion in a separate scheduled Cloudflare Worker so it does not depend on GitHub Actions during normal use.

**Tech Stack:** TypeScript, Todoist REST API v1, Cloudflare Workers/Cron Triggers, D1, existing DCC structured task-capture service, Node test runner.

**Design:** `docs/TODOIST-TASK-INGRESS-DESIGN.md`

## Global constraints

- Daily Command Center remains the system of record.
- `requestId` is always derived from the Todoist task ID: `todoist:<id>`.
- Todoist can select only logical `personal` or `indelitech`; it never supplies physical workspace IDs.
- The importer binds to one explicit durable `DCC_USER_ID`; never select the first user/owner.
- Unknown optional task fields are omitted, not inferred.
- Existing DCC validation and idempotent capture remain authoritative.
- Close Todoist relay tasks only after DCC persistence or identical replay succeeds.
- Permanent failures stay visible with a concise diagnostic; transient failures remain retryable.
- The Todoist API token is a Worker secret and never enters D1/client/log output.
- No financial routes or records are reachable from this bridge.

---

### Task 1: Pure Todoist relay parser

**Files:**
- Create: `lib/runtime/todoist-task-ingress.ts`
- Test: `tests/todoist-task-ingress.test.ts`

- [ ] **Step 1: Write failing parser tests**

Cover:
- title comes from Todoist `content`;
- `requestId` is always `todoist:<task-id>` even if description contains a different request ID;
- required `workspace` accepts only `personal` or `indelitech` through canonical DCC validation;
- known optional fields (`priority`, `due`, `recurrence`, `estimatedDuration`, `context`, etc.) map exactly;
- unknown keys fail closed;
- duplicate metadata keys fail closed;
- blank/unsafe task IDs fail closed;
- values containing `:` preserve text after the first separator;
- optional unknown fields are absent rather than invented.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/todoist-task-ingress.test.ts`

Expected: FAIL because parser module does not exist.

- [ ] **Step 3: Implement minimal parser**

Define a runtime-neutral Todoist relay shape (`id`, `content`, `description`) and convert it to an object accepted by `parseStructuredTaskCapture`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/todoist-task-ingress.test.ts`

Expected: PASS.

### Task 2: Explicit DCC-user workspace resolver

**Files:**
- Create: `lib/server/d1-user-workspace-resolver.ts`
- Test: `tests/d1-user-workspace-resolver.test.ts`

- [ ] **Step 1: Write failing authorization tests**

Cover active configured user, exact Personal/Indelitech membership, missing/disabled user, missing membership, duplicate/corrupt membership, and unsupported logical workspace.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/d1-user-workspace-resolver.test.ts`

- [ ] **Step 3: Implement resolver**

Return an existing `RequestContext` with `{ userId, workspaceId: physicalId, workspaceKey: logicalKey }`. No fabricated principal is introduced.

- [ ] **Step 4: Verify GREEN**

### Task 3: Ingress orchestration around canonical capture

**Files:**
- Create: `lib/runtime/todoist-task-ingress-service.ts`
- Test: `tests/todoist-task-ingress-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover success, identical replay, malformed relay, authorization denial, canonical capture conflict, transient provider failure, and rule that Todoist close happens strictly after capture success.

- [ ] **Step 2: Implement service**

Compose parser + user workspace resolver + `createHostedStructuredTaskCaptureService`. Classify outcomes as imported/already-imported/permanent-failure/transient-failure without duplicating persistence.

### Task 4: Todoist API client

**Files:**
- Create: `lib/runtime/todoist-api.ts`
- Test: `tests/todoist-api.test.ts`

- [ ] **Step 1: Contract-test request construction**

Cover project-scoped task listing, cursor pagination, task close, failure label/comment update, 401/403 permanent credential failure, 429 retry metadata, 5xx/network transient classification, and redaction of authorization data from surfaced errors.

- [ ] **Step 2: Implement minimal REST client**

Use bearer token only in outbound `Authorization` header. Do not log request headers.

### Task 5: Scheduled Cloudflare Worker

**Files:**
- Create: `workers/todoist-task-ingress.ts`
- Create: `wrangler.todoist.jsonc`
- Modify: `package.json`
- Test: `tests/todoist-task-ingress-worker.test.ts`

- [ ] **Step 1: Write failing worker/config tests**

Assert separate worker name/config, D1 binding, once-per-minute Cron, required non-secret configuration, and no public mutation handler.

- [ ] **Step 2: Implement scheduled handler**

Poll dedicated project, process bounded pages/items, and preserve one failed item from blocking the rest of the batch.

### Task 6: Deployment/operator path

**Files:**
- Create: `.github/workflows/todoist-ingress-deploy.yml` only if needed for repeatable secret-free deployment orchestration
- Modify: `docs/TODOIST-TASK-INGRESS-DESIGN.md`

- [ ] **Step 1: Add build/deploy verification without storing the Todoist token in GitHub content**

The first secret setup may require the user to provide/set the Todoist personal API token through a protected secret-entry flow. Do not request it before this code is ready.

- [ ] **Step 2: Run focused and repository checks**

```bash
npm test -- tests/todoist-task-ingress.test.ts
npm test -- tests/d1-user-workspace-resolver.test.ts
npm test -- tests/todoist-task-ingress-service.test.ts
npm test -- tests/todoist-api.test.ts
npm test -- tests/todoist-task-ingress-worker.test.ts
npm run check
npm run smoke
```

- [ ] **Step 3: Open a separate PR**

Do not merge with 1G-G. Stop at its own explicit merge boundary after Linux/macOS/Windows checks pass.

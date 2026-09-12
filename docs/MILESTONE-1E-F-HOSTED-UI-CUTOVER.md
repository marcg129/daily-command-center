# Milestone 1E-F — Hosted task UI and proxy cutover

## Goal

Cut the existing browser task experience over to the authenticated D1-backed hosted routes when the app is running on a non-loopback host, while preserving the current local SQLite experience unchanged on localhost/loopback.

This is a task-focused hosted MVP cutover, not a claim that every legacy Control Center module is cloud-ready.

Baseline: `main` after Milestone 1E-E merge commit `40778d42443d5eca60e70f3aa805602c848e1a42`.

Work on `milestone/1e-f-hosted-ui-cutover` and target `main`.

Do not deploy in this milestone.

## Core invariant

Runtime behavior must be explicit and deterministic:

- loopback host => existing local SQLite/settings/reminders/recovery behavior;
- non-loopback host => authenticated hosted task routes only;
- hosted mode must never fall back silently to local SQLite APIs;
- local mode must not be broken or converted to D1;
- unsupported hosted modules must render truthful deferred shells rather than generating failing background API requests.

## Runtime mode

Add a small runtime-neutral/testable helper for local-vs-hosted browser mode. Treat only these as local:

- `localhost`
- `127.0.0.1`
- `::1`
- `[::1]`

Do not use a client-controlled query parameter, localStorage value, arbitrary header, or user-editable setting to select hosted mode.

Avoid duplicating host classification rules between the client and `proxy.ts` if practical; centralize the pure hostname/loopback predicate in a safe shared helper.

## Hosted browser bootstrap

The current browser bootstraps with `/api/settings` + `/api/workspace`. In hosted mode replace that path with the 1E-E workspace route:

`GET /api/hosted/workspace?workspaceId=<personal|indelitech>`

Requirements:

- load the requested workspace's visible task snapshot from D1;
- Personal receives Personal + Indelitech roll-up according to existing visibility rules;
- Indelitech receives only Indelitech tasks;
- changing the active workspace refetches the hosted snapshot for that workspace;
- do not perform legacy browser recovery import in hosted mode;
- do not PUT `/api/workspace` in hosted mode;
- do not read `/api/settings` in hosted mode;
- initialize hosted legacy reminders as an empty compatibility list and do not persist `/api/reminders` in hosted mode;
- preserve local bootstrap/recovery/import behavior exactly on loopback.

The hosted workspace response already has the compatibility shape with `tasks`, `reminders`, `initialized`, and `legacyBrowserImportAllowed`. Reuse it.

## Hosted task mutations

In hosted mode, task mutation saves must use:

`POST /api/hosted/tasks/mutations?workspaceId=<current authorized workspace>`

with the existing `{ "mutations": [...] }` body.

Requirements:

- preserve the ordered save queue and retry behavior from 1D-A;
- each queued save must retain the workspace context that produced it; a later workspace switch must not retarget an earlier queued mutation;
- on success, reconcile from the returned visible task snapshot;
- preserve Personal edits/completions/deletes of rolled-up Indelitech tasks;
- preserve atomic recurring completion behavior;
- no clones;
- hosted save errors must not claim SQLite persistence;
- local mode continues posting to `/api/tasks/mutations` unchanged.

## Hosted UI scope

### Personal

Hosted Personal should keep these V1 surfaces usable:

- Today — task attention + 45-day horizon;
- Tasks — full task surface;
- Calendar — current truthful shell;
- News — current truthful shell;
- Settings — replace interactive local settings with a truthful hosted-deferred shell.

Do not invoke local settings/live-feed APIs from the hosted Personal UI.

### Indelitech

Hosted Indelitech should keep:

- Today — task-focused attention + horizon only; do not invoke Daily Brief/live business-intelligence APIs yet;
- Tasks — full D1 task surface;
- Calendar — current truthful shell;
- Intel — hosted-deferred shell;
- Mentions — hosted-deferred shell;
- Settings — hosted-deferred shell.

The local loopback experience must retain the existing Indelitech Today/Intel/Mentions/Settings behavior.

Do not remove the nav items merely because their hosted backend is deferred. Make the limitation explicit in the page shell.

## Legacy reminders

The old standalone reminder compatibility array remains local-only in this milestone.

Hosted mode:

- starts with `reminders: []`;
- does not read or write `/api/reminders`;
- does not surface a standalone Reminders nav item;
- task-level `remindAt` / `followUpAt` fields continue to work through D1 task persistence.

Do not migrate the legacy reminder table in 1E-F.

## Proxy cutover

Update `proxy.ts` carefully.

### Loopback requests

Preserve current behavior:

- local API routes are allowed;
- cross-origin requests with an `Origin` header are blocked;
- no hosted-mode behavior is forced locally.

### Non-loopback requests

Allow only the namespaced hosted API surface required for the hosted MVP:

- `/api/hosted/workspace`
- `/api/hosted/tasks/mutations`
- `/api/hosted/tasks/capture`

Equivalent `/api/hosted/*` matching is acceptable only if no unrelated hosted route is accidentally opened.

All legacy `/api/*` endpoints must remain blocked on non-loopback hosts.

For hosted routes:

- if an `Origin` header is present, require same-origin;
- requests without `Origin` must remain possible so future Access service-token automation can call structured capture;
- do not add permissive CORS;
- do not trust a client-supplied Access identity or principal;
- route-level Cloudflare Access JWT verification + D1 workspace grant enforcement from 1E-E remains the authorization boundary.

Do not weaken the route-level JWT verification merely because Cloudflare Access will also sit upstream.

## Failure behavior

Hosted bootstrap failures must produce a useful bounded UI error/retry state. Do not silently fall back to local data.

A 403 should not trigger destructive recovery/import behavior.

Pending failed hosted saves must remain retryable in FIFO order.

Do not leak JWTs, principal IDs, SQL, binding values, or Access configuration in browser errors.

## Testing

Add focused tests for at least:

1. loopback hostname detection for localhost/IPv4/IPv6;
2. non-loopback detection as hosted;
3. local bootstrap still uses `/api/settings` + `/api/workspace`;
4. hosted bootstrap uses only `/api/hosted/workspace?workspaceId=...` for task state;
5. hosted workspace switching refetches the correct visible snapshot;
6. hosted mode never PUTs `/api/workspace`;
7. hosted mode never reads `/api/settings`;
8. hosted mode never writes `/api/reminders`;
9. hosted task saves use `/api/hosted/tasks/mutations?workspaceId=...`;
10. queued hosted mutations retain the workspace that produced them across a switch;
11. hosted Personal Today/Tasks remain task-functional;
12. hosted Indelitech Today does not invoke Daily Brief/live APIs;
13. hosted Settings/Intel/Mentions show truthful deferred shells and do not fire local-only API calls;
14. local Indelitech Today/Intel/Mentions behavior remains available;
15. non-loopback proxy denies a legacy API route;
16. non-loopback proxy allows the required hosted route;
17. hosted cross-origin request with Origin is denied;
18. hosted no-Origin request can pass proxy for service-token use;
19. loopback same-origin local API remains allowed;
20. no client-supplied identity bypass is introduced.

Preserve all existing task, recurrence, D1, Access, grant, route, local recovery, and save-queue tests.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run build:vinext`
- `npm run smoke`
- `npx vinext check`
- hosted route/dev smoke if safely achievable with disposable local bindings
- `git diff --check`

Node remains >= 24.19.0.

If Codex cannot run vinext because of its environment, report that honestly; GitHub Actions can perform the authoritative vinext proof as in prior milestones.

## Explicitly deferred

Do not implement in 1E-F:

- real Cloudflare D1 resource creation;
- real Access application/policy creation;
- production `TEAM_DOMAIN` / `POLICY_AUD` values;
- real principal grant seeding;
- deployment;
- custom domain;
- hosted settings persistence;
- legacy reminder migration;
- hosted Intel/Mentions/News ingestion;
- Daily Brief hosted persistence;
- Google Calendar sync;
- Telegram notifications;
- natural-language task parsing;
- public unauthenticated APIs.

## Deliverable

Commit implementation to `milestone/1e-f-hosted-ui-cutover` and update the PR.

Return:

1. runtime-mode detection design;
2. exact local vs hosted endpoint behavior;
3. hosted UI surfaces kept functional vs explicitly deferred;
4. proxy policy before/after;
5. save-queue/workspace-switch behavior;
6. tests added and total count;
7. normal Next build result;
8. vinext build/check result;
9. remaining manual Cloudflare account steps after this milestone.
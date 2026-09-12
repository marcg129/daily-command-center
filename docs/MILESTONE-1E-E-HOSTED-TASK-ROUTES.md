# Milestone 1E-E — Secure hosted task routes

## Goal

Add the real Cloudflare-Workers route boundary for the already-proven hosted task stack without yet switching the browser UI, weakening the current loopback proxy, creating Cloudflare account resources, or deploying.

This is the route-composition milestone between the 1E-D D1 task-surface adapter and the later hosted UI/proxy cutover.

## Baseline

Start from current `main` after Milestone 1E-D (`441af20dcfce3042e10dd5d3d9655c65d9990746`).

Work on:

`milestone/1e-e-hosted-task-routes`

Target PR: `main`.

## Safety invariant

The existing `proxy.ts` loopback-only API policy remains unchanged in this milestone. Therefore the new hosted routes are not publicly usable yet even if someone built the Worker.

Do not deploy.

## Existing pieces to reuse

Reuse, do not duplicate:

- `CloudflareAccessSessionProvider`
- `D1WorkspaceResolver`
- `D1TaskRepository`
- `D1TaskMutationRepository`
- `readHostedWorkspace`
- `createAuthorizedHostedTaskCaptureHandler` / hosted capture semantics
- `requireAuthenticatedSession`
- `taskVisibleInWorkspace`
- the structured capture contract and idempotency fingerprint

Cloudflare currently documents `cloudflare:workers` as the supported way for vinext route handlers/server code to access bindings. Use the supported toolchain rather than REST calls back to Cloudflare.

## Bindings

The hosted route runtime needs these bindings/config values:

- `DB` — D1 database binding
- `TEAM_DOMAIN` — Cloudflare Access team domain
- `POLICY_AUD` — Cloudflare Access application audience

Do not add real IDs or secret values in this milestone.

Do not invent a fake production D1 ID.

If a small type-only binding interface is needed, keep it local/runtime-neutral. Do not commit account-specific generated values.

## Authorized hosted task-surface service

Add a small server/runtime composition layer that turns:

- raw Access assertion
- requested workspace ID
- D1 binding

into an already-authorized `RequestContext` before any task read or mutation occurs.

Required order:

1. obtain the raw `Cf-Access-Jwt-Assertion` value;
2. cryptographically verify it with `CloudflareAccessSessionProvider`;
3. require a non-expired authenticated session;
4. resolve the requested workspace with `D1WorkspaceResolver`;
5. only then construct/use `D1TaskMutationRepository` for that context.

A valid Access JWT alone is not workspace authorization.

Do not trust email addresses, arbitrary headers, or client-supplied principal IDs.

## Hosted HTTP routes

Prefer a clearly namespaced, not-yet-client-used route surface so local endpoints remain untouched until 1E-F. Suggested routes:

- `GET /api/hosted/workspace?workspaceId=personal|indelitech`
- `POST /api/hosted/tasks/mutations?workspaceId=personal|indelitech`
- `POST /api/hosted/tasks/capture` (reuse the existing hosted capture runtime/handler rather than a second implementation)

Equivalent naming is acceptable if there is a concrete Next/vinext routing reason, but keep the hosted surface distinct from the current local SQLite endpoints in this milestone.

### Workspace GET

Returns the existing hosted bootstrap compatibility shape:

```json
{
  "tasks": [],
  "reminders": [],
  "initialized": true,
  "legacyBrowserImportAllowed": false
}
```

for the authorized requested workspace.

Personal context may contain Personal + Indelitech roll-up according to the existing visibility policy. Indelitech context must not expose Personal tasks.

### Task mutation POST

Accept the existing body:

```json
{ "mutations": [ ... ] }
```

The requested workspace comes from a validated `workspaceId` query parameter (or another single documented request field if there is a strong reason). The workspace ID must not be inferred from the first task in the mutation batch.

Return the resulting visible task snapshot for the same authorized workspace.

Preserve 1E-D atomicity, including recurring completion from Personal roll-up.

### Structured capture POST

Reuse the existing 1D/1E authorized hosted capture stack and exact idempotency behavior. Do not fork its parser or authorization logic.

## HTTP behavior

Fail closed with bounded errors.

At minimum:

- missing Access assertion → 403
- invalid/expired Access assertion → 403
- malformed/unknown workspace → 400
- valid principal without exact workspace grant → 403
- malformed task mutation payload → 400
- D1/internal failure → 500 with no sensitive details

Do not add permissive CORS.

Do not echo JWTs, principal IDs, D1 SQL, or binding values into errors.

## Dual-build requirement

This repository deliberately supports both:

- normal Next.js (`npm run build`)
- vinext/Workers (`npm run build:vinext`)

The new Worker binding access must not break the ordinary Next build.

Use the actual current vinext/Cloudflare toolchain and prove both builds.

If a direct static `cloudflare:workers` import in an App Router route causes ordinary Next to fail, do not delete the normal Next path. Use a supported isolation/composition approach and document it. Do not hand-wave a broken build.

## Local path preservation

Do not modify these existing local endpoints yet:

- `/api/workspace`
- `/api/tasks`
- `/api/tasks/mutations`
- `/api/settings`
- `/api/reminders`
- local `/api/tasks/capture` behavior beyond existing production guard

Do not modify the browser fetch URLs in `components/control-center.tsx` yet.

Do not modify `proxy.ts` in this milestone.

That cutover is 1E-F after the hosted routes are proven.

## Wrangler/config policy

Do not add a real D1 `database_id`, Access values, account ID, API token, custom domain, or secrets.

If route build validation needs binding declarations, use a local/test-safe configuration that cannot be mistaken for a real production resource, or keep binding typing isolated from deployment configuration.

Do not deploy.

## Tests

Add focused tests around the route/service boundary, not only lower-level repositories.

At minimum cover:

1. missing assertion denied before D1 work;
2. invalid assertion denied;
3. expired assertion denied;
4. valid Access principal with no requested workspace grant denied;
5. unknown workspace rejected;
6. Personal grant reads Personal + Indelitech roll-up;
7. Indelitech grant excludes Personal;
8. authorized Personal mutation can update a rolled-up Indelitech task;
9. authorized Indelitech create creates/rolls up correctly;
10. Personal arbitrary Indelitech create remains denied;
11. recurring Personal-roll-up completion remains atomic through the HTTP/service boundary;
12. malformed mutation body returns 400;
13. internal D1 failure is bounded to 500;
14. structured capture route reuses existing idempotency semantics;
15. no route trusts a client-supplied principal identity.

Preserve all existing Access/JWT, grants, D1, recurrence, structured capture, vinext, and local-path tests.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run build:vinext`
- `npm run smoke`
- vinext development HTTP smoke if the new route modules can be exercised safely with test/local bindings
- `git diff --check`
- read-only dependency audit if dependencies change (prefer no new dependency)

Node remains >= 24.19.0.

## Explicitly deferred to 1E-F or later

Do not implement:

- browser/UI fetch cutover;
- `proxy.ts` hosted-policy change;
- hosted settings persistence;
- hosted reminder migration;
- live/news/brief hosted migration;
- real D1 resource creation/binding;
- real Access application/policy creation;
- real principal grant seeding;
- TEAM_DOMAIN/POLICY_AUD production values;
- deployment;
- custom domain;
- natural-language task extraction;
- Telegram notifications;
- Google Calendar sync.

## Deliverable

Commit implementation to `milestone/1e-e-hosted-task-routes` and update the existing PR.

Return:

1. route paths and request contracts;
2. authentication/workspace authorization composition;
3. how `cloudflare:workers` binding access was isolated while preserving normal Next;
4. tests added and total count;
5. normal Next build result;
6. vinext build/runtime result;
7. remaining blockers before 1E-F browser/proxy cutover.

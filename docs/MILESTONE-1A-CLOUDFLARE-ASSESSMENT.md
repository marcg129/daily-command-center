# Milestone 1A: Cloudflare Workers compatibility assessment

Date: 2026-09-10  
Repository baseline: `marcg129/daily-command-center` at `d13e79e866cc33a1fddfe84f563ce2fb9a2113e0`  
Assessment scope: preserve the existing local application and assess, but do not initialize or deploy, a vinext/Cloudflare target.

## Executive decision

Proceed with **a staged vinext evaluation**, not a direct migration of the current server implementation. The application builds as Next.js 16.3.2 and its UI and domain logic are largely portable. Its server boundary is deliberately a single-machine Node application, however: every dynamic feature ultimately relies on a local JSON file or `node:sqlite`, the request proxy rejects hosted traffic, collection is driven by an in-process timer that calls loopback routes, and the outbound-fetch hardening uses Node sockets and DNS APIs.

The required `npx vinext check` was attempted but could not download the checker. The npm registry request returned `403 Forbidden`, so this run produced **no vinext compatibility verdict or per-API diagnostic**. This is an environment/network-policy limitation, not a successful or failed compatibility result for the source. Milestone 1B must begin by rerunning the exact check in an environment that can retrieve the package and pinning the resulting vinext version before changing runtime code.

## Baseline verification

All commands below were run against the baseline source before the assessment document was added.

| Check | Result | Notes |
| --- | --- | --- |
| Runtime | **Environment mismatch** | The repository requires Node `>=24.19.0`; the runner supplied Node `24.15.0` and npm `11.4.2`. |
| `npm run setup` | **Failed before setup** | The intentional version guard reported: “Control Center needs Node.js 24.19 or newer.” This is a runner limitation, not an application regression. |
| `npm ci` | **Passed with warning** | Installed 451 locked packages. npm emitted `EBADENGINE` for the same Node mismatch and an unrelated `http-proxy` configuration deprecation warning. No tracked files changed. |
| `npm run lint` | **Passed** | ESLint completed with exit code 0. |
| `npm test` | **Passed** | 215 tests passed; 0 failed, skipped, or cancelled. |
| `npm run build` | **Passed** | Next.js 16.3.2/Turbopack compiled, type-checked, generated 15 static pages, and listed all expected dynamic API routes. |
| `npm run smoke` | **Failed before server startup** | Smoke invokes the launcher, which invokes setup; the same Node version guard stopped it. This is the same pre-existing environment limitation, not a functional smoke-test failure. |

The installed Next.js 16 documentation was consulted as required by `AGENTS.md`, particularly `dist/docs/01-app/01-getting-started/17-deploying.md` and `dist/docs/01-app/03-api-reference/07-edge.md`. The latter explicitly confirms that native Node APIs and filesystem access are unavailable in the Edge runtime. This assessment does not assume that Edge-runtime support and vinext support are identical; the vinext check remains authoritative once it can run.

## vinext compatibility check

Command attempted, without running `vinext init`:

```text
$ npx vinext check
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/vinext
```

The configured registry was verified as `https://registry.npmjs.org/`, and `npm view vinext version --registry=https://registry.npmjs.org/` failed with the same 403. Direct registry and GitHub probes were also blocked by the environment's CONNECT proxy. No vinext package, configuration, generated artifact, dependency, or Cloudflare deployment was added.

**Status: inconclusive/tooling blocked.** Source inspection identifies definite hosted-runtime blockers below, but it cannot substitute for vinext's support matrix. Do not characterize the project as “vinext compatible” until the check completes against this exact commit.

## Blocking incompatibilities

1. **The persistence root is a process-local SQLite file.** `lib/server/database.ts` imports `DatabaseSync` from `node:sqlite`, creates `control-center.sqlite`, applies synchronous PRAGMAs, keeps a connection in `globalThis`, performs transaction SQL, creates pre-migration backups with `VACUUM INTO`, and changes POSIX permissions. All database-backed routes transitively depend on it. D1 requires an asynchronous binding and a different connection/transaction/migration boundary; changing only the import is not sufficient.
2. **Settings and collector history are local files.** `lib/server/settings.ts` stores secrets and OAuth tokens in `settings.json`; `lib/server/audience.ts` stores audience history in `snapshots.json`; and `lib/server/rss.ts`/`lib/sitemap.ts` store sitemap baselines in `industry-snapshots.json`. They use `node:fs`, `node:path`, `node:os`, atomic rename patterns, process IDs, and POSIX modes. A Worker instance has no durable host filesystem.
3. **The access boundary rejects a hosted hostname.** `proxy.ts` returns 403 unless the API `Host` is `localhost`, `127.0.0.1`, or `::1`. This is correct for the current unauthenticated local product and must remain until a hosted authentication/workspace boundary replaces it.
4. **Collection assumes one persistent local process.** `instrumentation.ts` starts `lib/server/scheduler.ts`, which uses process-global state, startup and interval timers, derives a `PORT`, and calls four API routes through `http://127.0.0.1`. Worker isolates are not a persistent singleton scheduler. Scheduled Events/Queues and directly callable collector services will be needed.
5. **Network hardening uses Node transport internals.** `lib/server/pinned-fetch.ts` uses `node:dns/promises`, `node:http`, `node:https`, `node:net`, and `node:stream` to validate and pin resolved public addresses and bound redirects/response reads. Workers `fetch` does not expose the same socket/DNS controls. This security property needs a Cloudflare-specific design rather than silent removal.
6. **Local AI endpoints are intentionally loopback-only.** `lib/ai-providers.ts` accepts only LM Studio/Ollama on numeric loopback addresses. A hosted Worker's loopback is not the user's computer, so local-model discovery and inference cannot operate unchanged.
7. **OAuth and secrets currently have machine-wide scope.** Google client credentials, refresh tokens, AI keys, and settings share one local settings document. A private multi-workspace host needs per-user/per-workspace authorization, encrypted secret handling, hosted callback origins, and state/session binding before this route can safely be exposed.

## Non-blocking warnings

- All API route files explicitly declare `runtime = "nodejs"`. Whether vinext accepts, translates, or flags this declaration must be taken from the rerun checker; do not bulk-delete declarations in advance.
- `node:crypto` hashing, UUID, and random-byte uses are conceptually portable through Web Crypto, but call sites use Node's synchronous API and should be adapted narrowly.
- RSS gzip decoding currently uses `node:zlib` and `node:stream`. Feed parsing itself is portable; only bounded response/decompression plumbing needs a Worker implementation and resource-limit tests.
- Several collectors can run for long periods (the newsletter scheduler allows 300 seconds) and perform bounded but numerous upstream requests. Worker CPU, wall-time, subrequest, response-size, and Gmail/AI pagination limits must be measured rather than guessed.
- In-memory globals serialize refreshes and cache database/model state only within one Node process. They cannot provide cross-isolate exclusion or correctness in a distributed runtime.
- Environment API keys are process variables today. Worker secrets/bindings can replace their source, but workspace scoping must be designed first.
- The current repository engine floor and setup workflow target Node 24.19+, while this assessment runner was older. This did not prevent lint, tests, or build but did prevent the supported launch/smoke path.

## Local-machine assumptions inventory

| Assumption | Evidence | Hosted consequence |
| --- | --- | --- |
| OS-specific durable root | `lib/server/settings.ts`, `scripts/paths.mjs` choose macOS Application Support, Windows LocalAppData, or XDG/home directories and preserve legacy `./.control-center`. | Replace runtime storage lookup; retain it for the local distribution and data-export tooling. |
| Local JSON secrets/settings | `lib/server/settings.ts` reads, atomically renames, and chmods `settings.json`. | Requires workspace-scoped database records and hosted secret protection. |
| Local SQLite initialization | `lib/server/database.ts` opens a file synchronously, runs PRAGMAs, initializes six stores, and updates `user_version` on request startup. | Replace the adapter and move schema rollout to explicit D1 migrations. Never race schema migration from requests. |
| Filesystem snapshots | `lib/server/audience.ts`, `lib/server/rss.ts`, and `lib/sitemap.ts` read/write snapshot JSON files. | Move state behind a durable repository; keep parsing/history logic. |
| In-process recurrence | `instrumentation.ts` and `lib/server/scheduler.ts` assume a continuously running singleton server. | Replace with Cloudflare scheduled/queued work and distributed idempotency. |
| Loopback server | `package.json`, `scripts/launch.mjs`, `scripts/smoke.mjs`, `scripts/ingest.mjs`, and the scheduler bind/call `127.0.0.1`. | Keep as local tooling; it is not the hosted entry point. |
| Loopback security policy | `proxy.ts` treats a local Host restriction as the primary request boundary. | Replace only alongside authentication, CSRF/origin policy, and workspace authorization. |
| Local model process | `lib/ai-providers.ts` permits only loopback LM Studio/Ollama endpoints. | Defer local AI for hosted MVP or design a separately authenticated user-side bridge later. Cloud AI logic can remain. |
| Host networking APIs | `lib/server/pinned-fetch.ts` controls DNS resolution and sockets directly. | Needs a reviewed Worker-safe SSRF/redirect policy and platform capability verification. |
| Machine backup/restore | `scripts/backup.mjs` backs up SQLite/settings/snapshots to `~/Documents`; `scripts/doctor.mjs` directly inspects those artifacts. | Keep for local installs; hosted backup, export, observability, and repair are separate operational capabilities. |
| Installer/launcher process control | setup/launch/smoke use `child_process`, filesystem mtimes, browser-opening commands, temporary directories, and local ports. | Keep outside the Worker bundle; create separate hosted CI/deployment checks later. |
| CLI connector ingestion | `scripts/ingest.mjs` reads files/stdin and defaults to the loopback brief API. | Adapt its target/auth contract after the hosted API exists; the payload normalization remains reusable. |

## KEEP / ADAPT / REPLACE / DEFER classification

Classification describes the **first hosted MVP** and does not authorize removal from the local application.

| Area | Class | Rationale |
| --- | --- | --- |
| React UI, components, page layout, and public DTO types | **KEEP** | No migration blocker found; preserve current behavior and visual design. |
| Task cleaning and recurrence (`lib/tasks.ts`) | **KEEP** | Pure business rules are covered by regression tests; change only the repository called by the route. |
| Ranking, freshness, filtering, canonicalization, deduplication, and collection scopes | **KEEP** | Modules such as `industry-curation`, `mention-filter`, `newsletter-intelligence`, `feed-priority`, `freshness`, and `collection-scope` contain reusable domain logic. Adapt individual Node hash calls without rewriting algorithms. |
| Feed parsing/discovery and audience history calculations | **KEEP** | Parsers and calculations are portable; isolate them from transport and snapshot persistence. |
| SQLite store modules (`archive-store`, `brief-store`, `collector-cache`, `industry-store`, `newsletter-store`, `workspace-store`) | **ADAPT** | Preserve schemas, invariants, queries where D1 supports them, and tests; introduce repository interfaces and an async D1 adapter. |
| Settings repository and secret lookup | **REPLACE** | A machine-wide JSON file with plaintext secrets cannot be the hosted multi-workspace authority. Retain the implementation only for local mode/import-export. |
| `node:sqlite` database bootstrap and request-time migration backups | **REPLACE** | D1 bindings and explicit migration tooling fundamentally differ from a synchronous local file/PRAGMA lifecycle. |
| Audience and sitemap snapshot persistence | **ADAPT** | Keep formats and state-transition logic, but persist through the hosted repository rather than JSON files. |
| Collector route orchestration | **ADAPT** | Collector concepts and bounded work remain; remove self-HTTP calls and make jobs explicitly invocable/idempotent. |
| Local interval scheduler | **REPLACE** | Use Scheduled Events/Queues; do not depend on process lifetime or global timers. |
| Node pinned socket fetch | **ADAPT** | Preserve security goals and parsing contracts; implement only after confirming Cloudflare egress/DNS controls and documenting any weaker guarantee. |
| Cloud AI providers and deterministic fallbacks | **ADAPT** | Fetch-based provider logic is reusable; obtain secrets per workspace and verify execution limits. |
| LM Studio/Ollama loopback integration | **DEFER** | Keep source and local behavior, but it cannot work from the hosted Worker without a user-side bridge. It should not block the first hosted MVP. |
| Gmail newsletter intelligence | **ADAPT** | Preserve Gmail parsing, masking, ranking, and deduplication. Replace token storage, callback origin/state, persistence, and background orchestration. |
| Local setup, launch, smoke, doctor, backup, and browser-opening scripts | **DEFER** | Keep for the existing local distribution. They should not enter the Worker bundle or define hosted operations. |
| Connector bridge ingestion | **DEFER** | Preserve the feature in source. Hosted authentication and workspace ownership must precede exposure. |
| Local Host/Origin proxy policy | **REPLACE** for hosted mode | Retain for local mode; hosted mode needs authentication plus trusted-host/origin and workspace authorization policies. |

## Recommended migration sequence

### Milestone 1B — prove the shell and establish boundaries

1. Use Node 24.19+ and an npm/network environment that can fetch vinext. On a clean checkout of this baseline, run `npx vinext check`, record the exact package version and complete output, and stop if the checker reports an unsupported Next.js/API combination.
2. If the check is actionable, create a short-lived proof branch and add only the minimal vinext/Cloudflare configuration needed to build a **static shell plus a storage-independent health endpoint**. Do not point production traffic at it and do not delete the Next/local path.
3. Add explicit runtime interfaces for settings/secrets, workspace/content persistence, snapshots, collector dispatch, clock/IDs, and outbound fetch. Keep the current filesystem/SQLite adapters as the default so local behavior and existing tests remain unchanged.
4. Add a request context carrying a workspace identifier, but do not yet invent product workspaces or authentication. Require tests to demonstrate that no repository call can cross context boundaries.
5. Port Web-standard primitives at boundary call sites (`node:crypto`, bounded decompression/streams) only when the compatibility output or proof build requires it.
6. Produce a capability matrix from an actual vinext build/check: route handling, proxy behavior, instrumentation, Node runtime declarations, environment/bindings, timers, and each Node built-in in the reachable bundle.

**Exact next implementation task:** _Create and test storage/secret/collector interfaces with the existing local filesystem and `node:sqlite` implementations behind them, leaving behavior unchanged; include workspace context in interface signatures, but do not add D1 or user-facing workspaces._ This is the smallest change that preserves reusable logic and makes the later D1 move reviewable.

### Milestone 1C — introduce hosted infrastructure behind the boundaries

1. Define explicit, versioned D1 migrations for workspace state, content/archive state, collector snapshots/discoveries, newsletter evidence, audience history, settings metadata, and job/idempotency records. Do not translate request-time `PRAGMA user_version` migration behavior literally.
2. Implement asynchronous D1 repositories and dual-run their contract tests against local SQLite and D1 semantics, accounting for transaction differences.
3. Add hosted secret storage and authenticated workspace resolution before enabling settings, Gmail OAuth, ingestion, mutations, or collector routes.
4. Replace the timer/self-HTTP scheduler with Scheduled Events and Queues. Split and checkpoint long jobs, enforce idempotency, and preserve saved-fallback behavior.
5. Implement and security-review the Cloudflare outbound-fetch policy. Test redirects, private/special addresses, rebinding-related assumptions, compression bombs, timeouts, and response bounds.
6. Enable collectors incrementally (Industry first, then Mentions/Audience, then Gmail/AI-heavy newsletters) while keeping the local adapters and regression suite intact.
7. Add hosted backup/export and operational health checks. Local doctor/backup scripts remain supported but are not reused as server operations.

## Files likely to require modification

| File/group | Expected change |
| --- | --- |
| `lib/server/database.ts` | Split local bootstrap from a runtime-neutral persistence provider; later bind D1. |
| `lib/{archive,brief,collector-cache,industry,newsletter,workspace}-store.ts` | Convert direct synchronous `DatabaseSync` APIs to tested repository contracts/adapters. |
| `lib/server/settings.ts` | Separate normalization/public DTO logic from local filesystem and secret persistence. |
| `lib/server/audience.ts`, `lib/server/rss.ts`, `lib/sitemap.ts` | Inject snapshot repositories and Worker-compatible response/decompression primitives. |
| `lib/server/pinned-fetch.ts`, `lib/server/public-address.ts`, `lib/server/safe-fetch.ts` | Create a platform transport boundary while preserving SSRF controls where the platform allows. |
| `instrumentation.ts`, `lib/server/scheduler.ts` | Disable local scheduling in hosted mode and add scheduled/queued entry points. |
| `proxy.ts` | Preserve local policy and add a separate authenticated hosted policy. |
| `app/api/**/route.ts` | Resolve request/workspace context and async repositories; remove unconditional dependency on the local database. |
| `app/api/auth/google/**` | Hosted callback origin, secret/token repository, state/session binding, workspace ownership. |
| `next.config.ts`, `package.json`, lockfile, future vinext/Cloudflare config | Minimal build/runtime configuration only after a successful compatibility check. |
| `tests/**` | Repository contract, workspace isolation, scheduled-job/idempotency, Worker runtime, and security tests. |

## Modules to leave untouched initially

Do not rewrite these merely to make persistence portable:

- UI and layout files under `components/` and the main `app/page.tsx`/styles.
- `lib/tasks.ts` recurrence, immutable completion, and cleaning rules.
- `lib/industry-curation.ts`, `lib/industry.ts`, `lib/feed-priority.ts`, and `lib/freshness.ts` ranking/freshness behavior.
- `lib/mention-filter.ts`, `lib/mention-curation.ts`, `lib/mention-work.ts`, and mention summary/deduplication rules.
- `lib/newsletter-intelligence.ts`, filtering, aliasing, canonical URL, masking, and feed parsing logic.
- Audience growth/chart calculation modules.
- Existing local scripts until equivalent hosted operations exist.
- `LICENSE`, attribution, and all existing feature code.

Some listed modules import `node:crypto`; replace that primitive locally if required, without changing the business algorithm or expected IDs unless a deliberately versioned data migration is approved.

## Testing risks and required coverage

- **Async conversion:** current stores and transactions are synchronous. Tests must catch lost atomicity, stale writes, collector/archive races, and partial recurring-task completion when adapters become async.
- **SQLite dialect/transaction differences:** validate every schema, upsert, index, JSON payload, timestamp comparison, alias migration, and rollback path against D1 rather than assuming local SQLite equivalence.
- **Workspace isolation:** every read, mutation, cache key, OAuth token, AI key, job, and archive identity needs positive and negative cross-workspace tests.
- **Ephemeral/concurrent execution:** replace process globals with durable idempotency. Test overlapping scheduled/manual refreshes, retries, out-of-order completion, and isolate restarts.
- **Collector limits:** use fixtures to measure subrequests, CPU/wall time, body/decompression bounds, and checkpoint/resume behavior. Newsletter backfill and mention verification are the highest-risk flows.
- **Outbound request security:** the current pinning tests express important guarantees that a plain `fetch` port may lose. Any accepted platform limitation must be explicit and compensated, not silently weakened.
- **Secrets/OAuth:** test that keys and refresh tokens never enter public DTOs, logs, cache payloads, error text, or a different workspace; verify callback replay and state binding.
- **Behavior parity:** continue running all 215 regression tests against the local adapter. Add a supported-runtime launcher smoke test and a separate vinext/Worker integration test.

## Uncertainty requiring verification

1. The exact vinext result for Next.js 16.3.2, explicit Node route runtimes, proxy, and instrumentation is unknown because the checker package could not be downloaded.
2. The package version and Cloudflare compatibility date to pin are unknown until registry access is restored; record them rather than using an unpinned `npx` in repeatable CI.
3. Worker/D1 transaction behavior needed for archive/cache synchronization, recurring completion, migrations, and newsletter aliases must be proven with contract tests.
4. The strongest feasible replacement for DNS/socket pinning on Cloudflare must be confirmed with current platform capabilities and threat modeling.
5. Actual Worker limits for the bounded collectors—especially Gmail backfill, AI calls, sitemap recursion, and page verification—must be measured using representative fixtures and a non-production preview.
6. Hosted authentication, encrypted secret storage, and tenant/workspace ownership are intentionally outside this milestone, but must be decided before any private route is exposed.

## Milestone 1A change boundary

This document is the only intended tracked change. No UI, product feature, dependency, runtime configuration, generated vinext artifact, database, schema, or deployment was changed. The MIT license and attribution remain intact.

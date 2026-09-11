# Milestone 1B-D: hosted integration proof (blocked run)

Date: 2026-09-11  
Requested branch: `milestone/1b-hosted-integration-proof`  
Baseline commit: `9f9c64f` (`feat: add hosted auth, secret, and scoped store contracts`)

## Decision

**READY FOR HOSTED MVP FOUNDATION: NO**

This is not a judgment that the repository is incompatible with Cloudflare Workers. The mandatory compatibility and local-runtime tools could not be downloaded in this execution environment, so the milestone's platform claims cannot be proven. No production or remote Cloudflare command was run, no public route was added, and no Cloudflare resource was created or modified.

The stop is intentional. Initializing vinext, inventing generated configuration, or labeling SQLite compatibility tests as D1 tests without first running the requested tools would turn an environment failure into a misleading architecture result.

## Baseline before changes

| Item | Observed result |
| --- | --- |
| Node | `v24.15.0` |
| npm | `11.4.2` |
| Declared Node minimum | `>=24.19.0`; the runner is below the supported minimum and `npm ci` emitted `EBADENGINE`. The requirement was not weakened. |
| `npm ci` | Passed; 451 locked packages installed. |
| `npm run lint` | Passed. |
| `npm test` | Passed: **232 tests**, 0 failed, 0 skipped. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed with Next.js 16.3.2: compilation and type checking succeeded and 15 static pages were generated. |

The installed Next.js deployment guide was read as required by `AGENTS.md`. It describes Cloudflare as an unverified, third-party integration whose feature support may vary. That makes an actual adapter check and build especially important; a normal Next.js build is not substitute evidence for a vinext build.

## Mandatory vinext gate

The real command was attempted before source changes:

```text
$ npx vinext check
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/vinext
```

The proxy also rejected direct npm-registry requests with HTTP 403. Consequently:

- exact vinext version: **unavailable; package not resolved or installed**;
- compatibility result: **not produced; checker did not execute**;
- Next.js 16.3.x, App Router, route handlers, `proxy.ts`, instrumentation, and explicit `runtime = "nodejs"` diagnostics: **not produced**;
- blocker versus informational-warning classification: **not possible without output**;
- `vinext init`: **not run**;
- generated/modified vinext files: **none**;
- ordinary Next.js workflow: **unchanged**;
- `npm run build:vinext`: **not created and not run**.

This is a tooling-access blocker, not a fundamental vinext finding. The next run must start again with `npx vinext check`; it must not infer that this 403 means compatibility or incompatibility.

## Wrangler and actual local D1

Wrangler was not present in the dependency tree or executable path. Resolving it was tested without invoking any database operation:

```text
$ npm view wrangler version
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/wrangler
```

Therefore no exact Wrangler version could be selected and pinned. With no genuine Wrangler local runtime available, this run deliberately did **not**:

- fabricate a `wrangler` configuration or production-looking D1 identifier;
- run `wrangler d1 migrations apply` (locally or remotely);
- claim that migrations `0001` through `0004` were applied to D1;
- create a `test:d1` command backed by `node:sqlite` and call it real D1;
- run a remote migration, write, deployment, or secret command.

The migrations and narrow `D1Database` contract remain available for a later real run. The contract consists only of `prepare`, prepared-statement `bind`/`first`/`all`/`run`, and `batch`, which maps closely in shape to a Cloudflare binding. Whether result metadata, errors, and especially `batch` rollback behavior match the current repository assumptions remains explicitly unverified.

## D1 semantic proof status

| Required behavior | Real local D1 result in this run |
| --- | --- |
| Apply migrations 0001-0004 | **Blocked: Wrangler unavailable.** |
| Task plus visibility atomic batch | **Unverified on D1.** |
| Deliberately failing later batch statement rolls back earlier write | **Unverified on D1; no rollback finding is claimed.** |
| Personal-owned to Indelitech visibility trigger rejection | **Unverified on D1.** |
| Indelitech-owned to Personal visibility acceptance | **Unverified on D1.** |
| Foreign-key failures | **Unverified on D1.** |
| Duplicate visibility/domain composite-key failures | **Unverified on D1.** |
| `json_valid(...)` failures | **Unverified on D1.** |
| Primary workspace immutability trigger | **Unverified on D1.** |
| Same underlying shared task mutation | **Covered by the fast SQLite compatibility contract, but not proven on D1.** |
| Recurrence metadata round trip | **Covered by the fast SQLite compatibility contract, but not proven on D1.** |
| Date-only `YYYY-MM-DD` preservation | **Covered by the fast SQLite compatibility contract, but not proven on D1.** |

The existing fast contract suite remains valuable and remains separate. It passed 232 tests, including the D1-shaped task and workspace-domain adapters, but it is correctly classified as `node:sqlite` compatibility—not actual Cloudflare D1 integration.

## Secret-platform evaluation status

The milestone requires a current, source-backed evaluation of Workers Secrets and the beta Cloudflare Secrets Store, including per-secret binding behavior, dynamic selection, local development, account/store limits, and redeployment overhead. Cloudflare documentation and web lookup were unavailable from this environment, so volatile beta limits and current CLI behavior are **not asserted from memory**.

The V1 architectural recommendation remains provisional but conservative:

- **Fixed APPLICATION secrets:** evaluate Workers Secrets and Secrets Store on the next connected run. Either may fit a small, fixed set of operator-managed application bindings; select only after local-development and binding lifecycle behavior is verified.
- **Dynamic USER / WORKSPACE secrets:** do not assume a fixed Worker binding model scales to arbitrary credentials. Preserve `SecretProvider` and `SecretAuthorizationService` while a reviewed dynamically addressable protected store is selected. Do not store plaintext in D1 and do not implement homemade encryption.

No dummy or real secret value was created. In particular, no value was added to repository files or `secret_metadata`; no settings DTO or log path was changed. Existing tests continue to establish that public settings omit persisted secrets and authorization precedes access to the in-memory test provider, but this is not a Cloudflare secret-provider proof.

## Hosted composition and representative store proof

No hosted composition root was added because there is no vinext/Workers runtime or real D1 binding in which to prove it. The prerequisites remain independently present:

```text
SessionProvider -> AuthenticatedPrincipal -> WorkspaceResolver -> RequestContext
                                                         -> D1 repositories

SecretAuthorizationService -> SecretProvider
```

The fake session provider is opaque-token based and does not trust arbitrary request headers. The workspace-domain boundary includes `DAILY_BRIEF` and `INDUSTRY_DISCOVERY`, but mapping a representative application service to that boundary is still outstanding. Existing local routes and specialized stores remain unchanged.

## Node-specific compatibility inventory

This source inventory is not a vinext-check result:

| Area | Classification | Reason |
| --- | --- | --- |
| Local SQLite bootstrap and specialized stores | **LOCAL-ONLY** | Depend on `node:sqlite` and a durable local file. Existing local path must remain. |
| Filesystem settings and snapshots | **LOCAL-ONLY** | Depend on `node:fs`, OS paths, rename/chmod semantics. |
| Pinned network transport | **HOSTED-ADAPT** | Uses Node DNS, HTTP(S), net, and stream APIs. Preserve SSRF goals rather than silently weakening controls. |
| Sitemap gzip/stream transport | **HOSTED-ADAPT** | Uses Node streams, zlib, filesystem snapshots, and crypto. Parsing/domain logic is reusable. |
| Interval scheduler and self-HTTP dispatch | **HOSTED-BLOCKER** | Depends on process-global timers and loopback requests; replace with reviewed scheduled/queued composition before hosted collectors. |
| LM Studio/Ollama loopback integration | **DEFER** | A Worker cannot reach the user's local loopback service. |
| Node crypto call sites | **HOSTED-ADAPT** | Adapt narrowly to Web Crypto when a reachable hosted bundle requires it. |
| Explicit Node route runtimes, proxy, and instrumentation | **HOSTED-ADAPT / pending checker** | Exact vinext behavior must come from the compatibility report and proof build. |
| Local setup, launcher, backup, doctor, and ingestion CLI | **LOCAL-ONLY** | They are machine operations and must remain out of a Worker entry point. |

## Build and runtime proof

- Normal Next.js build: **passed**.
- vinext build: **not available because compatibility checking and initialization were blocked before a vinext version/configuration existed**.
- Minimal shell under vinext development runtime: **not run**.
- Non-public D1 composition proof: **not run**.
- Public deployment: **none**.

## Remaining blockers and exact next milestone

All acceptance items that depend on vinext, Wrangler, real local D1, or current Cloudflare documentation remain blockers. Production authentication, Cloudflare Access, hosted origin/CSRF policy, Worker-safe outbound fetch, scheduled/queued orchestration, operational recovery, and a reviewed dynamic secret provider also remain deliberately absent.

**Exact next milestone/run:** repeat Milestone 1B-D in an environment with npm registry and official Cloudflare documentation access. Run and record a pinned `vinext check`; only if its findings permit, initialize non-destructively and pin vinext/Wrangler, then build both paths, apply migrations 0001-0004 to disposable Wrangler `--local` state, and execute the complete semantic and composition suite through the actual local D1 binding. Only a successful run may change this decision to `YES` and authorize starting the user-facing Personal/Indelitech shell; it still must not deploy or expose traffic.

# Milestone 1B-A: runtime boundaries

Date: 2026-09-10  
Branch: `milestone/1b-runtime-boundaries`

## Outcome

Milestone 1B-A introduces runtime-neutral contracts around workspace/task data, settings and secrets, durable snapshots, collector invocation, time/IDs, and outbound text transport. The existing local filesystem, `node:sqlite`, scheduler, and pinned Node network transport remain the default implementations. No D1 database, Cloudflare configuration, deployment, authentication, product workspace, workspace selector, or UI change was added.

## Dependency shape

Before:

```text
routes / scheduler / collector logic
        |         |        |
        +-- node:sqlite    +-- loopback HTTP
        +-- local JSON files
        +-- Node DNS and sockets
```

After:

```text
routes / services / reusable logic
                  |
       RequestContext { workspaceId }
                  |
  +---------------+----------------+------------------+
  | repository contracts           | service contracts|
  | workspace, settings/secrets,    | collector dispatch|
  | snapshots, collector cache      | outbound transport|
  +---------------+----------------+------------------+
                  |
       legacy-local adapters (default)
                  |
       node:sqlite / JSON files / pinned Node sockets

Future: authenticated context -> D1 / hosted secrets / Scheduled Events
```

## Interfaces and decisions

### Request and workspace context

`RequestContext` carries an explicit `workspaceId`. `legacyRequestContext()` returns the sole `legacy-local` context used by today's application. Local adapters call `requireLegacyWorkspace`; they do not ignore an unexpected workspace and therefore fail closed instead of accidentally returning the legacy workspace's data. Authentication and request-derived workspace resolution are intentionally deferred.

### Workspace/task persistence

`WorkspaceRepository` is Promise-based so a later D1 adapter does not force another route-wide signature conversion. `LocalWorkspaceRepository` delegates to the existing synchronous SQLite store and preserves its atomic two-row write, incomplete/corrupt-row recovery errors, task cleaning at the service boundary, and immutable recurring-completion merge. The workspace route is now a thin composition root. Its handler factory accepts repository, context, clock, and ID dependencies, making context propagation and deterministic behavior testable without changing `lib/tasks.ts`.

The SQLite table is intentionally not changed in this milestone: the local adapter accepts only `legacy-local`. A D1 schema must include `workspace_id` in keys and queries before additional contexts are enabled.

### Settings and secrets

The stored settings shape now belongs to the runtime contract rather than the filesystem module. `SettingsPersistence`, `SettingsService`, and `SecretStore` distinguish full private records and secret lookup from public settings behavior. `publicSettingsFromStored` is a runtime-neutral DTO projection; the local settings module delegates to it. `LocalSettingsPersistence`, `LocalSettingsService`, and `LocalSecretStore` retain the existing private JSON file, environment-key fallback, serialization queue, atomic write, and file modes. The HTTP settings route returns only `PublicSettings`; token, client-secret, provider-key, and audience credentials remain excluded.

This is a seam, not a hosted secret design. The local private record still stores OAuth tokens and credentials in `settings.json`, as before.

### Durable snapshots/state

`SnapshotRepository<T>` abstracts the audience and industry sitemap JSON documents. `LocalJsonSnapshotRepository` retains local JSON persistence, atomic replacement, private directory/file modes, audience fail-closed corruption behavior, and the industry's existing empty-fallback behavior. Both snapshot APIs accept a context and a repository, with the legacy adapter as their default.

`CollectorSnapshotRepository` similarly covers the SQLite-backed response cache and archive reconciliation. Live collector, Daily Brief, and library route call sites use `LocalCollectorSnapshotRepository` with explicit legacy context. The underlying reconciliation algorithm and SQLite schema remain unchanged.

### Collector dispatch

`CollectorDispatch` and `CollectorService` make each collector callable by name with an explicit context. The local service invokes route collector functions directly in-process; it does not make a TCP or HTTP round trip. The unchanged process timer now calls this service. This provides a future Scheduled Event/Queue entry point while retaining the existing startup delay, 15-minute interval, overlap guard, and all-settled failure isolation.

The direct local handlers currently reuse route functions to avoid rewriting collector algorithms. A hosted adapter should extract orchestration payloads from those handlers while preserving the service contract.

### Clock and IDs

Minimal `Clock` and `IdGenerator` contracts were added only at the workspace mutation boundary. Production uses the system clock and Web UUID generation. Tests inject fixed implementations. Existing algorithmic date and identity code was not broadly abstracted.

### Outbound fetch

`OutboundTransport` describes bounded text reads. `localOutboundTransport` delegates to `safeFetchText`; therefore the authoritative local implementation still performs public-address validation, DNS/socket pinning, bounded redirects, timeouts, and response-size checks. Existing collector call sites remain on `safeFetchText` for this milestone, so no security guarantee was weakened. A Cloudflare transport is deferred pending a platform-specific SSRF design.

## Intentionally remaining direct local dependencies

- `lib/server/database.ts` still owns `node:sqlite`, PRAGMAs, migrations, migration backups, permissions, and its process-global connection.
- Content/archive, brief, industry-discovery, and newsletter-evidence stores still use `DatabaseSync` internally. They were not rewritten because Milestone 1B-A targets seams, not a premature D1 translation.
- `lib/server/settings.ts` remains the default filesystem settings implementation and retains OS data-directory resolution, process IDs, atomic rename, and POSIX modes.
- Audience and industry snapshot adapters use the local filesystem by default.
- The local scheduler still depends on process timers and process-global overlap state, but no longer depends on loopback networking.
- Pinned fetch still uses Node DNS, HTTP(S), sockets, and streams. This remains the required local SSRF defense.
- Local AI integrations still require numeric loopback endpoints. Local launch, setup, backup, doctor, and connector scripts remain machine-oriented.
- Route files remain declared as `nodejs`; no vinext or Worker runtime conversion was attempted.

## Verification

### Baseline, before code changes

| Command | Result |
| --- | --- |
| `npm ci` | Passed; npm warned that Node 24.15.0 is below the repository requirement of 24.19.0. |
| `npm run lint` | Passed. |
| `npm test` | Passed: 215 tests. |
| `npm run build` | Compiled successfully and entered/finished type checking; the captured command wrapper yielded before recording the final exit status, so the final build was rerun after changes. |
| Supported `npm run setup` / `npm run smoke` | Not run because the environment does not satisfy the declared Node requirement. This is an environment limitation, not an application regression. |

### vinext

`npx vinext check` was attempted again and failed while downloading the package: the configured npm registry returned `403 Forbidden` for `https://registry.npmjs.org/vinext`. No checker executed, so vinext compatibility is **inconclusive**, neither passed nor failed. `vinext init` was not run.

### Added coverage

`tests/runtime-boundaries.test.ts` verifies:

- route-to-repository propagation of the exact workspace context;
- explicit propagation of injected clock and generated IDs;
- the local SQLite repository contract, including immutable recurring completion history;
- rejection of non-legacy contexts by local persistence;
- exclusion of every persisted secret category from the public settings DTO;
- direct collector dispatch without loopback networking and with context propagation;
- local JSON snapshot read/write behavior and cross-context rejection.

Final command results are recorded in the completion report/commit that accompanies this document.

## Deferred behavior and migration seams

No Personal or Indelitech workspace exists yet. No data is duplicated, partitioned, or migrated, and no workspace selection or authentication is inferred. The new Promise-based repository contracts can be implemented by D1; the secret contract can be backed by a reviewed hosted mechanism; collector dispatch can be called by Scheduled Events or Queues; and snapshot contracts can move durable state out of local files without changing ranking, parsing, freshness, recurrence, or curation algorithms.

## Exact recommended next task

**Milestone 1B-B: design and contract-test authenticated workspace resolution plus a versioned hosted persistence model for exactly the future Personal and Indelitech workspace IDs. Add D1 migration files and D1 repository adapters for workspace/task and collector snapshot data behind the interfaces introduced here, including positive and negative cross-workspace tests and an import plan for legacy-local data; do not expose a selector or enable hosted traffic until authentication, secret ownership, and all remaining workspace-owned SQLite stores have equivalent scoped contracts.**

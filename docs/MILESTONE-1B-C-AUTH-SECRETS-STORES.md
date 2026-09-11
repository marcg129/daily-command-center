# Milestone 1B-C: authentication, secrets, and remaining hosted stores

Date: 2026-09-11
Branch requested: `milestone/1b-auth-secrets-hosted-stores`
Execution branch supplied by the environment: `work`

## Outcome and safety boundary

This milestone adds production-independent session contracts, three explicit secret-owner types, an authorization service, a fake protected provider, and workspace-scoped hosted persistence boundaries for the remaining durable collector domains. It does **not** implement authentication, inspect identity headers, configure Cloudflare Access, expose hosted routes, select a product workspace, deploy, or alter the current UI.

The local runtime remains the default. Existing routes continue to use `legacy-local`, local SQLite, filesystem settings and secrets, filesystem snapshots, the local scheduler, and the existing local specialized stores. Setup, doctor, backup, and the loopback proxy policy were not removed or redirected.

## Authentication and workspace authorization

```text
SessionProvider
      ↓
AuthenticatedPrincipal
      ↓
WorkspaceResolver
      ↓
RequestContext
```

`AuthenticatedPrincipal` carries a validated, stable `PrincipalId`. `AuthenticatedSession` carries the principal, an opaque session ID, and an expiry. `SessionProvider` resolves an opaque session identity; it has no request-header shortcut. `requireAuthenticatedSession` rejects absent, structurally incomplete, malformed-expiry, and expired sessions. `InMemorySessionProvider` is test-only and stores no credentials.

Authentication and workspace authorization remain deliberately separate. After session validation, `WorkspaceResolver` still requires an explicit grant for the requested product workspace. A valid principal, a supplied workspace ID, or visibility of a shared record is not a grant. No HTTP handler uses the fake provider or resolver.

## Secret ownership and provider contracts

```text
Secret request
      ↓
Authorization service
  ↙       ↓       ↘
Application User Workspace
  owner   owner    owner
      ↓
SecretProvider
```

`SecretOwner` is a discriminated union:

- `APPLICATION` uses a typed `ApplicationId` and is accessible only when the caller presents the exact permitted application-service identity.
- `USER` uses a typed `PrincipalId` and is accessible only to that authenticated principal.
- `WORKSPACE` uses a `ProductWorkspaceId` and is accessible only in a request context for that exact workspace.

Secret IDs and names are validated typed identifiers. `SecretAuthorizationService` applies authorization before `get`, `set`, or `delete`. It does not consult content visibility. Therefore Personal visibility into an Indelitech task/content record cannot authorize an Indelitech workspace secret.

The application-facing `SecretProvider` accepts plaintext only at its narrow method boundary and leaves protection to the provider. `InMemorySecretProvider` is a test fake, not encryption and not a production recommendation. Its plaintext map is process-only; its separately observable metadata contains only identity, owner, provider reference, and timestamps. No keys or genuine credentials are stored in source or fixtures. A future provider must use a reviewed platform encryption/key-management facility; homemade cryptography is explicitly out of scope.

Migration `0004` provides optional hosted metadata storage with `secret_id`, owner type/ID, secret name, provider reference, and timestamps. There is intentionally no plaintext/value/ciphertext column. The provider remains the authority for protected material.

## Persistence ownership audit

| Existing data/settings | Ultimate owner | Milestone decision |
| --- | --- | --- |
| Product workspaces, feature flags required to operate the hosted service, provider allowlists | Application-global metadata | Do not place in workspace records; no new global settings store was justified here. |
| UI preferences that follow one signed-in person | User | Future non-secret user settings repository; not migrated prematurely. |
| Personal feeds, watchlists, audience identities, brief connectors, display limits | Personal workspace | Ordinary metadata belongs to Personal; secret credentials use a Personal `WORKSPACE` owner or `USER` only when genuinely personal. |
| Indelitech feeds, newsletter mailbox configuration, audience identities, collection scopes | Indelitech workspace | Ordinary metadata belongs to Indelitech; credentials are exact Indelitech `WORKSPACE` secrets. |
| Google client secret, refresh/access tokens, AI keys, audience credentials | Application, user, or workspace depending on operational provenance | Always secret-bearing; never store in ordinary settings metadata. Existing filesystem behavior remains local-only. |
| Archive/content workflow state | Workspace | Hosted boundary and scoped D1 records added; local `archive-store` remains active. |
| Daily Brief items/source state | Workspace | Hosted boundary and scoped D1 records added; local `brief-store` remains active. |
| Industry raw discoveries | Workspace | Hosted boundary and scoped D1 records added; local `industry-store` remains active. |
| Newsletter issues, evidence, aliases | Workspace | Hosted boundary and scoped D1 records added; local `newsletter-store` remains active. |
| Audience history | Workspace | Hosted boundary and scoped D1 records added; filesystem snapshot adapter remains active. |
| Industry/sitemap baselines | Workspace | Hosted boundary and scoped D1 records added; filesystem snapshot adapter remains active. |

Ranking, parsing, curation, deduplication, retention, and freshness algorithms were not changed. The common `WorkspaceDomainRepository` is an asynchronous runtime-neutral record boundary, with domain-specific aliases for content, Daily Brief, industry discovery, newsletter evidence, audience history, and sitemap snapshots. Every D1 `get`, `put`, `delete`, and `list` validates a product context and binds `workspace_id`, `domain`, and record identity as appropriate. The compatibility local adapter accepts only `legacy-local`. Specialized local stores remain route defaults; wiring hosted routes is intentionally deferred.

## D1 migrations

The existing ordered `0001`–`0003` migrations remain unchanged. New migration `0004_secrets_and_workspace_domains.sql` adds:

1. `secret_metadata`, constrained to `APPLICATION`, `USER`, or `WORKSPACE`, with provider references but no secret value column;
2. `workspace_domain_records`, whose primary key is `(workspace_id, domain, record_key)`, whose workspace is a foreign key, whose domains are enumerated, and whose payload must be valid JSON;
3. owner and workspace/domain recency indexes.

This is a versioned hosted migration and does not use or copy the local `PRAGMA user_version` bootstrap. It seeds neither production data nor secrets.

## Validation and D1 semantics

### Baseline before source changes

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 451 locked packages installed. npm warned that Node 24.15.0 is below the declared Node 24.19.0 floor. |
| `npm run lint` | Passed. |
| `npm test` | Passed: 227 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed under Next.js 16.3.2; 15 static pages generated and dynamic routes retained. |
| `npx vinext check` | Blocked before execution by `E403` retrieving `https://registry.npmjs.org/vinext`. No vinext verdict exists; `vinext init` was not run. |

### Actual local D1 attempt

The currently documented Cloudflare local workflow requires Wrangler (`wrangler d1 execute <database> --local --file <migration>`). `npx wrangler --version` was attempted first so no database could accidentally be targeted. npm returned `E403 403 Forbidden - GET https://registry.npmjs.org/wrangler`. Wrangler is not present in the lockfile or environment, so a disposable local D1 database could not be created and **real D1 compatibility was not proven**.

The exact migrations and adapter SQL continue to run in contract tests through the prior `node:sqlite` compatibility harness. Those tests prove application-side workspace binding, constraints/triggers as interpreted by local SQLite, positive isolation, negative isolation, same-record task mutation, archive/cache update consistency, and foreign-key/unique/visibility constraint failures in SQLite. They do not establish Cloudflare D1 transaction behavior.

### Batch/transaction findings

- Task creation relies on `D1Database.batch` for a task row plus visibility rows. The compatibility fake executes statements sequentially and does not emulate D1 rollback guarantees. Failure atomicity and partial-write rollback therefore remain **unverified on real D1**.
- Unique, foreign-key, and task visibility-trigger failures are verified only on SQLite compatibility execution. Real local D1 confirmation remains blocked.
- Same-record mutation through Personal/Indelitech visible task views is verified in the adapter contract suite.
- Collector archive mutation and cache consistency remain covered by existing local and compatibility tests. The new domain adapter uses one-statement atomic upserts/deletes, but multi-record archive workflows need real D1 validation before hosted wiring.
- No code assumes the compatibility fake proves D1 transactions. The next integration milestone must run migrations in a disposable `--local` database and include an intentionally failing batch followed by direct reads that establish whether earlier writes rolled back.

## Tests added

New contract coverage proves missing/malformed sessions fail closed; opaque valid authentication does not confer workspace access; supplied workspace identity is not authorization; application/user/workspace secret policies deny cross-owner access; Personal roll-up visibility cannot read an Indelitech secret; hosted secret metadata omits plaintext; every remaining domain isolates equal keys between product workspaces; hosted adapters reject missing/legacy contexts; and the compatibility local adapter preserves legacy-only behavior.

## Remaining blockers

1. Registry policy blocks vinext and Wrangler, so neither vinext compatibility nor actual D1 behavior has a verdict.
2. No production session verifier or Cloudflare Access integration exists by design.
3. No reviewed hosted encryption/KMS provider has been selected or implemented.
4. Hosted routes are not wired, authenticated, CSRF/origin protected, or exposed.
5. Existing specialized store algorithms still need application-service mappings onto the hosted domain records before traffic can use them; local defaults must remain throughout that work.
6. D1 batch rollback, constraints, triggers, and multi-record consistency must be rerun against Wrangler local emulation.
7. Hosted outbound-fetch policy, scheduled/queued orchestration, operations, backup/export, and a non-production environment remain unresolved.

## Exact recommended next milestone

**Milestone 1B-D — non-production hosted integration proof:** in an environment that can install pinned vinext and Wrangler, run `vinext check`, apply migrations `0001`–`0004` to a disposable Wrangler local D1 database, execute repository and deliberately failing batch/constraint/trigger tests against the real D1 binding, select and implement a reviewed platform-backed secret provider, and add an authenticated (still non-public) composition root that maps the existing specialized store services onto these hosted repositories. Do not enable hosted traffic or product UI until those results, CSRF/origin policy, outbound-fetch controls, and operational recovery are reviewed.

# Milestone 1B-D: hosted integration proof (final validation)

Date: 2026-09-11
Base branch: `milestone/1b-d-ci-proof`
Proof workflow: [`.github/workflows/cloudflare-proof.yml`](../.github/workflows/cloudflare-proof.yml)
Detailed CI procedure: [`MILESTONE-1B-D-CI-PROOF.md`](./MILESTONE-1B-D-CI-PROOF.md)

## Established baseline

The existing GitHub Actions run established the following non-production baseline:

| Check | Result |
| --- | --- |
| Node | **24.19.0** |
| Existing test suite | **PASS — 232 tests** |
| Ordinary Next.js production build | **PASS** |
| vinext compatibility check | **86%** with vinext **1.0.0-beta.9** |
| Local D1 migrations | **PASS — migrations 0001 through 0004** |
| Personal → Indelitech visibility trigger | **PASS — invalid visibility rejected by real local D1** |

The compatibility report identified a missing package-level `"type": "module"`. It also reported `reactStrictMode` as partially supported. These findings are recorded rather than hidden by hand-editing the application in this proof. The normal Next.js path remains unchanged.

## Reproducible tool versions

The executable proof is pinned to:

- `VINEXT_VERSION=1.0.0-beta.9`
- `WRANGLER_VERSION=4.131.0`

The workflow still queries `npm view` as an informational diagnostic and records both registry-latest versions plus whether either differs from its pin. Every compatibility, initialization, build, development, migration, and Worker-runtime command uses the pins; registry discovery never selects the executable version.

## Non-destructive vinext initialization and builds

The final workflow creates a detached disposable Git worktree under `.tmp/cloudflare-proof`, based on the exact checked-out commit. Only that worktree receives:

```text
vinext@1.0.0-beta.9 init --skip-check --platform=cloudflare
```

The milestone branch is never initialized in place. The workflow records the initialized worktree commit, status, generated scripts, dependencies, and all created or modified files. It marks untracked generated files as intent-to-add solely so a binary-safe complete diff can be written to `vinext-init.patch`; it does not commit that generated migration.

The patch is the authoritative inventory of what vinext would change, including `package.json`, `package-lock.json`, Vite configuration, Wrangler configuration, scripts, and exact vinext dependencies. Those generated files are deliberately review artifacts rather than repository changes.

Inside the initialized worktree the workflow independently runs and records:

| Check | Final-validation status |
| --- | --- |
| Ordinary `npm run build` | Run again; must be **PASS** |
| Generated vinext production build | Must be **PASS**, with expected output directory detected |
| Generated vinext development server | Must return HTTP 200 for `/` on `127.0.0.1:4173` |

The server binds only to loopback, is terminated by a shell trap, and is not deployed. This smoke test covers the storage-independent shell; it does not assert that every Node-only route is Worker-compatible.

## Genuine local D1 Worker-binding proof

`scripts/cloudflare-proof-worker.ts` is a disposable integration Worker invoked by pinned Wrangler local development. Its tests receive the actual `env.DB` binding. They do not use `node:sqlite`, a mock, or the repository's compatibility fake.

After migrations 0001–0004 are applied to isolated local state, the Worker must establish all of these results:

- `D1Database.batch()` rollback: statement one inserts a valid disposable Personal task; statement two violates the Personal-to-Indelitech trigger; the expected rejection is caught; a query proves statement one's task does **not** survive.
- Indelitech → Indelitech visibility succeeds.
- Indelitech → Personal visibility succeeds.
- Personal → Personal visibility succeeds.
- Personal → Indelitech visibility fails.
- An invalid foreign workspace ID fails.
- Duplicate `(task_id, workspace_id)` visibility fails.
- Malformed `payload_json` fails `json_valid(payload_json)`.
- Changing `primary_workspace_id` fails through the immutability trigger.
- `series_id`, `recurrence_anchor_day`, and genuine `dependency` values round-trip; dependency is tested while recurrence is null.
- A date-only due value remains exactly `YYYY-MM-DD`.
- A task visible in Personal and Indelitech has exactly one underlying `tasks` row.

The same Worker imports and directly exercises the production `D1TaskRepository` and `D1WorkspaceDomainRepository`. It proves that repository creation in Indelitech is visible in both workspaces, a Personal update changes that same Indelitech-owned task, an Indelitech read observes the update, and equal domain record keys remain isolated between workspaces. A non-200 response or any missing `=PASS` assertion fails CI. Thus no raw-SQL surrogate is presented as repository proof.

## Read-only dependency security inventory

The preceding Actions run reported **3 vulnerabilities: 2 high and 1 critical**. Its retained milestone notes did not include the advisory package names, dependency paths, installed ranges, patched ranges, or `fixAvailable` details. Those details cannot responsibly be reconstructed from the aggregate, and the Codex npm proxy still returns HTTP 403 from the audit endpoint.

The final workflow therefore runs exactly `npm audit --json`, without `npm audit fix`, and uploads both the unmodified JSON report and a compact inventory containing:

- vulnerable package and severity;
- `isDirect` (direct versus transitive);
- installed dependency nodes/versions;
- npm's `fixAvailable` result, including a semver-major target when npm reports one;
- advisory/via data used to assess reachability.

Reachability and whether remediation is a hosted-deployment blocker must be decided from that captured package/advisory data. The workflow deliberately makes no speculative reachability claim and performs no unrelated upgrade. If the report identifies a straightforward required security patch, it is a blocker for the next implementation milestone before hosted deployment.

## Artifacts and safety boundary

The `cloudflare-proof` artifact includes the result text, complete compatibility output, initializer patch and file inventory, vinext build/dev logs, D1 semantic output and JSON response, Worker log, and npm audit JSON/summary. It contains no credentials.

No Cloudflare credential is required. The workflow has read-only repository permissions, an all-zero disposable database identifier, `--local` D1 state, and loopback-only servers. It contains no deployment, remote operation, authentication, production resource creation/write, Access configuration, secret write, Secrets Store write, or custom-domain step.

## Remaining blockers

The checked-in workflow is the executable final-validation specification, but its newly added vinext initialization/build/dev, batch rollback, complete constraint, repository-binding, and full audit-inventory steps have not yet produced an Actions artifact for this commit. They must all pass on GitHub Actions before the foundation decision can change. This is the precise blocker; a local SQLite substitute or an inferred result is not acceptable.

Even after a successful proof changes the decision to YES, that would authorize only the next user-facing Personal/Indelitech shell milestone. Production authentication, Cloudflare Access, secret-provider selection, scheduling, deployment, operational recovery, and public traffic remain later work.

**READY FOR HOSTED MVP FOUNDATION: NO**

# Milestone 1B-D: hosted integration proof — COMPLETE

Date: 2026-09-11
Branch: `milestone/1b-d-ci-proof`
Proof workflow: [`.github/workflows/cloudflare-proof.yml`](../.github/workflows/cloudflare-proof.yml)
Detailed CI procedure: [`MILESTONE-1B-D-CI-PROOF.md`](./MILESTONE-1B-D-CI-PROOF.md)

## Final decision

Milestone 1B-D completed successfully in GitHub Actions using the real Cloudflare local toolchain rather than mocks or `node:sqlite` substitutes for the hosted proof.

The final revalidation was run after dependency security remediation on commit `5a6713bf4da28241e5a5de12827507cab6aad3c7`.

| Check | Final result |
| --- | --- |
| Node | **24.19.0** |
| Existing test suite | **PASS — 232 tests** |
| Ordinary Next.js production build | **PASS** |
| vinext compatibility check | **PASS — 86% reported compatibility** |
| vinext version | **1.0.0-beta.9** |
| Wrangler version | **4.131.0** |
| Isolated vinext initialization | **PASS** |
| vinext production build | **PASS** |
| vinext loopback development smoke test | **PASS — HTTP 200** |
| Local D1 migrations 0001–0004 | **PASS** |
| Genuine `env.DB` Worker binding | **PASS** |
| `D1Database.batch()` rollback | **PASS** |
| D1 visibility/constraint semantics | **PASS** |
| `D1TaskRepository` real-binding proof | **PASS** |
| `D1WorkspaceDomainRepository` isolation proof | **PASS** |
| Read-only dependency audit capture | **PASS** |

## vinext findings

The pre-initialization compatibility scan reports 86% compatibility. All detected Next.js import categories are supported, the App Router is recognized, all route handlers are recognized, and `proxy.ts` is supported.

The scan reports two non-blocking findings:

- package-level `"type": "module"` is absent in the uninitialized application; `vinext init` adds it automatically in the disposable worktree;
- `reactStrictMode` is reported as partial support for App Router, where Next.js already defaults strict mode on.

The proof runs `vinext init --skip-check --platform=cloudflare` only inside a detached disposable worktree. It records the generated diff instead of changing the milestone branch in place. The initialized application then passes both the normal Next.js production build and the vinext production build, and serves `/` successfully in the vinext development runtime on loopback.

## Genuine local D1 proof

Pinned Wrangler applies migrations `0001` through `0004` to isolated local D1 state and launches a disposable Worker with the actual `env.DB` binding.

The real binding proves all required task semantics:

- a failing `D1Database.batch()` rolls back an earlier valid write;
- Indelitech → Indelitech visibility succeeds;
- Indelitech → Personal visibility succeeds;
- Personal → Personal visibility succeeds;
- Personal → Indelitech visibility is rejected;
- foreign workspace IDs are rejected;
- duplicate `(task_id, workspace_id)` visibility is rejected;
- malformed `payload_json` is rejected;
- `primary_workspace_id` is immutable;
- `series_id`, `recurrence_anchor_day`, and genuine `dependency` round-trip independently;
- date-only due values remain exact `YYYY-MM-DD` strings;
- a task visible in Personal and Indelitech still has one underlying `tasks` row.

The same Worker directly imports and exercises the production `D1TaskRepository` and `D1WorkspaceDomainRepository`. Cross-workspace task creation/update/read behavior and workspace-domain key isolation both pass against the genuine D1 binding.

## Dependency security remediation

The first successful full proof captured three npm audit findings:

- `next` 16.3.2 — **critical**, direct dependency;
- `js-yaml` 4.3.1 — **high**, transitive dependency;
- `sharp` 0.35.3 — **high**, transitive dependency.

Before milestone completion, the dependency set was deliberately patched and lockfile-regenerated in GitHub Actions:

- `next` → **16.3.3**;
- `eslint-config-next` → **16.3.3**;
- `js-yaml` override → **4.3.2**;
- `sharp` override → **0.35.4**.

The security-finalization run verified the exact lockfile versions, reported no remaining high or critical npm audit findings, and passed lint, all 232 tests, TypeScript, the ordinary production build, and the vinext compatibility check. The one-time write-enabled workflow used only to regenerate the lockfile was removed before merge.

The complete Cloudflare proof was then rerun on the patched milestone commit and passed end to end.

## Safety boundary

This milestone does **not** deploy anything. No Cloudflare credential is required. All D1 activity is local-only, the database identifier is disposable, servers bind only to loopback, and the workflow performs no `wrangler deploy`, `vinext deploy`, `--remote`, Cloudflare login, Access configuration, production D1 creation/write, Workers secret write, Secrets Store write, or custom-domain operation.

## What this authorizes next

The hosted execution/storage foundation is proven strongly enough to begin the user-facing MVP shell.

The next milestone may proceed with the Personal/Indelitech workspace experience, including workspace switching, workspace-aware themes, Today, Tasks, Calendar shell, and the 45-day horizon.

Production authentication, Cloudflare Access, secret-provider selection, scheduling/queues, production resource creation, deployment, operational recovery, and public traffic remain separate later milestones.

**READY FOR HOSTED MVP FOUNDATION: YES**

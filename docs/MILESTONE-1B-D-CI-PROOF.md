# Milestone 1B-D: GitHub Actions Cloudflare proof

## Purpose

`.github/workflows/cloudflare-proof.yml` is the credential-free, non-production final validation for the hosted foundation. GitHub Actions is used because the Codex npm proxy returns HTTP 403; package installation must not be retried locally as a substitute for the real run.

## Reproducibility and baseline

The job uses Node 24.19.0, vinext 1.0.0-beta.9, and Wrangler 4.131.0. `npm view` records current registry versions only to reveal drift; proof commands never float to those versions. Before adapter work, the job runs `npm ci`, lint, all 232 tests, TypeScript, and the ordinary Next.js production build.

The already-observed checker result is 86%. Its actionable findings are the missing package-level `"type": "module"` and partial support for `reactStrictMode`.

## Proof sequence

1. Create a detached worktree from the exact checkout under `.tmp/cloudflare-proof`.
2. Run pinned, non-interactive Cloudflare initialization only in that worktree.
3. Capture every generated/modified file and the full `package.json`/lock/configuration diff as `vinext-init.patch`.
4. Re-run the ordinary production build, then discover and run the initializer-generated vinext build script; require build output.
5. Discover and start the generated vinext development script on `127.0.0.1:4173`; require HTTP 200 from `/`; always stop it.
6. Create an all-zero-ID disposable Wrangler config and apply migrations 0001–0004 with `--local` and isolated persistence.
7. Start `scripts/cloudflare-proof-worker.ts` on `127.0.0.1:8789`. The Worker receives genuine `env.DB`, validates transactional rollback and every required D1 constraint, and calls both existing D1 repository implementations.
8. Run the read-only `npm audit --json`, preserve the original report, and derive a compact package-by-package inventory. No fix is run.
9. Upload logs, reports, patches, and inventories even if a later validation fails.

The Worker endpoint returns HTTP 500 with an assertion stack on failure. CI requires HTTP 200 and verifies every returned result ends in `=PASS`, so a started process alone cannot satisfy the proof.

## Result interpretation

`result.txt` records independent statuses for the ordinary build, vinext initialization, vinext build, vinext smoke, migrations, D1 semantics, and repository binding. The more detailed artifacts are authoritative for file changes and vulnerability data. A missing step remains `NOT_RUN`; it is never converted to PASS by a reporting-only step.

## Safety boundary

The workflow uses only local ephemeral resources and loopback listeners. It must never be extended with deployment commands, remote D1 flags, Cloudflare authentication, production resource creation or writes, Access changes, Workers secret writes, Secrets Store writes, or custom domains. No credentials or repository secrets are consumed.

The readiness decision and the distinction between “foundation proven” and “ready for public deployment” are maintained in [`MILESTONE-1B-D-HOSTED-INTEGRATION-PROOF.md`](./MILESTONE-1B-D-HOSTED-INTEGRATION-PROOF.md).

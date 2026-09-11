# Milestone 1B-D: GitHub Actions Cloudflare proof

## Why this proof runs in GitHub Actions

The Codex Cloud execution environment's npm registry proxy returned HTTP 403 while resolving both `vinext` and Wrangler. Retrying those downloads inside Codex would not establish compatibility. The diagnostic workflow therefore delegates the toolchain proof to an `ubuntu-latest` GitHub-hosted runner, where it can resolve the packages from the configured npm registry.

The workflow is intentionally non-production. It runs only for pushes to `milestone/1b-d-ci-proof` or by an explicit `workflow_dispatch`; it does not run for ordinary commits to `main`.

## What the workflow proves

The workflow first establishes the unchanged repository baseline on Node 24.19.0 by running the locked install, lint, tests, TypeScript check, and normal Next.js build. It prints the Node version, npm version, and npm registry.

It then:

1. resolves the currently available `vinext` and Wrangler versions with `npm view` and records the exact results;
2. invokes `vinext@<resolved-version> check` without initializing or deploying anything;
3. invokes `wrangler@<resolved-version> --version` without authentication;
4. creates a disposable Wrangler configuration containing the `DB` binding, logical database name `daily-command-center-ci`, and an all-zero, explicitly local/test-only placeholder database ID;
5. applies repository migrations `0001` through `0004` using Wrangler's local D1 migration mechanism and isolated state under `.tmp/cloudflare-proof`;
6. checks that the Personal and Indelitech seed workspaces exist, checks that `tasks`, `task_visibility`, `collector_snapshots`, `secret_metadata`, and `workspace_domain_records` exist, and confirms that the Personal-to-Indelitech visibility trigger rejects a disposable test row.

The full vinext compatibility output remains in the Actions log. A concise `result.txt` report is uploaded as the `cloudflare-proof-result` artifact even when a later diagnostic fails where GitHub Actions can continue to the reporting step.

## Interpreting the result

`PASS` means that the named command completed successfully on that particular GitHub-hosted run with the exact versions recorded in its report. `FAIL` means that the command ran and failed. `NOT_RUN` means an earlier prerequisite or baseline failure prevented the check, while `NOT_RESOLVED` means package version resolution did not complete. The enforcing step makes any non-successful compatibility, executable, migration, or verification result fail the job.

This workflow supplies a CI verdict only. Until the workflow runs after the branch is pushed, neither vinext compatibility nor actual local D1 behavior is claimed.

## Deliberate limits and safety boundary

This proof does **not** establish a production deployment, production readiness, remote D1 compatibility, Cloudflare Access configuration, hosted authentication, secret-provider integration, network behavior, or a reachable Workers application. It does not initialize vinext or modify application production code.

No Cloudflare credential or repository secret is required. Job permissions are read-only. Every D1 operation includes `--local` and uses disposable state; the configuration's all-zero database ID is not a real resource. The workflow never authenticates to Cloudflare and must not perform any deployment, remote D1 operation, Cloudflare login, Access change, Workers secret write, Secrets Store write, or production resource creation. In particular, `wrangler deploy`, `vinext deploy`, `@vinext/cloudflare deploy`, `wrangler login`, and the `--remote` flag are outside this workflow's safety boundary.

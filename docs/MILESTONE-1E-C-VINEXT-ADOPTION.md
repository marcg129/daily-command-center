# Milestone 1E-C — Adopt vinext alongside Next.js

## Goal

Make the repository genuinely buildable through Cloudflare's current recommended Next.js-on-Workers path while preserving the existing normal Next.js development/build path.

This milestone is tooling adoption and compatibility validation only. It is **not a production deployment milestone**.

Cloudflare currently recommends vinext for Next.js on Workers and documents `vinext init` as the non-destructive migration path for an existing Next.js 16 application.

## Baseline

Start from the current `main` branch after Milestone 1E-B.

Work on:

`milestone/1e-c-vinext-adoption`

Target PR:

`main`

## Version policy

Use the current npm `vinext` prerelease line already proven against this project:

`vinext@1.0.0-beta.9`

Do not silently downgrade to the older 0.x stable line.

Use versions selected by `vinext init` for its companion Vite/Cloudflare packages unless there is a concrete compatibility/security reason to pin differently.

After initialization, inspect the installed dependency tree and run a read-only audit. Do not run blind `npm audit fix`.

Do not introduce a known high/critical vulnerability merely to complete the migration. If the generated dependency graph contains a high/critical advisory, stop and report it with the affected package/version and available remediation rather than forcing the merge.

## Required setup flow

Use the actual vinext CLI from the repository root:

1. Run `npx --yes vinext@1.0.0-beta.9 check` and capture/report the compatibility result.
2. Run the non-destructive initializer for Cloudflare Workers. Prefer a non-interactive invocation if supported by the installed CLI; otherwise use the documented interactive defaults and select Cloudflare Workers.
3. Review every generated/modified file before committing.
4. Keep the existing Next.js path working.

The resulting repository should expose both:

- existing normal Next development/build;
- vinext development/build for Workers.

Expected script names are normally:

- `dev:vinext`
- `build:vinext`

If the current initializer chooses equivalent names, preserve its supported convention and document them.

## Preserve existing product/runtime boundaries

Do not rewrite application code merely to make the migration look cleaner.

Do not alter:

- workspace behavior;
- task semantics;
- structured capture contract;
- Cloudflare Access verification logic;
- D1 repository semantics;
- local SQLite persistence;
- the production guard on the legacy local `/api/tasks/capture` route.

Do not remove Next.js or replace the normal `next dev` / `next build` path in this milestone.

## Cloudflare configuration

Allow `vinext init` to create the supported Workers/Vite configuration it needs.

However, do **not** add real production resources yet:

- no real D1 database ID;
- no Cloudflare Access application configuration;
- no service token;
- no account ID;
- no API token;
- no production custom domain;
- no secrets.

If the initializer creates a Wrangler config, keep it deployment-safe. Do not invent a production D1 binding or fake credentials.

Do not add the hosted capture route that imports `env.DB` yet. That belongs after a real D1 resource/binding is deliberately created.

## Generated types

If the initializer generates Worker binding types, commit only what the supported toolchain expects to be source-controlled.

Do not hand-invent production binding types for resources that do not exist yet.

## Compatibility validation

The migration must prove both toolchains still work.

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- vinext compatibility check
- `npm run build:vinext` (or initializer-equivalent script)
- existing `npm run smoke`
- `git diff --check`

Also start the vinext development runtime locally on loopback and perform a basic HTTP smoke against `/` if feasible in the Codex environment.

Do not deploy.

## Existing Cloudflare proof workflow

The historical `.github/workflows/cloudflare-proof.yml` was created when vinext was not committed and therefore initializes vinext in an isolated worktree.

Do not blindly keep that logic forever once vinext is source-controlled.

For this milestone, update the proof workflow only if necessary so it remains truthful and does not run a second conflicting initializer. Prefer a small change that validates the committed vinext build rather than re-initializing the repository.

Do not change it into a deployment workflow.

Preserve the genuine local D1 proof and migrations 0001–0006.

## Security checks

After dependency changes:

- run `npm audit --json` or equivalent read-only inventory;
- report any high/critical findings;
- verify `vinext@1.0.0-beta.9` is the installed vinext version;
- do not use `npm audit fix --force`;
- do not loosen existing Next/js-yaml/sharp security pins without a specific reason.

## Tests

Do not add tests merely to assert generated config text unless there is meaningful application behavior to protect.

All existing tests must remain green.

If a tiny regression test is needed because vinext initialization changes module/runtime behavior, add only the focused test required.

## Deliverable

Commit the complete migration to `milestone/1e-c-vinext-adoption` and update the existing draft PR.

Return a concise report containing:

1. vinext compatibility percentage/findings;
2. files generated/modified by `vinext init`;
3. exact vinext/Vite/Cloudflare package versions installed;
4. normal Next build result;
5. vinext production build result;
6. vinext dev smoke result;
7. existing test/smoke result;
8. read-only audit high/critical count and details, if any;
9. anything that must remain manual before real Cloudflare deployment.

## Explicitly deferred

Do not implement in 1E-C:

- production D1 creation/binding;
- `cloudflare:workers` hosted task route;
- production workspace grant seeding;
- Cloudflare Access app creation;
- Access policy creation;
- service-token creation;
- real `TEAM_DOMAIN` / `POLICY_AUD` values;
- production deploy;
- custom domain;
- natural-language AI task extraction;
- Telegram/notification delivery;
- Google Calendar sync.

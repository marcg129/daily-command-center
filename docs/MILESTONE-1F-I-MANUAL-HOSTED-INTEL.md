# Milestone 1F-I — Manual Hosted Intel Run

## Goal

Allow the repository owner to populate the production Indelitech Intel snapshot on demand without exposing a production refresh endpoint, changing the production cron schedule, or creating a second collector implementation.

## Operator flow

Use GitHub Actions → **Run Hosted Intel Now** → **Run workflow** on `main`.

The workflow is deliberately `workflow_dispatch` only and the collection job runs only when:

- the actor is the repository owner;
- the selected ref is `main`;
- the dispatched SHA is still the exact current `origin/main` revision when the job starts.

If `main` moves after dispatch, the job fails closed and must be run again.

## Runtime design

The workflow:

1. Checks out the exact dispatched `main` SHA.
2. Requires the existing Cloudflare CI credentials.
3. Validates Cloudflare authentication.
4. Reads the committed `wrangler.intel.jsonc` posture and rejects unexpected Worker entry, exposure, or D1 binding changes.
5. Creates an ephemeral Wrangler configuration inside the Actions checkout.
6. Changes only the `DB` binding to `remote: true` and removes automatic cron triggers from the ephemeral config.
7. Starts `wrangler dev --test-scheduled` bound only to `127.0.0.1`.
8. Sends exactly one request to Wrangler's local scheduled-event testing route with an explicit scheduled timestamp and the production cron expression.
9. Stops the ephemeral dev process and removes the temporary configuration.
10. Reads the production D1 `indelitech` / `industry` snapshot back using `wrangler d1 execute --remote`.
11. Requires the D1 `checked_at` value to exactly match the timestamp of this manual invocation.
12. Writes source health, discovery count, surfaced-item count, source-error count, and collector state to the GitHub Actions step summary.

## Security boundaries

The production `daily-command-center-intel` Worker remains cron-only:

- no `fetch()` handler is added;
- `workers_dev` remains disabled;
- preview URLs remain disabled;
- no public or Access-protected refresh route is introduced;
- no cron trigger is modified in production;
- no new secret is added;
- no user-controlled source URL is added;
- no local SQLite or Settings dependency is added;
- no deployment occurs from the manual refresh workflow.

The localhost scheduled-test route exists only inside the ephemeral GitHub-hosted runner process. The Worker code executes locally while the single D1 binding is proxied to the existing production D1 database through Cloudflare remote bindings.

## Failure behavior

The existing 1F-H collector behavior remains authoritative. If every fixed Intel source fails, collection throws before the D1 write and the previous good snapshot remains intact. The manual workflow then fails because it cannot read back a snapshot with its exact scheduled timestamp.

A partial-source run is allowed. The resulting snapshot retains explicit degraded/source-error state and the Actions summary reports it.

## Validation

- static tests require dispatch-only, owner-only, current-main gating;
- static tests require the ephemeral remote D1 binding and loopback-only scheduled runner;
- static tests forbid `wrangler deploy` / `deploy:intel` in the manual workflow;
- static tests require exact timestamp read-back from production D1;
- normal repository Check runs on Ubuntu, macOS, and Windows before merge.

## Out of scope

- an in-app Refresh Intel button;
- a public or authenticated HTTP refresh endpoint;
- changing the six-hour production schedule;
- hosted Settings for Intel sources;
- AI curation or new third-party credentials.

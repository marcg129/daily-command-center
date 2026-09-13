# Milestone 1E-G — First protected Cloudflare deployment

## Goal

Create the first real Cloudflare-hosted Daily Command Center without ever exposing the dashboard publicly before Cloudflare Access is attached.

This milestone provisions the minimum production resources, applies the D1 schema, deploys the Worker privately, enables Cloudflare Access, grants the first principal explicit workspace access, then enables the protected workers.dev URL.

## Cost posture

Start on Cloudflare's free tiers. Do not upgrade to Workers Paid during this milestone unless the deployed vinext application demonstrably hits a Free-plan CPU/platform limit that prevents ordinary task use.

## Resource names

Use stable, non-secret names:

- Worker: `daily-command-center`
- D1 database: `daily-command-center-prod`
- D1 binding: `DB`
- KV namespace: `daily-command-center-vinext-cache`
- KV binding: `VINEXT_KV_CACHE`

The D1 database ID, KV namespace ID, Access team domain, and Access application AUD are configuration values, not credentials. Never commit Access cookies, JWTs, API tokens, service-token secrets, or Cloudflare account credentials.

## Security invariant

The first Worker upload must not create a public production or preview URL.

Until Access is attached:

- `workers_dev` must remain `false`.
- `preview_urls` must remain `false`.
- `POLICY_AUD` must be absent rather than guessed.
- no custom domain or public Worker route may be added.

After Access is configured and its real AUD is committed, `workers_dev` may be enabled while `preview_urls` remains disabled unless a later milestone explicitly protects and enables previews.

## Phase A — Cloudflare resources

1. Enable Cloudflare Zero Trust on the account if it is not already enabled.
2. Create D1 database `daily-command-center-prod`. Prefer the Eastern North America location hint for this deployment.
3. Create KV namespace `daily-command-center-vinext-cache`.
4. Record:
   - D1 database ID
   - KV namespace ID
   - Zero Trust team domain in canonical form: `https://<team>.cloudflareaccess.com`
5. Store deployment credentials only as GitHub Actions repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

Do not create a service token yet. Browser identity is the first supported principal.

## Phase B — Repository production bindings

Bind the real D1 database, vinext KV namespace, and Access team domain while leaving the Access application audience absent:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "daily-command-center-prod",
    "database_id": "<d1-database-id>"
  }
],
"kv_namespaces": [
  {
    "binding": "VINEXT_KV_CACHE",
    "id": "<kv-namespace-id>"
  }
],
"vars": {
  "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com"
}
```

Do not add a placeholder `POLICY_AUD`. The Worker is intentionally unreachable during bootstrap, and the application must remain unable to validate hosted requests until the real Access application exists.

## Phase C — Apply schema and bootstrap-upload Worker

The manual-only GitHub Actions workflow `Cloudflare bootstrap deploy (private)` performs this phase from the default branch.

Before the Worker is reachable it must:

1. Verify the Cloudflare GitHub secrets are present and valid.
2. Verify the committed bootstrap config is fail-closed.
3. Apply migrations 0001–0006 to the remote D1 database.
4. Build the committed vinext production path.
5. Re-check the generated Worker config.
6. Deploy the Worker with `workers_dev=false`, `preview_urls=false`, and no `POLICY_AUD`.
7. Confirm the Worker upload completed without enabling a public production or preview route.

A migration, build, config-verification, authentication, or upload failure stops the milestone. Do not deploy against a partially migrated database.

## Phase D — Attach Cloudflare Access

In Workers & Pages, open the `daily-command-center` Worker and protect the Worker with Cloudflare Access.

Requirements:

- protect production access before enabling `workers.dev`;
- use an Allow policy scoped to the intended user's exact email for the first deployment;
- do not use a broad `Everyone` Allow rule;
- leave previews disabled;
- record the Access application Audience (AUD) tag.

Update `POLICY_AUD` in `wrangler.jsonc` to that real AUD only after the Access application exists.

## Phase E — Enable protected workers.dev

Only after Phase D:

1. Set `workers_dev` to `true`.
2. Keep `preview_urls` false.
3. Set `POLICY_AUD` to the real Access application AUD.
4. Rebuild and redeploy.
5. Open the workers.dev URL in a private/incognito browser session and confirm Cloudflare Access requires authentication before the application loads.

If an unauthenticated browser can load the application, immediately disable `workers.dev` and stop.

## Phase F — Bootstrap the first D1 workspace grants

After signing in through Access, visit the application-owned authenticated enrollment endpoint:

`https://<worker-host>/api/hosted/session`

That endpoint verifies the signed Cloudflare Access application assertion with the same production verifier used by the hosted task routes and returns only:

- `principalId`
- `expiresAt`

It never returns the assertion, session ID, email, identity-provider claims, or a workspace grant.

Record the returned `principalId`, which will have the form:

`cf-user:<stable-access-subject>`

> **Superseded by Milestone 1G-A:** migration `0007_user_workspace_ownership.sql`
> replaces direct principal grants with durable users, principal mappings, and
> workspace memberships. Use the **Cloudflare bootstrap workspace grants**
> workflow with this verified principal. Do not insert into the removed
> `principal_workspace_grants` table. The workflow is idempotent and verifies
> the resulting Personal and Indelitech `OWNER` memberships.

## Phase G — Acceptance test

The milestone is complete only when all of the following are true:

1. Unauthenticated access is intercepted by Cloudflare Access.
2. Authenticated access loads the hosted task UI.
3. `/api/hosted/session` returns the verified stable principal without exposing sensitive identity material.
4. Personal workspace loads from D1.
5. Indelitech workspace loads from D1.
6. Creating a Personal task persists after refresh.
7. Creating an Indelitech task appears in Indelitech and rolls up to Personal.
8. Editing/completing the rolled-up task mutates the same record.
9. Legacy local-only APIs remain unavailable remotely.
10. Localhost SQLite behavior remains unchanged.
11. No secrets or Access assertions are committed to Git.

## Out of scope

- Custom domain
- Service-token automation
- Hosted Settings/Intel/Mentions persistence
- Public task-capture API
- Paid Workers upgrade unless Free-plan limits block the acceptance test

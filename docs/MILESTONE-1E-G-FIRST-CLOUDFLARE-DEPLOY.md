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
- no custom domain or public Worker route may be added.

After Access is configured and its AUD is committed, `workers_dev` may be enabled while `preview_urls` remains disabled unless a later milestone explicitly protects and enables previews.

## Phase A — Cloudflare resources

1. Enable Cloudflare Zero Trust on the account if it is not already enabled.
2. Create D1 database `daily-command-center-prod`. Prefer the Eastern North America location hint for this deployment.
3. Create KV namespace `daily-command-center-vinext-cache`.
4. Record:
   - D1 database ID
   - KV namespace ID
   - Zero Trust team domain in canonical form: `https://<team>.cloudflareaccess.com`

Do not create a service token yet. Browser identity is the first supported principal.

## Phase B — Repository production bindings

Replace the vinext KV placeholder and add:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "daily-command-center-prod",
    "database_id": "<d1-database-id>"
  }
],
"vars": {
  "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
  "POLICY_AUD": "bootstrap-disabled"
}
```

`bootstrap-disabled` is permitted only for the inaccessible bootstrap upload. It must be replaced by the real Access application AUD before `workers_dev` is enabled.

## Phase C — Apply schema and bootstrap-upload Worker

Before the Worker is reachable:

1. Apply migrations 0001–0006 to the remote D1 database.
2. Build the committed vinext production path.
3. Deploy the Worker with `workers_dev=false` and `preview_urls=false`.
4. Confirm the Worker exists in Cloudflare but has no public production or preview route.

A migration failure stops the milestone. Do not deploy against a partially migrated database.

## Phase D — Attach Cloudflare Access

In Workers & Pages, open the `daily-command-center` Worker and protect the Worker with Cloudflare Access.

Requirements:

- protect production access before enabling `workers.dev`;
- use an Allow policy scoped to the intended user's exact email for the first deployment;
- do not use a broad `Everyone` Allow rule;
- leave previews disabled;
- record the Access application Audience (AUD) tag.

Update `POLICY_AUD` in `wrangler.jsonc` to that real AUD.

## Phase E — Enable protected workers.dev

Only after Phase D:

1. Set `workers_dev` to `true`.
2. Keep `preview_urls` false.
3. Rebuild and redeploy.
4. Open the workers.dev URL in a private/incognito browser session and confirm Cloudflare Access requires authentication before the application loads.

If an unauthenticated browser can load the application, immediately disable `workers.dev` and stop.

## Phase F — Bootstrap the first D1 workspace grants

After signing in through Access, visit:

`https://<worker-host>/cdn-cgi/access/get-identity`

Record only the authenticated user's `user_uuid` value. Do not copy authentication cookies or JWTs.

The application principal ID for an identity-authenticated Access user is:

`cf-user:<user_uuid>`

Insert explicit grants for that principal:

```sql
INSERT INTO principal_workspace_grants (principal_id, workspace_id)
VALUES ('cf-user:<user_uuid>', 'personal');

INSERT INTO principal_workspace_grants (principal_id, workspace_id)
VALUES ('cf-user:<user_uuid>', 'indelitech');
```

Use the remote D1 database. Duplicate grants should not be added blindly; verify existing rows first if retrying.

## Phase G — Acceptance test

The milestone is complete only when all of the following are true:

1. Unauthenticated access is intercepted by Cloudflare Access.
2. Authenticated access loads the hosted task UI.
3. Personal workspace loads from D1.
4. Indelitech workspace loads from D1.
5. Creating a Personal task persists after refresh.
6. Creating an Indelitech task appears in Indelitech and rolls up to Personal.
7. Editing/completing the rolled-up task mutates the same record.
8. Legacy local-only APIs remain unavailable remotely.
9. Localhost SQLite behavior remains unchanged.
10. No secrets or Access assertions are committed to Git.

## Out of scope

- Custom domain
- Service-token automation
- GitHub Actions production deployment credentials
- Hosted Settings/Intel/Mentions persistence
- Public task-capture API
- Paid Workers upgrade unless Free-plan limits block the acceptance test

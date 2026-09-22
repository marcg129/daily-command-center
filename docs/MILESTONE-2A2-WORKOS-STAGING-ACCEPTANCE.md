# Milestone 2A2e — WorkOS staging acceptance

Date: 2026-09-21

Status: **Ready for external WorkOS staging configuration. Production Cloudflare Access remains in front.**

## Purpose

This is the controlled bridge between the already-deployed AuthKit code and the first real browser acceptance test.

The goal is to prove the WorkOS path without changing DCC authorization and without exposing the customer-facing site before identity linking and isolation checks pass.

## Current safe boundary

Already merged and deployed:

- provider-neutral application users and workspace authorization;
- private Personal auto-provisioning;
- WorkOS/AuthKit session verification;
- AuthKit start/callback/refresh/sign-out browser flow;
- refresh-aware hosted requests;
- origin-wide Web Locks coordination for rotating refresh tokens;
- dual-proof WorkOS principal linking into an existing DCC user;
- Cloudflare Access remains the outer production gate.

WorkOS is dormant until its bindings are configured.

## WorkOS staging setup

Use the WorkOS **Staging** environment, not Production.

In the WorkOS Dashboard:

1. Open the Staging environment.
2. Open **Applications** and use the default web application.
3. Record its **Client ID**.
4. Add this exact redirect URI:
   `https://command.coreyg.dev/api/auth/workos/callback`
5. Under Authentication, enable **Magic Auth** for the first acceptance pass.
6. Obtain the Staging API key. It must begin with `sk_test_`. The verifier intentionally rejects `sk_live_...` production keys.
7. Do not place the API key in Git, Wrangler `vars`, screenshots, or issue comments.

WorkOS references:

- https://workos.com/docs/authkit/environments
- https://workos.com/docs/authkit/applications
- https://workos.com/docs/authkit/magic-auth
- https://workos.com/docs/authkit/sessions
- https://workos.com/docs/reference/api-authentication

## DCC binding contract

For the Staging acceptance pass:

- `WORKOS_CLIENT_ID=<staging client id>`
- `WORKOS_API_KEY=<staging sk_test_... API key; secret>`
- `WORKOS_REDIRECT_URI=https://command.coreyg.dev/api/auth/workos/callback`
- `WORKOS_ISSUER=https://api.workos.com/user_management/<staging client id>`
- `WORKOS_JWKS_URL=https://api.workos.com/sso/jwks/<staging client id>`

The repository helper validates this contract without making a network request and never prints the API key:

`npm run auth:workos:verify`

### PowerShell example

Set the five values only in the current shell, run the verifier, then close the shell or remove the variables.

```powershell
$env:WORKOS_CLIENT_ID="client_..."
$env:WORKOS_API_KEY="sk_test_..."
$env:WORKOS_REDIRECT_URI="https://command.coreyg.dev/api/auth/workos/callback"
$env:WORKOS_ISSUER="https://api.workos.com/user_management/$($env:WORKOS_CLIENT_ID)"
$env:WORKOS_JWKS_URL="https://api.workos.com/sso/jwks/$($env:WORKOS_CLIENT_ID)"
npm run auth:workos:verify
```

## Cloudflare secret boundary

`WORKOS_API_KEY` is sensitive and must be stored as an encrypted Cloudflare Worker secret on `daily-command-center`.

Cloudflare documents that Wrangler deploys do not delete encrypted Worker secrets unless a secret is explicitly deleted. Public variables, by contrast, should be kept in the Wrangler configuration as the deployment source of truth.

Do **not** add `WORKOS_API_KEY` as a plaintext Wrangler variable.

After the staging API key is installed as a Cloudflare secret, the activation PR should:

1. add the four non-secret WorkOS values to `wrangler.jsonc`;
2. declare `WORKOS_API_KEY` under Wrangler required secrets so deployment fails closed if it is missing;
3. extend the protected deploy config checks to verify the non-secret WorkOS bindings;
4. build, review, merge, and deploy through the existing protected path.

References:

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/

## First real-browser acceptance

Cloudflare Access stays enabled during this test.

### A. Establish WorkOS session

While already signed into DCC through Cloudflare Access, open:

`https://command.coreyg.dev/api/auth/workos/start?returnTo=/`

Complete Magic Auth in the WorkOS-hosted flow. Successful callback should return to DCC with secure WorkOS access and refresh cookies.

### B. Link Marc's WorkOS principal to the existing DCC user

Do **not** let Marc's first WorkOS identity auto-provision a second user.

With both the Cloudflare Access session and WorkOS cookies present, run this once from the DCC browser console:

```js
await fetch("/api/auth/workos/link", {
  method: "POST",
  cache: "no-store",
}).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}))
```

Acceptance requires HTTP 200 with `linked: true`, the existing durable DCC user, and the existing authorized Personal + Indelitech workspace set.

A conflict, missing Personal OWNER boundary, missing Cloudflare proof, missing WorkOS proof, or an already-linked WorkOS principal belonging to another user must fail closed.

### C. Prove the real hosted browser wrapper under WorkOS identity

Normal DCC browser traffic intentionally remains Cloudflare-first during migration. For acceptance only, the production browser runtime can opt one tab into WorkOS application identity while Cloudflare Access remains the outer gate.

In the browser console, enable the tab-scoped acceptance flag and reload:

```js
sessionStorage.setItem("dcc-workos-acceptance-provider", "workos");
location.reload();
```

This does **not** create a second refresh implementation. The existing `fetchHostedWithSessionRefresh` wrapper reads the flag and adds:

`x-dcc-auth-provider: workos`

to its protected request, lock re-check, and post-refresh retry. The refresh request itself still uses the normal HttpOnly refresh cookie.

The server selector remains fail-closed and migration-scoped:

- Cloudflare Access must already have admitted the request and supplied its assertion;
- DCC ignores that assertion only for application identity on the selected request;
- the HttpOnly WorkOS access cookie is required;
- the WorkOS token goes through the normal WorkOS verifier and DCC user/workspace authorization;
- missing Access proof or missing WorkOS cookie is unauthenticated;
- after Cloudflare Access is removed, the selector is inert because its outer proof is absent.

After reload, the normal DCC identity bootstrap and hosted workspace loading now exercise the real refresh-aware browser path under Marc's linked WorkOS principal.

Acceptance requires the app to load with Marc's existing durable DCC user and existing Personal + Indelitech workspace set. A normal hosted task edit/save in this tab should also succeed through the same wrapper.

For additional protected APIs that are not yet routed through the shared browser wrapper, a direct selector request may still be used for authorization/isolation evidence:

```js
const workosFetch = (path, init = {}) =>
  fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.headers || {}),
      "x-dcc-auth-provider": "workos",
    },
  });
```

Do not use that direct helper as evidence for refresh-token race handling; it intentionally bypasses the browser refresh wrapper.

To return the tab to the ordinary Cloudflare-first migration path:

```js
sessionStorage.removeItem("dcc-workos-acceptance-provider");
location.reload();
```

### D. WorkOS session/refresh acceptance

Verify:

- AuthKit callback establishes secure WorkOS access/refresh cookies;
- with the acceptance flag enabled, protected bootstrap/workspace/task requests traverse `fetchHostedWithSessionRefresh` under WorkOS identity;
- for the real cross-tab test, enable the acceptance flag in **two tabs** using the same WorkOS session and keep both tabs open through an access-token expiry; when both tabs next issue hosted wrapper requests, only one refresh-token rotation succeeds and the waiting tab observes the rotated browser-wide session through the Web Locks re-check;
- a transient refresh failure does not destroy the session;
- a confirmed terminal refresh failure clears invalid WorkOS credentials;
- sign-out clears WorkOS access/refresh cookies;
- Cloudflare Access still protects the outer site during the migration window.

The automated regression suite already covers same-document deduplication and Web Locks ordering; this browser pass proves that the migration selector actually reaches that same runtime path before cutover.

### E. New-user acceptance

Only after Marc's existing-user link is proven:

1. sign out of WorkOS without ending the outer Cloudflare Access session;
2. authenticate a separate WorkOS human identity;
3. enable `dcc-workos-acceptance-provider=workos` in that tab's sessionStorage and reload so DCC resolves its normal hosted bootstrap from the WorkOS principal rather than the Access assertion;
4. confirm first WorkOS resolution creates exactly one private Personal workspace;
5. confirm it receives no Indelitech membership;
6. use the wrapper-backed UI paths plus WorkOS-selected direct requests where needed to verify cross-user reads fail closed for Tasks, Intake, Calendar, Bills, Income, Cash Flow, and Intel.

The Cloudflare assertion in this phase is only the temporary outer admission gate. The application user, provisioning decision, memberships, and protected-resource authorization are derived from the verified WorkOS principal.

## Cutover remains blocked until acceptance passes

Do not remove Cloudflare Access from the customer-facing path merely because WorkOS login succeeds.

Cutover requires recorded evidence that:

- Marc maps to the existing DCC user;
- a new WorkOS user gets only a private Personal workspace;
- cross-user authorization remains fail-closed;
- disabled/corrupt users remain fail-closed;
- sign-out/revocation prevents future WorkOS access.

After that, Cloudflare Access can move to an admin/staging/rollback surface and normal customer traffic can use AuthKit directly.

# Milestone 2A2 — Product authentication provider spike

Date: 2026-09-18

Status: **AuthKit adapter + browser flow deployed; dual-provider code complete; WorkOS staging acceptance configuration is the active boundary.**

## Decision

Use **WorkOS AuthKit** as DCC's customer-facing authentication provider, behind DCC's existing application-user and workspace authorization model.

Clerk is the fallback if AuthKit proves incompatible with the deployed Cloudflare/vinext runtime during the implementation spike.

## Why WorkOS fits DCC

DCC needs authentication, not another authorization system. The provider must prove a human identity and manage secure login/session recovery while DCC remains authoritative for users, memberships, and physical workspace boundaries.

AuthKit currently provides:

- Google social login;
- passwordless six-digit email codes (Magic Auth);
- hosted sign-in UI and account/recovery flows;
- server-side sessions with access + rotating refresh tokens;
- verified-email identity linking across authentication methods;
- a stable WorkOS user subject suitable for mapping into `user_principals`;
- a free AuthKit user-management tier up to 1,000,000 active users; production requires billing information even when usage remains free.

Enterprise SSO is separately priced and is not required for the family pilot or initial DCC product path.

## Alternatives considered

### Clerk

Strong second choice. It has excellent Next.js ergonomics and a backend SDK explicitly designed for Node/V8 isolates including Cloudflare Workers. Its current Hobby tier supports up to 50,000 monthly retained users and includes social login/email codes, but the free tier retains Clerk branding and a fixed seven-day session lifetime, and paid user overages are materially higher than WorkOS at larger scale.

### Supabase Auth

Technically viable and inexpensive, with Google/social auth and SSR cookie support. It would add a second database/platform primarily to obtain authentication, the free project can pause after inactivity, and production operation would likely push DCC toward a paid Supabase project even though D1 remains the real application database. That is avoidable operational coupling.

### Auth0

Mature and capable, but DCC does not currently need the additional platform complexity or the pricing profile. The free tier is useful for a prototype, but paid tiers become relevant much earlier than WorkOS for DCC's intended path.

### Firebase Authentication

Capable and inexpensive at moderate scale, but it is a less natural fit for DCC's server-first Cloudflare architecture and would increase Google platform coupling immediately before DCC separately adds Google Workspace integration credentials.

## Authentication methods for the pilot

Enable:

1. **Google OAuth** for the simplest familiar login.
2. **Magic Auth email code** as the provider-independent fallback.

Do not require passwords for the initial pilot. Passwordless email ownership plus Google login reduces password-reset/support surface while still allowing a user to recover access without their Google credential.

## Critical separation: login vs Google integration

WorkOS Google login is used only to prove identity with basic authentication/profile scopes.

DCC **must not** use WorkOS social-login OAuth tokens as the future Gmail/Calendar integration credential. Milestone 2A3/2A5 will create a separate DCC-owned Google OAuth connection with the exact Gmail/Calendar scopes, its own consent lifecycle, revocation state, encrypted refresh token, and health metadata.

This preserves:

- least privilege;
- the ability to sign in with one identity and connect a different Google account;
- clean revocation of Gmail/Calendar without signing the user out of DCC;
- provider independence if DCC changes authentication vendors later.

## Identity mapping

The trusted WorkOS user subject will become a provider-scoped DCC principal such as:

`workos-user:<stable-workos-user-id>`

That principal maps through `user_principals` to a durable DCC `user_id`.

Never use the WorkOS user ID as a workspace ID. Never use WorkOS organizations, roles, or permissions as DCC workspace authorization.

## Cloudflare cutover rule

Cloudflare Access remains in front of the current production owner path until the AuthKit path passes automated isolation tests and a controlled real-browser acceptance test.

The customer-facing production hostname cannot remain globally gated by Cloudflare Access after AuthKit becomes the login system. At cutover:

- remove/bypass the customer-facing Cloudflare Access gate for normal DCC routes;
- retain Cloudflare Access only for a separate admin/staging/rollback surface where useful;
- keep application authorization enforced inside DCC on every protected resource.

No family user should need a Cloudflare account or Cloudflare Access enrollment.

## Implementation sequence

### 2A2a — Request authentication seam

Remove direct `cf-access-jwt-assertion` parsing from individual hosted handlers. Route request credentials through one adapter while preserving the current Cloudflare behavior exactly.

### 2A2b — WorkOS session verifier

Add a WorkOS-backed `SessionProvider` using DCC's existing `jose` dependency and WorkOS JWKS. Validate signature, issuer, expiry, required session/user claims, and the expected WorkOS client ID. Map only verified human sessions to `workos-user:*`.

### 2A2c — Hosted AuthKit browser flow ✅

Merged and deployed. DCC now has sign-in, callback, rotating refresh/session-cookie, sign-out, exact hosted proxy routing, and refresh-aware protected browser requests. WorkOS remains dormant until bindings are configured.

Refresh-token rotation has one additional safety invariant: only one same-origin browser context may rotate the AuthKit refresh token at a time. DCC uses the Web Locks API for cross-tab/worker coordination. After a caller acquires the lock it re-checks the protected request before refreshing, so a tab that waited for another tab's successful rotation observes the new browser-wide cookies and skips its own refresh. Confirmed terminal refresh failures may therefore clear invalid credentials without allowing a stale losing tab to erase a newer session. A product browser without Web Locks fails closed rather than falling back to unsafe tab-local rotation.

### 2A2d — Dual-provider acceptance and cutover

The dual-proof identity-link operation is merged and deployed. An existing Cloudflare-authenticated DCC user must explicitly link a separately verified WorkOS human principal to the same durable `user_id`. The link operation never auto-provisions, creates workspaces, or changes memberships; conflicts fail closed.

### 2A2e — WorkOS staging acceptance readiness

Repository-side staging acceptance support is prepared in `docs/MILESTONE-2A2-WORKOS-STAGING-ACCEPTANCE.md`. The remaining activation boundary is external WorkOS Staging configuration plus the encrypted Cloudflare `WORKOS_API_KEY` secret. Production Cloudflare Access remains in front until real-browser linking and isolation acceptance pass.

Before enabling WorkOS credentials, add a dual-proof identity-link operation. An existing Cloudflare-authenticated DCC user must explicitly link a separately verified WorkOS human principal to the same durable `user_id`. The link operation never auto-provisions, creates workspaces, or changes memberships; conflicts fail closed.

This prevents Marc's first WorkOS login from creating a second DCC user/Personal workspace and provides a provider-migration path without manual D1 edits.

Then run Cloudflare + WorkOS in parallel long enough to prove:

- Marc retains Personal + Indelitech;
- a new WorkOS identity gets only its private Personal workspace;
- cross-user reads fail closed across Tasks, Intake, Calendar, Bills, Income, Cash Flow, and Intel;
- disabled/corrupt users remain fail-closed;
- sign-out/revocation actually removes future access.

Then remove Cloudflare Access from the customer-facing path.

## External references used for this spike

- https://workos.com/pricing
- https://workos.com/docs/authkit/overview
- https://workos.com/docs/authkit/magic-auth
- https://workos.com/docs/authkit/social-login
- https://workos.com/docs/authkit/identity-linking
- https://workos.com/docs/authkit/sessions
- https://clerk.com/pricing
- https://clerk.com/docs/guides/development/sdk-development/backend-only
- https://supabase.com/pricing
- https://auth0.com/pricing
- https://firebase.google.com/pricing

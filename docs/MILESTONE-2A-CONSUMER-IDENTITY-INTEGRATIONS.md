# Milestone 2A — Consumer-ready identity, provisioning, and integrations

Date: 2026-09-18

Branch: `milestone/2a-multi-user-saas-foundation`

Status: **Active.**

## Goal

Turn Daily Command Center from a single-owner hosted dashboard with multi-user foundations into a product-shaped multi-user service that a nontechnical user can join with one normal sign-in, receive a private Personal workspace automatically, connect supported accounts from inside DCC, and receive future application updates without setting up Cloudflare, Todoist, GitHub, API keys, or infrastructure.

The near-term pilot users are family members, but the architecture must remain suitable for later multi-user/commercial operation.

## Product experience target

A new user should be able to:

1. open an invitation or DCC sign-in page;
2. sign in with a familiar identity method;
3. receive a private Personal workspace automatically;
4. connect Google from inside DCC;
5. choose simple automation/preferences;
6. see Tasks, Intake, Calendar, and source health;
7. optionally connect ChatGPT as another client when the platform supports it.

No customer-facing Cloudflare account, Todoist account, GitHub account, infrastructure credentials, or manual database provisioning is part of the target experience.

## Architecture rules

1. DCC application users are durable and independent from any authentication vendor.
2. Every user receives a private physical Personal workspace; the browser continues using the logical key `personal`.
3. Authentication providers prove identity but do not define authorization. DCC workspace memberships remain authoritative.
4. External integrations belong to a DCC user and are authorized independently of browser authentication.
5. DCC owns recurring collection schedules and reminders. ChatGPT Automations are not a product dependency.
6. Todoist remains a temporary/fallback relay during migration, not a required customer dependency.
7. ChatGPT is an optional DCC client, not the system of record or required scheduler.
8. Secrets and refresh tokens stay server-side, encrypted at rest, and are never returned to the browser.
9. Private Personal data is isolated by default. Sharing is explicit and deferred to a later milestone.
10. One hosted production deployment serves all users, so product updates do not require user-side upgrades.

## Delivery slices

### 2A1 — Safe private-user provisioning

Replace the legacy owner bootstrap assumption with provider-neutral application provisioning.

- An authenticated but previously unknown principal can be mapped to a new durable DCC user.
- Provisioning creates exactly one new physical Personal workspace and one OWNER membership.
- Provisioning never grants Indelitech automatically.
- Repeated provisioning of the same external identity is idempotent.
- Disabled, corrupted, or ambiguously mapped identities fail closed.
- Physical workspace IDs remain server-side and opaque.
- Existing Marc Personal/Indelitech data and roll-up behavior remain unchanged.

During the family pilot, Cloudflare Access may continue serving as the temporary edge identity verifier. Pilot users must not need Cloudflare accounts; the identity mechanism is temporary infrastructure and must remain replaceable.

### 2A2 — Product authentication adapter

Introduce a customer-facing managed authentication provider behind the existing DCC session/principal abstraction.

Requirements:

- familiar sign-in such as Google and/or email magic link/OTP;
- account recovery and secure session management handled by the identity provider;
- stable provider-scoped subject mapped to `user_principals`;
- no auth-vendor user ID used directly as a workspace ID;
- support linking a replacement identity to an existing DCC user;
- retain Cloudflare Access only where useful for internal/admin/staging protection.

The specific vendor is selected by a small implementation/cost/Cloudflare-compatibility spike rather than hard-coded into the domain model.

### 2A3 — First-class integration accounts

Add user-owned integration records for external services.

Initial target:

- Google account connection;
- Gmail capability/status;
- Google Calendar capability/status;
- token lifecycle/refresh state;
- last successful sync, next scheduled sync, and bounded failure diagnostics.

Credentials/tokens are encrypted server-side. Integration health metadata may be stored in D1; secret material is not exposed to clients.

### 2A4 — DCC-owned scheduler

Replace per-user ChatGPT Automations with one backend scheduler.

The scheduler:

- runs centrally;
- selects integrations/users whose `next_run_at` is due;
- applies per-user preferences;
- uses bounded concurrency, retries, and backoff;
- records source health independently per user;
- supports future News, Intel, Mentions, and reminders without consuming ChatGPT automation slots.

### 2A5 — Direct Google Intake and Calendar

Move Gmail/Calendar collection from ChatGPT + Todoist transport into DCC-owned collectors.

- Gmail findings remain review-only Intake proposals.
- Calendar events remain projections, not Tasks.
- Existing conservative classification and workspace isolation rules remain.
- Per-user OAuth identity determines whose mailbox/calendar is scanned.
- Google OAuth verification/security requirements become a commercialization gate before public launch.

### 2A6 — Direct conversational/task capture

Add a user-authorized DCC capture API suitable for first-party UI and optional ChatGPT/app clients.

- ChatGPT can become a client that authenticates to DCC.
- The same server-side user/workspace authorization applies.
- Todoist remains supported only as a temporary compatibility/fallback adapter and can later be retired.
- DCC reminders are scheduled by DCC, not by ChatGPT Automations.

### 2A7 — Onboarding and Integration Health

Build a nontechnical onboarding flow and a simple status surface showing:

- signed-in DCC account;
- Personal workspace ready;
- Google connected/not connected;
- Gmail Intake health;
- Calendar sync health;
- task-capture connection status where applicable;
- last successful run and actionable error state;
- test capture/connection actions.

Operational/admin views may expose health and account state but must not casually expose another user's private task, email, calendar, or financial contents.

### 2A8 — Family pilot and lifecycle controls

Pilot with separate real users only after isolation and integration tests pass.

Acceptance requires:

- separate Personal workspace for every pilot user;
- cross-user task/calendar/intake/financial reads fail closed;
- a pilot user can onboard without Cloudflare/Todoist/GitHub setup;
- account disable/revoke works;
- disconnecting an integration revokes future collection;
- application upgrades appear automatically from the shared hosted deployment;
- per-user failures do not appear as global system failures.

## Deferred follow-on work

After the family pilot is stable:

1. hosted Settings control plane;
2. Intel summary-quality v2;
3. Personal News using the same intelligence engine;
4. Mentions;
5. Household/shared workspace;
6. explicit item-level task/calendar sharing;
7. commercial billing/plan/usage controls if a public product is pursued.

## Non-goals for 2A1

The first slice does not yet:

- replace Cloudflare Access at the browser edge;
- connect Google;
- change Todoist transport;
- create Household/shared data;
- add commercial billing;
- expose an admin ability to read private user content.

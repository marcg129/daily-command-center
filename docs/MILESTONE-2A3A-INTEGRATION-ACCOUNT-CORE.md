# Milestone 2A3a — Integration account core

Date: 2026-10-01

Status: **Implementation slice.**

## Goal

Create the durable hosted boundary for user-owned external integrations before adding Google OAuth routes, scheduling, or Gmail/Calendar collection.

This slice deliberately separates:

- integration identity and health metadata, which DCC can query safely; and
- OAuth credentials, which DCC stores only as authenticated ciphertext.

Local-mode Google settings remain unchanged. This is the hosted multi-user path.

## Data model

Migration `0014_integration_accounts.sql` adds:

### `integration_accounts`

User-owned metadata:

- durable DCC integration ID;
- owning DCC `user_id`;
- provider (`GOOGLE` initially);
- stable provider account ID;
- optional display email;
- connection status;
- granted scopes;
- access-token expiry metadata;
- last successful sync;
- next scheduled sync;
- bounded failure count/code/timestamp;
- disconnect timestamp;
- created/updated timestamps.

A provider account may belong to only one DCC user. This prevents one Google identity from silently feeding two private DCC accounts.

### `integration_credentials`

One encrypted credential envelope per integration:

- algorithm: AES-256-GCM;
- key version;
- payload format version;
- random 96-bit nonce;
- ciphertext including the GCM authentication tag.

There are no plaintext refresh-token or access-token columns.

Disconnect deletes the credential row while retaining non-secret integration history/status.

## Encryption boundary

`AesGcmIntegrationCredentialCipher` uses Web Crypto so it runs in the Cloudflare Worker runtime.

The encryption key is **not** stored in D1 and is **not** committed to Git.

Credential ciphertext is authenticated with additional data containing:

- envelope domain/version;
- DCC user ID;
- DCC integration ID;
- provider.

That means copying ciphertext to a different user/integration/provider causes decryption to fail.

The keyring supports reading older key versions while new writes use one active version. Later runtime wiring will provide key material from Cloudflare Worker secrets and can rotate by adding a new key version, rewriting envelopes, then retiring the old key.

## Repository boundary

`D1IntegrationAccountRepository`:

- requires an ACTIVE durable DCC user for every operation;
- scopes every account read by `user_id`;
- encrypts before persistence;
- decrypts only after an owned account lookup;
- resets health state after credential replacement;
- records success/failure health without returning secrets;
- deletes credential ciphertext on disconnect;
- allows an owned disconnected account to reconnect only by persisting a new authenticated credential envelope; and
- rejects credential bundles whose actual AES-GCM/base64url envelope would exceed the migration's bounded ciphertext field.

There is intentionally no browser/API route in 2A3a.

## Deferred to subsequent 2A3 slices

- Cloudflare Worker secret/keyring binding;
- Google OAuth authorization/callback routes;
- CSRF/PKCE state handling for integration consent;
- Gmail/Calendar capability selection;
- refresh-token exchange and rotation against Google;
- Integration Health UI;
- DCC scheduler/collector execution.

Those build on this core instead of inventing a second credential store.

## Acceptance

2A3a is ready when:

- migration tests pass on all CI platforms;
- ciphertext round-trips but does not reveal tokens;
- ciphertext cannot be decrypted under another user/integration context;
- old key versions remain readable during rotation;
- cross-user integration reads fail closed;
- duplicate provider identity attachment fails;
- disconnect deletes credential ciphertext;
- disabled users cannot read integration metadata or credentials.

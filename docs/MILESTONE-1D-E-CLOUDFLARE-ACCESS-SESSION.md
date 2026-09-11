# Milestone 1D-E — Cloudflare Access Session Verification

## Goal

Add a production-shaped but still non-deployed `SessionProvider` adapter that verifies Cloudflare Access application JWTs and converts a verified assertion into the existing `AuthenticatedSession` / `AuthenticatedPrincipal` model.

This milestone supplies the trusted identity adapter needed by Milestone 1D-D. It does **not** add an HTTP route, deploy the app, configure a real Access application, or expose structured capture publicly.

## Current Cloudflare requirements

Cloudflare Access places the application token in the `Cf-Access-Jwt-Assertion` request header. The Worker/origin must validate the JWT signature rather than trusting the header value by itself.

Use the Cloudflare account signing keys from:

`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`

Verify at minimum:

- RS256 signature;
- expected issuer (`https://<team>.cloudflareaccess.com`);
- expected Access application audience (AUD);
- expiration and not-before claims;
- application-token type (`type = app`).

Cloudflare documentation currently recommends `jose` with `jwtVerify` and `createRemoteJWKSet` for Workers.

## Dependency

Add exact runtime dependency:

`jose: 6.2.12`

Refresh `package-lock.json` normally. Do not hand-edit lockfile integrity values.

Do not add another JWT/auth library.

## Adapter shape

Add a server/runtime adapter implementing the existing `SessionProvider` contract, for example:

`CloudflareAccessSessionProvider`

Recommended constructor/options:

- `teamDomain` — expected Cloudflare Access team origin;
- `audience` — expected application AUD tag;
- injected `Clock` so expiry behavior is deterministic in tests;
- optional injected JOSE key resolver for tests; production/default uses `createRemoteJWKSet`.

The provider's `sessionIdentity` input is the raw Access application JWT supplied by a future trusted HTTP adapter. Treat it as opaque input; never log it or return it as a session ID.

## Team domain validation

Fail configuration closed.

Normalize and require:

- HTTPS;
- hostname ending in `.cloudflareaccess.com`;
- no username/password;
- no query/hash;
- root path only;
- a non-empty audience.

Use the normalized origin as the expected JWT issuer and derive `/cdn-cgi/access/certs` from it.

## Identity mapping

### Identity-provider/browser authentication

Cloudflare Access identity application tokens contain a stable non-empty `sub` claim.

Map a verified non-empty `sub` to a stable principal ID such as:

`cf-user:<sub>`

Do not use email as the primary identity key.

### Service-token authentication

Cloudflare Access service-token application JWTs may have an empty `sub`; their stable service identity is exposed as `common_name` (the service token Client ID).

Do not place arbitrary `common_name` text directly into `PrincipalId` because it may contain characters not allowed by the existing principal-ID format.

Derive a collision-resistant stable principal ID from `common_name`, for example:

`cf-service:<SHA-256 hex of common_name>`

Use Web Crypto / standards-compatible crypto, not a homemade hash.

Reject a verified token that has neither a usable non-empty `sub` nor a usable service-token `common_name`.

## Session mapping

For a successfully verified token:

- `principal.principalId` comes from the identity rules above;
- `expiresAt` comes from the verified numeric `exp` claim;
- require `exp` to exist and be a finite numeric timestamp;
- derive `sessionId` from a SHA-256 digest of the full verified JWT, prefixed with something like `cf-access:`;
- never use or expose the raw JWT itself as `sessionId`.

The session ID only needs to identify that token instance; principal identity is the stable subject/service identity.

## Verification failures

`SessionProvider.getSession()` must remain fail-closed:

- missing token -> `null`;
- malformed JWT -> `null`;
- invalid signature -> `null`;
- wrong issuer -> `null`;
- wrong audience -> `null`;
- expired/not-yet-valid token -> `null`;
- wrong token type -> `null`;
- missing usable identity claims -> `null`.

Do not leak JOSE error detail or token content through this API.

Configuration errors should fail at provider construction rather than silently weakening verification.

## JOSE configuration

Use `jwtVerify` with:

- exact expected issuer;
- exact expected audience;
- `algorithms: ["RS256"]`;
- injected/current clock where JOSE supports deterministic current-date verification.

Default key resolution should use `createRemoteJWKSet` against the Cloudflare Access certs URL.

Allow an injected `JWTVerifyGetKey` only for tests so unit tests can use a local generated key/JWK set without network access.

Do not decode claims and trust them before signature verification.

## Integration with 1D-D

Add an integration test proving that a cryptographically verified Access assertion can be supplied as `sessionIdentity` to `createAuthorizedHostedTaskCaptureService`, then:

- resolve the verified principal through `WorkspaceResolver`;
- create the hosted structured task only when that principal has the workspace grant.

Do not add a request-header reader or API route yet.

## Tests

At minimum prove:

1. valid identity Access JWT verifies and produces an unexpired `AuthenticatedSession`;
2. identity principal derives from `sub`, not email;
3. session ID does not equal or contain the raw JWT;
4. valid service-token JWT with empty `sub` derives a stable principal from `common_name`;
5. two service-token JWTs with the same `common_name` yield the same principal ID but distinct session IDs when token bodies differ;
6. missing assertion returns null;
7. malformed JWT returns null;
8. invalid signature returns null;
9. wrong issuer returns null;
10. wrong audience returns null;
11. expired token returns null;
12. not-yet-valid token returns null;
13. non-`app` token returns null;
14. token without usable `sub` or `common_name` returns null;
15. constructor rejects unsafe/invalid team domain configuration;
16. constructor rejects blank audience;
17. local injected JWKS verifies RS256 without network access;
18. 1D-D integration succeeds only for a granted principal/workspace;
19. the same verified principal without the requested grant is rejected before task persistence;
20. all existing auth, task, D1, hosted-capture, build, and smoke tests remain green.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run smoke`
- `git diff --check`
- read-only `npm audit` review; do not run blind `npm audit fix`.

CI Node remains 24.19.0.

## Do not implement in 1D-E

- HTTP extraction of `Cf-Access-Jwt-Assertion`;
- a Next.js/Worker capture route;
- Cloudflare Access dashboard/API configuration;
- service-token creation;
- production D1 binding;
- deployment;
- permissive CORS;
- fallback bearer tokens;
- natural-language/LLM task interpretation;
- notification delivery;
- Google Calendar sync.

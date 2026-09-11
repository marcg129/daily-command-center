# Milestone 1D-D — Authorized Hosted Capture Composition

## Goal

Compose the existing hosted structured-capture service with the authentication and workspace-authorization contracts already established in the hosted foundation.

This milestone proves the authorization chain:

`opaque session identity -> SessionProvider -> authenticated principal -> WorkspaceResolver -> RequestContext -> hosted structured capture`

It remains transport-neutral and non-production. It does not expose a new HTTP route and does not parse or trust headers, cookies, JWTs, Cloudflare Access assertions, or bearer tokens.

## Required behavior

Add a runtime-neutral service that accepts:

- an opaque session identity supplied by a future trusted transport adapter;
- a requested workspace ID;
- the structured capture payload.

The service must:

1. load the session only through `SessionProvider`;
2. reject missing, unknown, malformed, or expired sessions through `requireAuthenticatedSession`;
3. resolve the requested workspace only through `WorkspaceResolver`;
4. reject unknown or ungranted workspaces before persistence;
5. invoke the existing hosted structured-capture service only after authorization succeeds;
6. retain the existing requirement that capture `workspaceId` matches the authorized `RequestContext`;
7. preserve all 1D-B/1D-C idempotency, visibility, fingerprint, timing, and workspace rules.

## Security boundary

Do not add any transport-specific identity extraction in this milestone.

In particular, do not:

- trust an arbitrary request header as a principal or session;
- add a bearer token;
- add permissive CORS;
- parse Cloudflare Access JWTs yet;
- create a public API route;
- deploy anything.

A future Cloudflare Access adapter will be responsible for verifying the external assertion and deriving the opaque session identity passed into this service.

## Tests

Prove at minimum:

1. a valid unexpired session with a workspace grant can create a hosted task;
2. missing session identity fails before persistence;
3. unknown session identity fails before persistence;
4. expired session fails before persistence;
5. authenticated principal without the requested workspace grant fails before persistence;
6. legacy/unknown workspace IDs fail before persistence;
7. capture workspace mismatch fails before persistence;
8. authorized Indelitech capture retains Indelitech + Personal visibility;
9. replay remains idempotent through the authorized composition;
10. all existing task, hosted capture, D1, auth, and smoke tests remain green.

## Deferred

- Cloudflare Access/JWT verification adapter;
- HTTP route composition;
- production D1 binding composition;
- deployment;
- public/external ChatGPT integration;
- natural-language interpretation;
- notifications and background scheduling.

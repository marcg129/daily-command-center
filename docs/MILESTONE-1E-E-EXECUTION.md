# Milestone 1E-E execution note

Implementation for 1E-E is performed on `milestone/1e-e-hosted-task-routes` against the requirements in `MILESTONE-1E-E-HOSTED-TASK-ROUTES.md`.

This branch must remain non-deploying and must preserve the existing local SQLite API paths and loopback-only proxy until the later 1E-F cutover.

## Hosted boundary

The milestone adds three deliberately namespaced, server-only endpoints:

- `GET /api/hosted/workspace?workspaceId=personal|indelitech`
- `POST /api/hosted/tasks/mutations?workspaceId=personal|indelitech`, with a
  JSON body shaped as `{ "mutations": [...] }`
- `POST /api/hosted/tasks/capture`, with the existing structured-capture body
  (including its `workspaceId` and `requestId`)

Task reads and mutations verify the `Cf-Access-Jwt-Assertion`, reject an
expired session, and resolve the exact D1 principal/workspace grant before a
task repository is constructed. Capture delegates unchanged to the existing
authorized hosted capture runtime, retaining its idempotency fingerprint.

## Dual-runtime binding isolation

The route modules call a small asynchronous binding accessor. It imports the
documented `cloudflare:workers` module by a runtime module specifier, marked for
both Webpack and Vite to leave external. Consequently normal Next compilation
does not try to resolve a workerd-only protocol, while the vinext Worker loads
the native module at request time. A normal Next server cannot obtain hosted
bindings and returns only a bounded 500; the local API surface remains the
normal Next path until 1E-F.

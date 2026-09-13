# Milestone 1F-G: hosted Intel snapshot foundation

Date: 2026-09-12  
Branch: `milestone/1f-g-hosted-intel-snapshot`  
Baseline: `f85634dca0bf7626971013d9a6cd660732a35c42`

## Goal

Replace the hosted Indelitech Intel deferred shell with a truthful, read-only view over the existing workspace-scoped D1 collector snapshot store without exposing local SQLite/settings APIs or inventing hosted collection behavior that does not exist yet.

## Behavior

- `/api/hosted/intel?workspaceId=indelitech` is the only new hosted API surface.
- The route requires a valid Cloudflare Access assertion and an explicit Indelitech workspace grant before reading D1.
- Personal is not accepted by this route; Intel remains an Indelitech-only product surface.
- The route reads only the `industry` collector snapshot through `D1CollectorSnapshotRepository`.
- No-snapshot state is explicit and returns no fabricated data.
- Snapshot freshness is reported as `current` or `stale`; stale content may be shown for continuity but is labeled as stale.
- Display stories are projected to a bounded safe shape and only HTTP/HTTPS story URLs survive the hosted boundary.
- The UI renders at most the bounded response returned by the route and opens story links in a separate, isolated browsing context.
- Local Indelitech Intel remains unchanged and continues using the existing local collector flow.

## Security and runtime boundaries

This milestone does **not** run the existing local industry collector in Cloudflare. That collector still depends on local settings, Node/SQLite-owned stores, and the local pinned-fetch security model. Earlier runtime-boundary work explicitly deferred a hosted outbound-fetch design.

The hosted route therefore:

- does not call `/api/live/industry`;
- does not read local settings or filesystem state;
- does not fall back to local SQLite;
- does not add a hosted settings route;
- does not accept writes or refresh requests;
- does not broaden Personal visibility into Indelitech Intel;
- does not alter task, Calendar, Today, recurrence, MCP capture, or reminder behavior.

The hosted proxy allowlist is expanded only for the exact `/api/hosted/intel` path. Existing same-origin enforcement remains in place.

## Population is deliberately separate

The D1 collector snapshot schema and repository already existed, but production currently has no hosted mechanism that populates an Indelitech `industry` snapshot. 1F-G makes the authorized read path and truthful UI real; it does not pretend that collection exists.

A follow-on milestone must choose and review the population mechanism. The preferred options are a Cloudflare-native scheduled collector with a reviewed outbound-fetch/SSRF posture and workspace-owned configuration, or a controlled authenticated ingest path. Local API fallback and hard-coded placeholder stories are not acceptable substitutes.

## Validation

Focused coverage verifies:

- malformed or non-HTTP story URLs are dropped;
- empty/current/stale snapshot states;
- missing Access assertions fail before snapshot reads;
- Personal requests are rejected;
- an Indelitech workspace grant is required before D1 access;
- authorized reads use exactly the Indelitech `industry` snapshot context;
- internal snapshot failures return bounded errors without persistence/auth details;
- the hosted proxy permits the exact Intel route while continuing to block neighboring and legacy hosted paths.

Normal repository validation remains the merge gate on Ubuntu, macOS, and Windows.

## Next milestone

**Milestone 1F-H: populate hosted Indelitech Intel safely.** Choose the smallest reviewed population path, keep all outbound destinations/configuration explicitly bounded, write only workspace-scoped `industry` snapshots, and preserve the fail-closed Access/D1 boundary established here. Do not expose hosted settings or local collector APIs merely to make the page non-empty.

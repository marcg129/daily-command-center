# Todoist Task Ingress Bridge — v0.1 Design

Date: 2026-09-16

Status: **Approved experiment; implementation isolated from Milestone 1G-G.**

## Objective

Restore the original low-friction Daily Command Center workflow even when ChatGPT does not expose the custom DCC app/MCP in the current conversation:

**conversation → capture request → Daily Command Center task, with no second planning app to manage manually.**

Todoist is transport only. Daily Command Center remains the system of record.

## Validated first hop

The native ChatGPT Todoist integration successfully:

- created a dedicated `Daily Command Center Inbox` project;
- created a structured relay test task inside that project; and
- read the task back with the task title, description metadata, priority marker, label, and project identity intact.

The test proves ChatGPT can use Todoist as a practical capture hop without relying on DCC appearing in ChatGPT's `@` picker.

## v0.1 architecture

```text
ChatGPT conversation
        |
        v
Native Todoist integration
        |
        v
Daily Command Center Inbox project
        |
        v
Cloudflare scheduled importer (polling)
        |
        v
DCC canonical task normalization + workspace authorization
        |
        v
Physical D1 task workspace
```

### Why polling first

For this personal bridge, a scheduled poller is simpler than introducing a Todoist OAuth application and webhook lifecycle. Todoist webhooks may still become useful later, but v0.1 should minimize moving parts and preserve a deterministic reconciliation path.

The initial target cadence is **once per minute**. The importer reads only the dedicated capture project and should normally make one paginated Todoist task-list request plus writes only when relay work exists.

## Capture envelope

ChatGPT should create relay tasks with a human-readable title and a structured description containing only fields known from the conversation.

Example:

```text
source: chatgpt
requestId: <conversation-generated-id>
workspace: indelitech
priority: HIGH
recurrence: One-time
estimatedDuration: 30m
context: Follow up with the vendor about the replacement shipment.
```

Rules:

- `workspace` is required and must be exactly `personal` or `indelitech`.
- Unknown optional fields are omitted rather than invented.
- The Todoist task ID is the importer's authoritative external idempotency key regardless of the conversation-generated `requestId`.
- The description is transport metadata, not a second canonical task schema.
- DCC validation remains authoritative for accepted task values.

## Explicit user identity binding

The importer must not infer the target DCC user by selecting the first account, first owner, or first matching workspace.

Worker configuration must bind to an exact durable DCC `userId`. The protected `/api/hosted/session` endpoint already returns the authenticated durable `userId`, so the one-time setup can use that value without exposing Cloudflare Access assertions or identity-provider attributes.

Before any import, the worker must verify:

1. the configured DCC user exists and is ACTIVE;
2. the requested logical workspace is supported;
3. that user has an active membership for that logical workspace; and
4. logical workspace resolution produces the exact physical workspace instance for that user.

Failure at any step is fail-closed and produces no DCC task.

## Idempotency

Use a provider-scoped request identity derived from the external task itself, for example:

```text
todoist:<todoist-task-id>
```

The same Todoist relay item must never create more than one canonical DCC task, even when:

- the Cron Trigger runs repeatedly;
- a Todoist API response is retried;
- Cloudflare retries an invocation;
- the importer fails after persistence but before updating Todoist; or
- the Todoist task remains visible for another poll cycle.

Reuse the existing DCC task-capture idempotency boundary where possible rather than introducing a second deduplication algorithm.

## Relay status and diagnostics

The Todoist project should provide the transparency that a spreadsheet queue would otherwise offer.

### Pending

New relay tasks remain open in `Daily Command Center Inbox`. A `dcc-pending` label may be used when available.

### Imported

Only after canonical DCC persistence is confirmed:

- mark the relay as imported; then
- close/complete the Todoist task so the inbox stays clean.

Completion must happen after DCC commit, never before.

### Failed

If parsing, authorization, or canonical validation fails permanently:

- leave the Todoist task open;
- apply a `dcc-failed` marker/label;
- attach a concise human-readable diagnostic detail; and
- avoid appending the same failure repeatedly every minute.

Transient provider, network, or D1 persistence failures remain pending for retry rather than being mislabeled as permanent.

Examples:

```text
DCC import failed: workspace must be personal or indelitech.
DCC import failed: configured DCC user is not authorized for indelitech.
DCC import failed: due date could not be interpreted safely.
```

Do not include secrets, Access tokens, D1 identifiers that are not already user-visible, or stack traces in Todoist diagnostics.

## Retry behavior

Classify failures:

- **Transient**: Todoist 429/5xx, D1 transient failure, network error. Retry with bounded backoff and keep the task pending.
- **Permanent until edited/configured**: malformed metadata, unauthorized workspace, invalid task value. Mark failed and do not repeat the same diagnostic until the relay task changes or configuration changes.
- **Already imported**: treat as success and close the Todoist relay if it is still open.

Respect Todoist server-provided retry metadata when present.

## Worker configuration

Expected non-secret configuration:

- `TODOIST_PROJECT_ID`

Expected runtime secret bindings:

- `TODOIST_API_TOKEN`
- `DCC_USER_ID`

`TODOIST_API_TOKEN` is a credential. `DCC_USER_ID` is not itself an authentication credential, but v0.1 still keeps the durable internal user identifier out of repository content and ordinary Worker vars. Both are configured as Cloudflare Worker secrets after the Worker exists.

Neither value may be committed, written to D1 as integration configuration, returned to the browser, or logged. Until both runtime bindings exist, the cron Worker must safely no-op instead of attempting Todoist or D1 work.

## Cloudflare runtime

Use a separate scheduled Worker rather than GitHub Actions for normal ingestion. This avoids coupling conversational task capture to repository workflow reliability.

The worker should:

- expose no public mutation endpoint in v0.1;
- use a `scheduled()` handler;
- share the production D1 database binding;
- poll once per minute;
- process a bounded batch per invocation;
- remain independently deployable from the web Worker, Intel Worker, and MCP Worker; and
- use a dedicated owner-authorized deployment workflow so missing Todoist runtime bindings cannot block unrelated DCC production deployments.

## Canonical DCC rules preserved

- Personal and Indelitech remain logical workspace selectors, not physical IDs supplied by Todoist.
- The configured user can write only to workspaces they are authorized to use.
- Todoist never receives physical workspace IDs.
- DCC task validation, recurrence behavior, due/reminder semantics, and persistence remain canonical.
- Optional unknown values are omitted.
- No financial records are accessible to or modified by this bridge.

## v0.1 acceptance criteria

1. A structured task created by ChatGPT in the dedicated Todoist project appears in the correct DCC workspace without manual re-entry.
2. Personal and Indelitech imports resolve to the configured user's exact physical workspace instances.
3. Reprocessing the same Todoist task cannot duplicate the DCC task.
4. Successful imports are removed from the active relay inbox only after DCC persistence succeeds.
5. Permanent failures remain visible in Todoist with a useful diagnostic rather than disappearing.
6. Transient failures retry without creating duplicate tasks or repeated diagnostic spam.
7. Invalid or unauthorized workspace metadata fails closed.
8. Local DCC mode is unaffected.
9. The Todoist API token never appears in repository content, D1 rows, client bundles, logs, or error messages.
10. The bridge can be disabled independently without affecting DCC web, MCP, Intel, Bills, Income, or Cash Flow.

## Deferred

- Todoist OAuth onboarding for multiple DCC users;
- Todoist webhooks;
- user-facing integration settings UI;
- two-way task synchronization;
- treating Todoist completion as DCC completion;
- importing arbitrary Todoist projects;
- Google Sheets or GitHub Issues as active relay transports; and
- Telegram capture.

Those transports remain fallback options if the Todoist flow proves inconvenient in real use.

# Milestone 1D-F — Chat-confirmed task capture

## Goal

Allow a ChatGPT conversation to propose a fully structured Daily Command Center task, show the exact interpretation for confirmation, and create the canonical task only after the user confirms it.

This milestone uses the existing structured-capture and D1 task services. It does not add a second task store, a chat-specific task table, or a new persistence path.

## Conversation contract

The companion MCP server exposes two focused tools:

1. `preview_task` validates and normalizes the proposal without writing anything.
2. `create_task` accepts the preview request ID and exact fields only after explicit user confirmation.

The MCP server instructions require this sequence:

1. Interpret the user's request into concrete task fields.
2. Call `preview_task`.
3. Show the user every returned field, including workspace, title, context, type, priority, due date, reminder/follow-up, recurrence, and estimated duration.
4. Ask for explicit confirmation.
5. If the user changes any field, preview again.
6. Call `create_task` only after the user confirms the exact proposal.

`create_task` also requires `confirmedByUser: true`. This is defense in depth for the conversation policy; it is not a substitute for displaying the proposal and asking the user.

## Canonical task behavior

- Chat captures call `createHostedStructuredTaskCaptureService`.
- Hosted mode writes to the existing D1 `tasks` and `task_visibility` tables.
- `requestId` remains the idempotency key, producing `capture:<requestId>` task IDs.
- Replays return the canonical existing task instead of creating a duplicate.
- Personal captures are Personal-only.
- Indelitech captures retain Indelitech + Personal roll-up visibility.
- Recurrence uses the existing canonical task-series semantics after capture.
- Due dates, reminders, and follow-ups remain independent.
- Estimated duration retains both the canonical label and numeric compatibility value.
- Loopback/local SQLite behavior is unchanged.

## Security boundary

The MCP Worker is deliberately separate from the web Worker, but uses the same D1 database and exact workspace-grant resolver.

Every MCP request must pass all of these checks before the protocol handler or task tools run:

- exact `/mcp` route;
- no cross-site `Origin`;
- a `Cf-Access-Jwt-Assertion` header injected by Cloudflare Access Managed OAuth;
- RS256 signature, issuer, audience, expiry, not-before, and application-token validation through `CloudflareAccessSessionProvider`;
- a stable `cf-user:<sub>` principal;
- an exact D1 workspace grant for the requested workspace.

There is no API-key fallback, bearer-token bypass, permissive CORS, privileged global task lookup, or trust in client-supplied principal IDs.

If `MCP_POLICY_AUD` has not been configured, the Worker fails closed with `503`. If the assertion is missing or invalid, it fails closed before D1 access.

## Cloudflare setup

The normal successful-main deployment publishes `daily-command-center-mcp` from `wrangler.mcp.jsonc`. Its endpoint is:

`https://daily-command-center-mcp.marcg129.workers.dev/mcp`

After the first deployment:

1. In Cloudflare Zero Trust, open **Access controls → AI controls → MCP servers**.
2. Add the endpoint above and enable **Access Managed OAuth**.
3. Apply the same user/identity-provider policy used for Daily Command Center. Do not add a bypass policy.
4. Copy the generated Access application audience.
5. Save it as the `MCP_POLICY_AUD` secret on the `daily-command-center-mcp` Worker.
6. Confirm the existing `cf-user:<sub>` principal still has Personal and Indelitech grants in `principal_workspace_grants`.

Cloudflare documents this managed OAuth posture for MCP servers that validate the Access JWT supplied by Cloudflare: <https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/>.

## ChatGPT connection and verification

OpenAI requires a public HTTPS streamable-HTTP MCP endpoint, accurate tool annotations, working authentication discovery, and explicit testing of write-action confirmation behavior. Connect the `/mcp` URL in ChatGPT developer mode, inspect the two discovered tools, and run these checks:

1. Ask for a task with ambiguous timing and confirm that the chat asks rather than inventing a date.
2. Ask for a complete task and confirm that only `preview_task` runs before approval.
3. Change one field and confirm a second preview occurs.
4. Approve and confirm exactly one canonical task appears in the intended workspace.
5. Repeat the approved tool call and confirm no duplicate appears.
6. Verify an Indelitech task is visible in Indelitech and the Personal roll-up, while a Personal task is absent from Indelitech.

Official connection guidance: <https://developers.openai.com/plugins/deploy/connect-chatgpt>.

## Validation

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run build:mcp`
- `npm run smoke`
- `git diff --check`
- read-only `npm audit` review

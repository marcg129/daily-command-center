# Milestone 1G-C — `command.coreyg.dev` custom domain

Date: 2026-09-13

Branch: `milestone/1g-c-custom-domain`

Status: **Prepared for cutover; do not merge/deploy until the manual Cloudflare prerequisites below are verified.**

## Objective

Make `https://command.coreyg.dev` the canonical user-facing Daily Command Center address while preserving the existing Cloudflare Access identity boundary, current application audience, production data, MCP endpoint, and a short rollback path.

## Current production boundary

- Web Worker: `daily-command-center`
- Current rollback hostname: `daily-command-center.mecg129.workers.dev`
- Access team domain: `https://young-truth-3b40.cloudflareaccess.com`
- Existing web Access audience remains the committed `POLICY_AUD`; 1G-C must not silently replace it.
- Task-capture MCP remains a separate Worker/hostname and is not moved by this milestone.
- Preview URLs remain disabled.

## Cloudflare/Squarespace onboarding state

As of 2026-09-15:

- `coreyg.dev` remains registered at Squarespace.
- Squarespace DNSSEC was disabled before the authoritative nameserver change.
- Authoritative nameservers are now:
  - `rose.ns.cloudflare.com`
  - `wesley.ns.cloudflare.com`
- Cloudflare reports `coreyg.dev` as Active.
- `www.coreyg.dev` still serves the existing Google-hosted site.
- Cloudflare now provides the apex `coreyg.dev` -> `https://www.coreyg.dev` permanent redirect with path/query preservation.
- The existing Daily Command Center Access application has `command.coreyg.dev` added as a whole-hostname public destination while retaining the Worker destination.
- The Access application audience remains the committed `POLICY_AUD`.

DNS posture:

- apex `coreyg.dev` uses the proxied placeholder required for the Cloudflare redirect;
- `www` remains a DNS-only CNAME to `ghs.googlehosted.com`;
- the existing Google verification CNAME is preserved DNS-only; and
- the Squarespace-only `_domainconnect` record is not required after Cloudflare became authoritative.

## Repository preparation

The branch declares the future web Worker Custom Domain in `wrangler.jsonc`:

```json
"routes": [
  {
    "pattern": "command.coreyg.dev",
    "custom_domain": true
  }
]
```

During initial cutover `workers_dev` intentionally stays enabled so the existing Access-protected `workers.dev` hostname remains available as a short rollback path. This is transitional, not the desired permanent production posture.

Deployment validation now requires:

- exactly one web Custom Domain: `command.coreyg.dev` with `custom_domain: true`;
- preview URLs disabled;
- the existing Access team domain and application audience unchanged;
- web `workers.dev` still enabled only during the rollback window;
- the MCP Worker to have no web Custom Domain route; and
- generated vinext Worker configuration to preserve the same domain/security posture before deployment.

## Authentication clarification

Daily Command Center currently uses **Cloudflare Access** as its application authentication boundary. A repository audit on 2026-09-15 found no application-level Google OAuth/Gmail callback route or Google OAuth client configuration in the current codebase.

The earlier proposed prerequisite to add `https://command.coreyg.dev/api/auth/google/callback` to Google Cloud was therefore incorrect and has been removed. Cloudflare Access login identity/provider configuration is separate from an application-owned Google OAuth client.

## Manual cutover prerequisites — MUST all be true before merge/deploy

1. Wait at least the planned DNSSEC safety interval after disabling Squarespace DNSSEC before changing nameservers. **Verified.**
2. At Squarespace, replace the previous Google Domains nameservers with only `rose.ns.cloudflare.com` and `wesley.ns.cloudflare.com`. **Verified.**
3. In Cloudflare, confirm `coreyg.dev` reaches **Active** status. **Verified.**
4. Confirm `www.coreyg.dev` still resolves to the existing Google-hosted site. **Verified.**
5. Create/verify the Cloudflare apex redirect from `coreyg.dev` to `https://www.coreyg.dev`, preserving path and query string. **Verified.**
6. Confirm `command.coreyg.dev` has no conflicting existing DNS record. The Worker Custom Domain deployment is expected to create/manage its DNS and certificate.
7. In Zero Trust > Access > Applications, extend the EXISTING Daily Command Center self-hosted application to protect `command.coreyg.dev` using the same policies. **Verified.**
8. Verify that the existing Access application audience remains the same value committed as `POLICY_AUD`. **Verified.**
9. Only after the remaining DNS conflict check is verified should this branch be merged and deployed through the existing owner-authorized current-main gate.

## Deployment verification

After deployment:

1. Open `https://command.coreyg.dev` in an unauthenticated/private session and confirm Cloudflare Access intercepts the request before application content is reachable.
2. Authenticate and confirm the hosted session resolves the same application user and Personal/Indelitech memberships.
3. Verify Today, Tasks, Calendar, task create/edit/complete, workspace switching, and hosted Intel through the custom hostname.
4. Verify the task-capture MCP integration remains functional on its existing separate hostname.
5. Verify `daily-command-center.mecg129.workers.dev` remains Access-protected during the rollback window.

## Rollback

If the custom hostname fails after deployment:

- use the still-protected `daily-command-center.mecg129.workers.dev` hostname;
- do not alter D1/KV data;
- correct the Custom Domain, certificate, DNS, or Access hostname/configuration;
- redeploy only through the protected current-main gate.

No data rollback or migration should be necessary because 1G-C changes routing, not application storage.

## Follow-up hardening

After `command.coreyg.dev` is stable and verified, use a separate focused change to disable the web Worker's `workers.dev` route. The MCP Worker's `workers.dev`/Access configuration remains independent and must not be disabled merely because the web rollback hostname is retired.

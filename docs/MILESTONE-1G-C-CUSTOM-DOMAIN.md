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

As of 2026-09-13:

- `coreyg.dev` remains registered at Squarespace.
- Squarespace DNSSEC was disabled before the authoritative nameserver change.
- Cloudflare onboarding has been started on the Free plan.
- Cloudflare assigned authoritative nameservers:
  - `rose.ns.cloudflare.com`
  - `wesley.ns.cloudflare.com`
- The registrar nameserver switch has intentionally NOT been made yet so the prior DNSSEC DS record has time to clear.

DNS records prepared in Cloudflare before activation:

- apex `coreyg.dev` uses a proxied placeholder for a later Cloudflare redirect to `https://www.coreyg.dev`;
- `www` remains a DNS-only CNAME to `ghs.googlehosted.com`;
- the existing Google verification CNAME is preserved DNS-only; and
- the Squarespace-only `_domainconnect` record is not required after Cloudflare becomes authoritative.

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

## Manual cutover prerequisites — MUST all be true before merge/deploy

1. Wait at least the planned DNSSEC safety interval after disabling Squarespace DNSSEC before changing nameservers.
2. At Squarespace, replace the previous Google Domains nameservers with only:
   - `rose.ns.cloudflare.com`
   - `wesley.ns.cloudflare.com`
3. In Cloudflare, confirm `coreyg.dev` reaches **Active** status.
4. Confirm `www.coreyg.dev` still resolves to the existing Google-hosted site.
5. Create/verify the Cloudflare apex redirect from `coreyg.dev` to `https://www.coreyg.dev`, preserving path and query string.
6. Confirm `command.coreyg.dev` has no conflicting existing DNS record. The Worker Custom Domain deployment is expected to create/manage its DNS and certificate.
7. In Zero Trust > Access > Applications, extend the EXISTING Daily Command Center self-hosted application to protect `command.coreyg.dev` using the same policies. Do not create a replacement Access application unless the existing application cannot safely cover the hostname.
8. Verify that the existing Access application audience remains the same value committed as `POLICY_AUD`. If Cloudflare would require a different audience, STOP and review the application auth configuration before deployment.
9. In the existing Google OAuth client used by Daily Command Center newsletters/Gmail, add this authorized redirect URI while retaining the rollback URI during cutover:

   `https://command.coreyg.dev/api/auth/google/callback`

   The application derives the Google callback URI from the incoming request hostname, so the new hostname must be authorized before reconnect/testing Google OAuth there.
10. Only after steps 1-9 are verified should this branch be merged and deployed through the existing owner-authorized current-main gate.

## Deployment verification

After deployment:

1. Open `https://command.coreyg.dev` in an unauthenticated/private session and confirm Cloudflare Access intercepts the request before application content is reachable.
2. Authenticate and confirm the hosted session resolves the same application user and Personal/Indelitech memberships.
3. Verify Today, Tasks, Calendar, task create/edit/complete, workspace switching, and hosted Intel through the custom hostname.
4. Verify Google OAuth start/callback behavior if that feature is currently in use.
5. Verify the task-capture MCP integration remains functional on its existing separate hostname.
6. Verify `daily-command-center.mecg129.workers.dev` remains Access-protected during the rollback window.

## Rollback

If the custom hostname fails after deployment:

- use the still-protected `daily-command-center.mecg129.workers.dev` hostname;
- do not alter D1/KV data;
- correct the Custom Domain, certificate, DNS, Access hostname, or OAuth configuration;
- redeploy only through the protected current-main gate.

No data rollback or migration should be necessary because 1G-C changes routing, not application storage.

## Follow-up hardening

After `command.coreyg.dev` is stable and verified, use a separate focused change to disable the web Worker's `workers.dev` route. The MCP Worker's `workers.dev`/Access configuration remains independent and must not be disabled merely because the web rollback hostname is retired.

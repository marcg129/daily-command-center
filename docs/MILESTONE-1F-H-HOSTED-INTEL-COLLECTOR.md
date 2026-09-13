# Milestone 1F-H: hosted Indelitech Intel collector

Date: 2026-09-13  
Branch: `milestone/1f-h-hosted-intel-collector`

## Goal

Populate the protected hosted Indelitech Intel snapshot introduced in 1F-G without importing the local collector's SQLite, filesystem settings, arbitrary-source fetching, or AI-provider dependencies into Cloudflare.

## Architecture

A separate Cloudflare Worker named `daily-command-center-intel` runs only from a Cron Trigger and shares the existing production D1 database.

The Worker:

- exposes no `fetch` handler;
- has `workers_dev: false` and `preview_urls: false`;
- has no routes or hosted settings endpoint;
- requires no API secrets or user-editable source configuration;
- runs every six hours at minute 17 UTC;
- writes only the Indelitech `industry` collector snapshot using scope `hosted-indelitech-intel-v1`.

The existing Access-protected Daily Command Center Worker remains the only browser read surface for hosted Intel.

## Collection boundary

The first hosted collector intentionally uses a small fixed query set against Google News RSS for:

- MSP cybersecurity and breach developments;
- small-business / SMB cybersecurity and ransomware;
- Microsoft 365 security, vulnerability, breach, and phishing developments;
- ransomware and business/organization breaches;
- CISA and security advisories involving vulnerabilities or exploitation.

Outbound collection is bounded in code:

- HTTPS only;
- hostname exactly `news.google.com`;
- path exactly `/rss/search`;
- redirects are not followed;
- each response is limited to 2 MB;
- each request is limited to 12 seconds;
- unexpected content types are rejected;
- story links must themselves be HTTPS before entering the collector payload.

There is no user-controlled URL at the hosted collection boundary.

## Curation

The collector reuses the deterministic industry curation logic already exercised by the local product. It does not use a hosted AI key.

The fixed topic and priority terms emphasize practical Indelitech relevance such as MSP operations, SMB security, Microsoft 365, ransomware, breaches, CISA, vulnerabilities, phishing, active exploitation, and zero-days.

The surfaced set is capped at 24 items and remains source-diverse. Items carry deterministic importance scores/reasons for the existing hosted Intel UI.

## Failure behavior

Individual fixed queries may fail without discarding successful results from the others. The resulting snapshot is marked degraded and retains bounded error notes.

If every fixed query fails, collection throws before the D1 write. The last successful hosted Intel snapshot therefore remains available and will age naturally into the existing stale state instead of being replaced by an empty failure snapshot.

## Deployment

- `npm run build:intel` dry-runs the Worker with Wrangler.
- The normal Check workflow runs that build on Ubuntu, macOS, and Windows.
- The protected production workflow validates the committed Intel Worker name, entrypoint, no-public-URL posture, exact D1 binding, fixed Cron schedule, and absence of hosted vars.
- Only after those checks does the owner-gated current-main deployment publish the cron Worker alongside the protected app and task-capture MCP Worker.

Cloudflare Cron Triggers execute on UTC. After first deployment, the first real production snapshot is expected on the next scheduled trigger; the read surface remains truthful until that occurs.

## Explicitly deferred

This milestone does not add:

- arbitrary or user-configurable hosted sources;
- a public/manual refresh endpoint;
- hosted Settings;
- AI curation or provider secrets;
- durable discovery/history tables beyond the existing collector snapshot;
- hosted Mentions;
- Daily Brief persistence;
- Google Calendar work.

Those should be added only when they deliver enough value to justify widening the runtime or configuration surface.

## Validation

Focused tests cover:

- outbound allowlisting;
- redirect/content-type/response-size rejection;
- feed parsing and HTTPS-only story acceptance;
- exact fixed query usage;
- partial-provider degradation;
- bounded deterministic output;
- all-source failure preserving the old snapshot;
- exact Indelitech `industry` snapshot ownership;
- cron-only Worker/no HTTP handler posture;
- Wrangler, CI, and protected deployment wiring.

No files under `upload/` are part of this milestone.

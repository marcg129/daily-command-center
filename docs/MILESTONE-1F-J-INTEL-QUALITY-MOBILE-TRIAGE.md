# Milestone 1F-J — Intel quality and mobile triage

Date: 2026-09-13  
Branch: `milestone/1f-j-intel-quality-mobile-triage`

## Goal

Improve the first production Hosted Intel feed so it is useful to review daily instead of merely proving that collection works.

The first manual production snapshot successfully collected 67 fresh discoveries and surfaced 24 items, but production review exposed two quality problems:

- ambiguous words such as `breach` could score highly without real cybersecurity context;
- Google News RSS descriptions can repeat the headline, producing visually duplicated card copy.

The mobile page also becomes unnecessarily long when all 24 surfaced stories render at once.

## Relevance changes

The hosted collector now requires real cyber context before a fresh story enters deterministic curation.

Strong context includes signals such as:

- cybersecurity / cyberattack / cybercriminal activity;
- ransomware and malware;
- phishing and credential theft;
- data breaches, leaks, and exposure;
- vulnerabilities, CVEs, exploitation, and zero-days;
- hacking, threat actors, account takeover, and incident response.

Generic words such as `breach`, `security`, `attack`, or `compromise` no longer qualify by themselves. They can qualify only when paired with a reviewed technical anchor such as MSP / managed service provider, Microsoft 365, CISA, cloud security, email security, endpoint security, or network security.

This prevents physical, geopolitical, contractual, or similarly unrelated uses of `breach` from receiving cyber relevance simply because the headline is fresh.

The fixed Google News queries are also tightened around `data breach`, ransomware, cyberattack, phishing, vulnerability, and related technical language. The curation threshold rises from 42 to 50, source diversity tightens to three items per publisher, and event-similarity suppression becomes slightly more aggressive.

A small source-priority map boosts authoritative security sources such as CISA, Microsoft, BleepingComputer, Krebs on Security, The Hacker News, SecurityWeek, Dark Reading, and SC Media. Florida and South Florida cyber stories receive priority-topic weight after passing the cybersecurity relevance gate.

## Card copy

Google News publisher suffixes such as `- Yahoo` are stripped from titles when the publisher is already shown separately.

RSS descriptions are compared with the headline. If the description contains useful distinct context, it becomes the card TL;DR. If it is just the headline repeated, the collector generates a short deterministic category summary from the available feed metadata.

This is intentionally RSS-only deterministic summarization. The collector does not claim to have fetched or summarized the full article body and does not add an AI provider, secret, or article-scraping surface.

Cards label this concise line as **TL;DR** and keep the existing deterministic ranking explanation under **Why surfaced**.

## Mobile triage

The protected D1 snapshot still stores up to 24 curated Intel items.

The hosted UI now:

- shows the top 8 by default;
- exposes the remaining stored items through a Show more control;
- lets the user collapse back to the top 8;
- tightens card padding and supporting text on screens at or below 720px;
- keeps article title, TL;DR, source/date, and relevance explanation readable.

Article links continue opening in a separate tab with `target="_blank"` and `rel="noreferrer noopener"`; the dashboard is not navigated away from.

## Boundaries

This milestone does not change:

- the Access or workspace-grant boundary;
- D1 schema or snapshot ownership;
- the cron-only Worker exposure posture;
- the six-hour collection schedule;
- the manual owner-only Intel workflow;
- task, Calendar, Today, MCP capture, recurrence, or reminder behavior;
- hosted Settings or Mentions;
- files under `upload/`.

## Validation

Focused coverage verifies:

- an ambiguous physical `breach` story is rejected;
- a true `data breach` / cybercriminal story remains relevant;
- publisher suffixes are removed from headlines;
- duplicate headline-like RSS descriptions produce a non-duplicate TL;DR;
- useful distinct RSS summaries are preserved;
- off-topic fresh items are counted as filtered instead of silently scoring high;
- the D1 snapshot remains capped at 24 curated items;
- the UI defaults to eight visible cards with Show more / collapse behavior;
- article links keep the isolated new-tab behavior;
- mobile density changes do not hide title, TL;DR, or relevance context.

Normal repository Check must pass on Ubuntu, macOS, and Windows, including MCP build, Intel Worker build, and smoke, before merge.

# Milestone 1F-K — Today Intel highlights

Date: 2026-09-13  
Branch: `milestone/1f-k-today-intel-highlights`

## Goal

Use the now-validated Hosted Intel snapshot to make the hosted Indelitech Today page more useful without rebuilding Daily Brief or adding another data source.

## Scope

Indelitech Today now includes a compact **Intel pulse / Worth knowing** panel beneath the existing task attention and 45-day horizon.

The panel:

- reads the existing Access-protected `/api/hosted/intel?workspaceId=indelitech` route;
- shows only the top three already-curated snapshot stories;
- displays the story title plus the existing deterministic TL;DR;
- opens external stories in isolated new tabs;
- provides an **Open Intel** action to reach the full Intel page;
- identifies stale snapshots without representing them as current;
- stays out of Personal Today, preserving the existing Personal task roll-up without mixing business intelligence into that view;
- fails quietly if Intel cannot be read, so task work remains usable.

## Boundaries

This milestone does not change:

- the Intel collector, ranking, queries, cron schedule, or manual-run workflow;
- D1 schema or snapshot ownership;
- Cloudflare Access or workspace authorization;
- Tasks, Calendar, recurrence, reminders, or MCP capture;
- hosted Mentions, Settings, or Daily Brief;
- local-mode Today behavior;
- files under `upload/`.

## Validation

Focused coverage verifies:

- exactly three Intel highlights are selected;
- the panel is Indelitech-only;
- it reads only the protected hosted Intel route;
- external links keep `target="_blank"` plus `noreferrer noopener`;
- no local Industry or Settings endpoint is introduced;
- loading, empty, stale, and read-failure states do not block task work.

Normal repository Check must pass on Ubuntu, macOS, and Windows, including MCP build, Intel Worker build, and smoke, before merge.

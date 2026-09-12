# Milestone 1F-E — Task planning filters

## Goal

Make the existing canonical task list easier to plan without creating a second task view, changing persistence, or changing workspace visibility.

The Tasks page gains three temporary display filters for open task rows:

- priority: all, high, medium, low;
- due window: any, overdue, today, next 7 days, later, unscheduled;
- estimated duration: any, 30 minutes or less, 1 hour, 2h+/project, not estimated.

## Boundaries

This milestone is derived UI state only.

- Filters are not persisted to D1, SQLite, localStorage, settings, or task records.
- Filters do not create, clone, mutate, complete, cancel, or delete tasks.
- Personal still receives Personal + Indelitech roll-up visibility.
- Indelitech still excludes Personal-only tasks.
- Completed and cancelled history is unchanged.
- Calendar/Agenda continues to derive from the same canonical task records and is unaffected by task-list filters.
- Recurrence, reminders, follow-ups, task capture, MCP confirmation, Cloudflare Access, D1 grants, and hosted/local runtime routing are unchanged.
- No files under `upload/` are introduced or modified.

## Implementation

`lib/task-planning.ts` provides pure derived helpers for due and duration buckets plus a workspace-safe filtering helper used by regression tests.

The existing `TaskRow` receives only derived `data-*` bucket annotations. The existing Quick Add surface owns transient filter controls. An isolated stylesheet hides nonmatching rows in the open task list while leaving the canonical React task rows, summary counts, completion history, and mutation callbacks untouched.

## Validation

Run the repository's normal validation suite:

- `npm run lint`
- `node --import tsx --test tests/*.test.ts`
- `npx tsc --noEmit`
- `npm run build`
- `npm run build:mcp`
- `npm run smoke`
- `git diff --check`

Review the PR diff before merge and merge only after the required GitHub checks pass.

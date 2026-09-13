# Milestone 1F-F — Today agenda

## Goal

Make Today more actionable by showing the current day’s task-derived schedule alongside the existing attention list and 45-day horizon.

The agenda is derived from the same canonical calendar projection already used by Calendar:

- task due dates;
- task reminders;
- waiting-task follow-ups.

## Behavior

- Personal preserves the existing Personal + Indelitech roll-up.
- Indelitech continues to exclude Personal-only tasks.
- Only active canonical task rows contribute entries.
- Timed reminders and follow-ups stay in chronological order; all-day due dates remain later in the day.
- Entries that have already passed today are visibly labeled overdue.
- Clicking an agenda entry opens/focuses the canonical Tasks row through the existing Today task callback.
- The Today panel shows at most six agenda entries and reports additional entries as available in Calendar.

## Boundaries

This milestone adds no new persistence or task representation.

- No calendar records are created.
- No task schema, D1, SQLite, mutation route, recurrence, MCP capture, Cloudflare Access, or deployment contract changes.
- No Google Calendar sync or calendar-native event model.
- No standalone reminder resurrection.
- Hosted and local modes continue reading their existing canonical task state.
- No files under `upload/` are introduced or modified.

## Implementation

`lib/task-calendar.ts` exposes `taskCalendarEntriesForToday`, a thin current-product-date filter over the existing canonical `taskCalendarEntries` projection.

`components/today-task-agenda.tsx` renders the compact Today schedule. It is composed inside the existing `TaskAttentionPanel`, which already has the correct workspace context and canonical-task focus callback. This avoids changing page routing or duplicating workspace logic.

## Validation

Run the repository’s normal validation suite and focused Today agenda regression coverage. Merge only after Linux, macOS, and Windows checks pass and the final PR diff is clean.

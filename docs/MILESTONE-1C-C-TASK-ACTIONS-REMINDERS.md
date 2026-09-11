# Milestone 1C-C — Task Actions and Reminder Semantics

## Goal

Extend the workspace-aware task surface so tasks support clear action state and manual reminder/follow-up semantics without reviving a standalone Reminders tab or building the future notification engine yet.

This milestone should make the in-app task model behave like the product charter:

- due date is not reminder time;
- snooze changes reminder timing, not the deadline;
- waiting-for work is explicit and follow-up driven;
- cancel is a state transition, not deletion;
- recurring ownership/series behavior remains intact;
- Personal continues to roll up Indelitech tasks without duplication.

## Scope

Add the smallest compatible local/UI bridge toward the already-proven hosted task schema. Reuse existing hosted task constants/types where practical.

### Local task fields

Extend `TaskItem` compatibly with optional fields that normalize at read boundaries:

- `type`: ONE_TIME / DEADLINE / FOLLOW_UP / WAITING / RECURRING / BACKLOG
- `status`: OPEN / WAITING / DONE / CANCELLED
- `remindAt`: ISO timestamp or absent
- `followUpAt`: ISO timestamp or absent
- `person`: string or absent
- `updatedAt`: ISO timestamp or absent

Do not remove existing fields. Preserve recurrence/history and workspace ownership.

Legacy normalization:

- missing status -> DONE if `done === true`, otherwise OPEN
- missing type -> RECURRING when recurrence is not One-time; DEADLINE when a due date exists; otherwise ONE_TIME
- invalid values -> safe deterministic defaults
- existing `done` compatibility remains supported; status becomes the richer semantic source and writes should keep legacy `done` consistent while the bridge exists

Do not guess a person, reminder, follow-up date, or deadline.

## Due vs reminder

A task may have:

- a due date and no reminder;
- a reminder and no due date;
- both;
- neither.

Changing or snoozing a reminder must not silently alter `due`.

Editing the due date must not silently rewrite `remindAt`.

Store reminder/follow-up timestamps as ISO UTC timestamps. UI inputs may use product wall-clock time, but conversion must be deterministic for `America/New_York`, including DST boundaries. Add runtime-neutral tested helpers rather than relying on the browser's current timezone.

## Task actions

Add an accessible task action surface with:

- Done
- Snooze reminder
- Set / change reminder
- Mark waiting
- Resume from waiting
- Change due date
- Cancel task
- Edit details
- Delete remains available as destructive removal, visually separated from Cancel

### Done

- status -> DONE
- legacy `done` -> true
- completedAt set
- reminder/follow-up should no longer surface as active attention
- recurring completion must preserve the existing occurrence/series behavior and workspace ownership

### Snooze reminder

- modifies `remindAt` only
- presets may include later today, tomorrow morning, next business day, and custom date/time
- do not change due date
- if no reminder exists, Snooze may create one, but label the action clearly as reminder timing

### Waiting

Mark waiting requires:

- person / waiting-for label
- follow-up date/time

Effects:

- status -> WAITING
- type -> WAITING unless preserving a stronger existing semantic is necessary; use one consistent documented rule
- `person` populated
- `followUpAt` populated
- the task is removed from ordinary open-action attention until follow-up is due
- once follow-up time arrives, it should surface in Today attention as a follow-up due

Resume:

- status -> OPEN
- clear `followUpAt`
- keep person only if useful context; choose one deterministic rule and test it

### Cancel

- status -> CANCELLED
- legacy `done` -> false
- no longer appears in active attention/horizon
- preserve record and metadata
- show cancelled history separately from completed history or in a combined inactive section with clear labels

Delete remains actual record removal.

## Attention model

Extend Today attention without rewriting stored priority.

Recommended ordering:

1. overdue deadline
2. follow-up due (WAITING with followUpAt <= now)
3. reminder due (OPEN with remindAt <= now)
4. HIGH
5. MEDIUM
6. LOW

Within the same class:

- earlier relevant time/date first
- older created date
- deterministic ID tie-breaker

A future reminder alone should not make a task urgent before its time.

WAITING tasks whose follow-up is not due should not occupy the normal top-5 attention slots.

CANCELLED and DONE never appear in active attention or horizon.

The 45-day horizon remains due-date driven; reminder dates do not move tasks between due-date horizon buckets.

## Tasks page presentation

Rows/details should communicate, when present:

- workspace ownership
- priority
- due date
- reminder time
- waiting-for person and follow-up time
- recurrence
- status

Avoid visual overload. Secondary details may live in an expandable detail/action panel.

Keep Quick Add fast. Do not force reminder/waiting fields into the always-visible quick row.

A richer edit/details action may expose reminder and waiting controls.

## Today views

Personal Today uses the Personal roll-up set.

Indelitech Today uses Indelitech only.

Task attention should visibly distinguish:

- Overdue
- Follow-up due
- Reminder due

An Indelitech task shown in Personal still carries its Indelitech badge.

Do not create a standalone Reminders nav item.

## Do not implement in 1C-C

- AI/NL task parsing
- SEND TO TASKS ingestion endpoint
- automatic deadline inference
- automatic reminder-default selection
- reminder escalation policy
- background Cloudflare scheduled workers
- Telegram/email/push notifications
- Google Calendar sync
- production hosted D1 route wiring
- automatic task extraction from chats

This milestone is the task state/action model and in-app manual reminder/follow-up UX only.

## Required tests

At minimum prove:

1. legacy done task normalizes to DONE;
2. legacy open task normalizes to OPEN;
3. legacy recurring task infers RECURRING;
4. legacy dated one-time task infers DEADLINE;
5. due date and reminder remain independent;
6. snooze changes reminder only;
7. setting/changing reminder preserves due date;
8. waiting requires person and follow-up;
9. waiting task before follow-up is excluded from normal attention;
10. waiting task at/after follow-up surfaces as follow-up due;
11. resume waiting returns task to OPEN and applies the documented cleanup rule;
12. cancel preserves record and excludes it from active attention/horizon;
13. delete still removes the record;
14. reminder due outranks ordinary HIGH but not an overdue deadline;
15. future reminder does not artificially raise attention;
16. completed/cancelled tasks are excluded from active attention/horizon;
17. recurring completion preserves workspace ownership and status semantics;
18. completing a rolled-up Indelitech task from Personal still mutates the same ID;
19. America/New_York wall-clock <-> ISO helpers work across a DST transition;
20. no primary navigation reintroduces Reminders.

Preserve all existing task, recurrence, D1 visibility, workspace, and smoke tests.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run smoke`
- `git diff --check`

Node remains 24.19.0 in CI. Do not weaken engines if a local Codex container is older.

## PR shape

Work only on `feature/1c-c-task-actions-reminders`.

Keep the implementation reviewable and avoid unrelated Control Center refactors.

The eventual PR target is `milestone/1c-workspace-shell`, not `main`.

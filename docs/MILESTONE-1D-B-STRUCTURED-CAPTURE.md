# Milestone 1D-B — Structured SEND TO TASKS Capture

## Goal

Add a deterministic, typed task-capture contract and local API boundary that can safely create tasks using the atomic task mutation foundation completed in Milestone 1D-A.

This milestone is the app-side foundation for `SEND TO TASKS`.

It must preserve structured task meaning without requiring natural-language parsing inside the application.

The future chat/AI layer may interpret phrases such as "tomorrow morning" before calling this API, but this endpoint itself accepts concrete canonical values and never guesses important timing.

This milestone remains local/development-only. It does **not** expose a public Internet endpoint, add bearer-token authentication, deploy Cloudflare, or wire production D1.

## Core principle

Conversation or another approved client may decide that a task should be captured.

The application receives one structured capture request and converts it into exactly one canonical task record through the existing atomic task mutation service.

Do not create a second task store, side table, or alternate persistence path.

## Capture contract

Add a runtime-neutral typed capture input.

Recommended shape:

```ts
type StructuredTaskCapture = {
  requestId: string;
  workspaceId: "personal" | "indelitech";
  title: string;
  context?: string;
  category?: string;
  project?: string;
  person?: string;
  type?: "ONE_TIME" | "DEADLINE" | "FOLLOW_UP" | "WAITING" | "RECURRING" | "BACKLOG";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  due?: string | null;          // YYYY-MM-DD only
  remindAt?: string | null;     // ISO timestamp
  followUpAt?: string | null;   // ISO timestamp
  estimatedDuration?: "5m" | "15m" | "30m" | "1h" | "2h+" | "Project";
  recurrence?: "One-time" | "Daily" | "Weekly" | "Monthly";
  dependency?: string;
  sourceContext?: string;
};
```

Exact naming may differ if there is a clear architectural reason, but preserve the semantics.

`requestId` is required and supplies idempotency.

The API must reject arbitrary unvalidated partial task objects.

## TaskItem compatibility fields

Extend the active compatibility `TaskItem` model with optional canonical fields needed by structured capture:

- category
- project
- estimatedDuration
- dependency
- source
- sourceContext

Existing `person`, `type`, `priority`, `due`, `remindAt`, `followUpAt`, `recurrence`, ownership, timestamps, status, and recurrence metadata remain in place.

`cleanTaskItems()` must preserve and safely normalize these new optional fields.

Do not hide structured metadata by concatenating it into `description`.

Do not require the visible task UI to expose editors for all new metadata in this milestone.

## Diff/persistence compatibility

Update the canonical task-diff comparison so changes to newly supported structured fields are detected as UPDATEs.

The atomic 1D-A mutation repository remains the persistence path.

Capture must call the existing mutation repository/service boundary rather than replacing the full task list.

## Idempotency

Repeated delivery of the same `requestId` must never create duplicates.

Use a deterministic task ID derived from the capture request ID, for example:

`capture:<requestId>`

Validate `requestId` before using it.

Recommended constraints:

- trimmed non-empty string
- maximum 128 characters
- allow letters, numbers, `.`, `_`, `-`, and `:`
- reject whitespace-only and unsafe/unbounded values

Behavior:

- first valid request -> create task and return `created: true`
- same request ID delivered again for the same capture -> return the existing task and `created: false`
- if the deterministic ID already belongs to a task not created by structured capture or conflicts materially with the capture request -> return a conflict response rather than overwrite it

Do not mutate an existing task just because a reused request ID arrived.

## Workspace ownership

`workspaceId` is required at this machine/API boundary.

Accepted values only:

- `personal`
- `indelitech`

Do not default an invalid or missing workspace to Personal here.

The higher-level chat integration may infer the workspace from chat/project context before submitting the structured request.

Normal visibility still applies:

- Personal-owned -> Personal only
- Indelitech-owned -> Indelitech + Personal roll-up

## Timing rules

This milestone accepts concrete timing only.

### Due

`due` may be:

- omitted/null/empty -> no deadline
- `YYYY-MM-DD` -> canonical date-only due date

Reject natural-language values such as:

- tomorrow
- Friday
- next week

The future interpretation layer handles those.

Never invent a due date.

### Reminder

`remindAt` may be omitted/null or a valid ISO timestamp.

Normalize valid timestamps to ISO UTC using existing date handling.

Due date and reminder remain independent.

A reminder must never silently create/change a due date.

A due date must never silently create/change a reminder.

### Waiting/follow-up

If `type === "WAITING"`:

- `person` is required
- `followUpAt` is required and must be a valid timestamp
- resulting task status is `WAITING`

For non-WAITING captures, do not force follow-up fields.

### Recurring

If recurrence is Daily/Weekly/Monthly:

- resulting task type is RECURRING
- due date is required

If `type === "RECURRING"`, a non-One-time recurrence and due date are required.

Reject contradictory combinations rather than guessing.

### Backlog

BACKLOG may have no due/reminder.

Do not invent timing.

## Defaults

Safe defaults only:

- priority -> MEDIUM
- recurrence -> One-time
- type -> DEADLINE when due exists, otherwise ONE_TIME
- status -> OPEN unless WAITING
- source -> `send-to-tasks`

Do not default due to Today.

Do not default reminder to a future time.

## Source/context

Persist:

- `source = "send-to-tasks"`
- optional `sourceContext`

`context` maps to the task description/context field without inventing additional details.

If context is omitted, use the existing neutral description fallback.

## Capture API

Add a local route:

`POST /api/tasks/capture`

Use an injectable handler/service factory so the capture behavior is testable without HTTP/database coupling.

The handler should:

1. parse JSON safely;
2. validate the structured capture contract;
3. check idempotency against the current canonical task list;
4. convert the capture into one canonical TaskItem;
5. apply one atomic CREATE mutation through the existing TaskMutationRepository;
6. return the canonical saved task and a concise interpretation object.

Recommended response:

```json
{
  "created": true,
  "task": { ... },
  "interpretation": {
    "workspaceId": "indelitech",
    "type": "DEADLINE",
    "priority": "HIGH",
    "due": "2026-09-15",
    "remindAt": "2026-09-14T13:00:00.000Z"
  }
}
```

A repeated idempotent request returns `created: false`.

Validation errors -> 400.

Request-ID collision/conflict -> 409.

Unexpected persistence/read errors -> 500.

Do not reveal internal stack traces.

## Local-only security boundary

This route is not yet a public integration endpoint.

Do not add a fake bearer token or weak home-grown public authentication just to make it look external-ready.

Do not add CORS permissiveness.

Do not deploy it.

The production/authenticated capture boundary comes after hosted runtime composition and Access/auth design.

Document that `/api/tasks/capture` is local/development-only in 1D-B.

## UI behavior

No new full capture UI is required.

Existing Quick Add remains unchanged.

Do not add fake "AI capture" buttons.

If practical, add a small developer-facing example in the milestone doc/tests rather than visible UI.

## Tests

At minimum prove:

1. TaskItem normalizer preserves category/project/duration/dependency/source/sourceContext;
2. task diff detects a change to structured metadata as UPDATE;
3. valid Personal capture creates one Personal-owned task;
4. valid Indelitech capture creates one Indelitech-owned task;
5. captured Indelitech task remains visible in Personal through existing roll-up rules;
6. missing/invalid workspace is rejected instead of defaulting to Personal;
7. missing/blank title is rejected;
8. invalid requestId is rejected;
9. first requestId creates exactly one task;
10. exact replay of same requestId is idempotent and does not duplicate;
11. requestId collision with a non-capture/conflicting task returns conflict and does not overwrite;
12. omitted priority defaults MEDIUM;
13. omitted due remains no due date;
14. omitted reminder remains no reminder;
15. due YYYY-MM-DD is preserved exactly;
16. natural-language due is rejected;
17. reminder ISO timestamp normalizes to UTC;
18. due and reminder remain independent;
19. WAITING requires person + follow-up timestamp and produces WAITING status;
20. recurring capture requires due date;
21. recurring capture preserves recurrence/type;
22. BACKLOG can remain unscheduled;
23. source is `send-to-tasks`;
24. sourceContext round-trips;
25. API returns `created`, canonical task, and interpretation;
26. malformed JSON/payload returns 400 without persistence changes;
27. conflict returns 409 without persistence changes;
28. all Milestone 1C/1D-A task, recurrence, workspace, persistence, and smoke tests remain green.

## Validation

Run:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run smoke`
- `git diff --check`

CI Node remains 24.19.0.

## Do not implement in 1D-B

- natural-language parsing;
- LLM calls;
- automatic extraction from arbitrary chats;
- public bearer-token ingestion;
- Cloudflare Access;
- production D1 route composition;
- Cloudflare deployment;
- Telegram/email/push notifications;
- background reminder workers;
- Google Calendar synchronization;
- generic webhook system;
- unrelated Control Center refactors.

## Branch / PR

Work on:

`milestone/1d-b-structured-capture`

PR target:

`main`

Keep the PR focused on structured capture only.

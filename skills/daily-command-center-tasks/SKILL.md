---
name: daily-command-center-tasks
description: Capture user-authorized tasks into Daily Command Center, especially when the user says SEND TO TASKS or explicitly asks to add, save, or put an action on their task list.
---

# Daily Command Center task capture

Use this skill when the user explicitly wants an action recorded in Daily Command Center or when you have identified a likely action and need to offer capture.

The user's explicit instructions take precedence over this skill.

## Canonical command

`SEND TO TASKS` is the stable, low-ambiguity command for an explicit capture request.

Treat equivalent direct instructions such as “add that to my tasks,” “put that on my list,” “save this as a task,” or “add that to Indelitech” as explicit capture authorization too.

## Workflow

1. Reuse the current conversation context. Do not ask the user to repeat fields already clear from the conversation.
2. For an explicit capture request, use the available Daily Command Center task action directly when the title and workspace are unambiguous. Do not require a second confirmation merely because a write action is involved at the skill level. The ChatGPT product may still apply its own action-approval step.
3. If a materially required field is ambiguous, ask only the minimum clarification needed. Workspace is required. Optional unknown fields should usually be omitted rather than invented.
4. Do not invent a due date, reminder, recurrence, workspace, priority, duration, dependency, or other material detail.
5. Preserve useful task-specific diagnostic or planning context, but keep it bounded. Do not copy unrelated or unnecessarily sensitive conversation content into the task.
6. Do not create a task merely because a likely action appears in ordinary conversation. Ask whether the user wants it added to Daily Command Center. A clear “yes,” “do it,” “add it,” or equivalent reply authorizes the capture using the already-known context.
7. Use a preview/review action only when the exact interpretation itself needs user review before saving. Do not make preview a mandatory first step for an unambiguous explicit request.
8. Do not claim success unless the Daily Command Center action succeeds. If the capability is unavailable on the current ChatGPT surface, say that the task could not be written from that surface rather than pretending it was saved.

## Authorization boundary

Never bypass the Daily Command Center backend. The app/server must authenticate the actual user, resolve the logical workspace to that user's physical workspace instance, validate membership, and fail closed for unauthorized, disabled, unmapped, or forged workspace access.

Users should only work with logical workspace names such as `personal` and `indelitech`; never ask them for a physical workspace ID.

## Final checks

Before a write, verify that the user has explicitly requested or confirmed capture, the title is clear, the workspace is clear, and no material fields were fabricated. After the write, report the result concisely.

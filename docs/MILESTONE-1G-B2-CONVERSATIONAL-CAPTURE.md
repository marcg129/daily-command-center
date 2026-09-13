# Milestone 1G-B2 — Conversational task capture

Date: 2026-09-13

Branch: `milestone/1g-b2-conversational-capture`

Status: **Complete, merged, deployed, and verified.**

## Objective

Make Daily Command Center task capture behave naturally when the capability is available to a ChatGPT conversation: explicit capture requests should reuse known conversation context and write without a redundant second confirmation, while tasks merely inferred from ordinary conversation must still wait for the user's approval.

The canonical explicit command is:

`SEND TO TASKS`

## Platform-capability gate

Reviewed against current OpenAI product documentation on 2026-09-13:

- Plugins package reusable instructions, connected apps, and other capabilities. ChatGPT can expose `@` or `+` invocation controls where the current plan/surface supports them, but availability varies by account, workspace, role, and surface: https://help.openai.com/en/articles/20001256/
- Current custom MCP write/modify support in ChatGPT developer mode is product-controlled and plan/surface dependent. App selection is message-scoped, and write actions may receive ChatGPT-level confirmation based on permissions/context: https://help.openai.com/en/articles/12584461
- Skills can be applied automatically when available, but current ChatGPT Skill availability depends on eligible workspace plans/settings and product surface: https://help.openai.com/en/articles/20001066
- OpenAI describes a skill as a folder/workflow whose instructions are typically stored in `SKILL.md`: https://openai.com/academy/skills/

### Project conclusion

Daily Command Center can control its MCP tool names, descriptions, schemas, server instructions, authentication, authorization, persistence, and a future-ready Skill artifact. It cannot force ChatGPT to expose the app in the `@` picker, make the capability available in every conversation, suppress a platform-required write confirmation, or guarantee automatic Skill routing on a surface where Skills are unavailable.

The user's current ordinary ChatGPT surface does not reliably expose Daily Command Center in the `@` picker, so `@Daily Command Center` is not an acceptance requirement for this milestone.

## 1G-B2 interaction contract

### Explicit capture

The following are user-authorized writes when the task and workspace are otherwise unambiguous:

- `SEND TO TASKS`
- “Add that to my tasks.”
- “Put that on my list.”
- “Save this as a task.”
- “Add that to Indelitech.”

For these requests, the MCP metadata instructs ChatGPT to call `create_task` directly using clear fields already present in the conversation. It must not force `preview_task` first, ask the user to restate known details, or add a second application-level confirmation.

`confirmedByUser=true` means the user either issued an explicit capture instruction or explicitly confirmed an earlier capture suggestion/proposal. It does not mean a preview must have occurred.

### Inferred capture

If ChatGPT notices a likely action during ordinary conversation, it must not write silently. It should ask whether the user wants the action added to Daily Command Center. A clear affirmative response then authorizes the write using the existing context.

### Ambiguity

Clarify only materially required ambiguity. The current capture contract requires a logical workspace (`personal` or `indelitech`), so unresolved workspace ambiguity must be clarified. Optional fields that are unknown should be omitted. Dates, reminders, recurrence, priority, duration, dependencies, and other material details must not be invented.

`preview_task` remains available as a read-only review path when the exact interpretation itself needs user review before saving. It is no longer a mandatory prerequisite for every write.

## Security and identity boundary

1G-B2 reuses the 1G-B1 authorization chain rather than adding a separate chat identity model:

verified Cloudflare Access principal → active application user → logical workspace membership → exact physical workspace instance → canonical D1 task persistence.

The browser/task model continues using logical workspace names. Physical workspace IDs remain server-side. A forged physical workspace ID is rejected before it can become a capture target.

A user cannot capture into another user's Personal workspace by saying `personal`; that logical key resolves to the authenticated user's own physical Personal instance. A user without Indelitech membership cannot capture into `indelitech`.

## Future-ready Skill

`skills/daily-command-center-tasks/SKILL.md` packages the same conversational contract for surfaces where Skills are supported. It deliberately contains no persistence implementation or alternate authorization path. The Skill may guide ChatGPT to the app/tool, but the MCP/backend remains authoritative for every write.

## Validation targets

- Explicit authorized capture can call `create_task` directly without a preview.
- Missing user authorization still fails before persistence.
- `SEND TO TASKS` appears in MCP metadata and the Skill.
- Inferred tasks remain confirmation-gated.
- Known context is reused instead of being restated.
- Optional unknown fields are omitted rather than fabricated.
- Same logical Personal key resolves to different physical workspace rows for different users.
- Cross-user reads remain isolated.
- Unauthorized Indelitech capture is denied.
- Forged physical workspace selectors are rejected.
- Disabled and unmapped principals fail closed.
- Request ID replay remains idempotent.

## Deferred platform behavior

This milestone does not claim or require:

- universal automatic custom-app selection in ordinary ChatGPT chats;
- `@Daily Command Center` availability on the user's current surface;
- bypassing ChatGPT's own action-approval UI;
- Household UI, Bills, invitations, domain/DNS changes, PWA/native work, or widgets.

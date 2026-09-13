# Project roadmap

Last updated: 2026-09-13

This document is the canonical near-term delivery order. Milestone implementation
notes describe what shipped; this roadmap records what is complete, what is active,
and what is intentionally deferred.

## Milestone status

| Milestone | Status                                       | Scope                                                                                 |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1G-A      | **Complete, merged, deployed, and verified** | Durable user, principal, and workspace-membership authorization foundation            |
| 1G-B      | **Active**                                   | True multi-user identity, conversational task capture, and stronger overdue treatment |
| 1G-C      | **Later**                                    | `command.coreyg.dev` and related domain work                                          |

Milestone 1G-A is closed. Do not reopen it unless a regression or security problem
is discovered. Follow-on identity and capture work belongs to 1G-B.

## Milestone 1G-B — True Multi-User Identity + Conversational Task Capture

### Goal

Move from the migrated legacy-owner identity model to a durable true multi-user
experience, and make ChatGPT task capture resolve a real Command Center user and
authorized workspace. Preserve all server-side authorization and isolation
guarantees established in 1G-A.

Deliver the milestone in this order:

1. Implement and verify 1G-B1 true multi-user identity and physical workspace instances.
2. Complete the ChatGPT platform-capability gate, then implement 1G-B2.
3. Test cross-user and cross-workspace capture authorization.
4. Implement 1G-B3 as a separate, tightly scoped UI pull request.
5. Leave 1G-C as the later domain milestone.

### 1G-B1 — True multi-user identity

Implement the smallest safe path that:

- resolves a cryptographically verified Cloudflare Access identity to the correct
  active Command Center user;
- loads only workspaces in which that user has an active membership;
- preserves Marc's current Personal and Indelitech behavior;
- supports separate physical Personal workspace instances for Marc, Christa, and
  Marc's sister while keeping the public product slot named `personal`;
- supports a future shared Household workspace without adding Household UI now;
- keeps physical workspace IDs server-side and exposes only safe logical workspace
  choices to the browser;
- enforces authorization and workspace isolation on the server for every hosted
  read and mutation;
- never exposes another user's private resources; and
- fails closed when the user mapping, user state, or workspace membership cannot
  be established.

The smallest safe implementation may add provisioning or administrative support
needed to create and link durable users, principals, and memberships. It must not
add invitations, Household product UI, Bills, or domain changes unless a narrowly
scoped identity-architecture requirement makes one unavoidable.

#### 1G-B1 acceptance criteria

- Each supported Access principal resolves to exactly one active application user.
- The hosted session/bootstrap response contains only that user's authorized
  logical workspace choices and safe display metadata.
- Marc continues to see and use Personal and Indelitech without a data migration
  regression.
- A second user can map logical Personal to a distinct physical workspace without
  inheriting Marc's Personal or Indelitech access.
- A disabled user, unmapped principal, missing membership, duplicate/ambiguous
  identity mapping, or unknown workspace is denied.
- Directly supplied physical workspace IDs cannot bypass membership checks.
- Cross-user task, visibility, collector snapshot, and workspace-domain reads and
  mutations remain isolated by physical workspace instance.
- Marc's existing Indelitech-to-Personal task roll-up remains intact without moving
  existing production task rows.

### 1G-B2 — Daily Command Center conversational task-capture Skill

Make the existing Daily Command Center task-capture capability usable as naturally
as the current ChatGPT platform permits. The backend remains authoritative for
identity, authorization, interpretation, and persistence. ChatGPT invocation
mechanics must remain replaceable so future platform improvements do not require a
backend redesign.

#### Platform-capability gate

Before writing 1G-B2 implementation code, verify the current supported ChatGPT
custom-app/plugin/Skill invocation model against current official platform behavior
and record the result in the milestone implementation note.

Current observed constraint for this project: the Daily Command Center task app is
not presently offered in the user's `@` selector in ordinary ChatGPT conversations.
Therefore, `@Daily Command Center` must NOT be an acceptance requirement for 1G-B2.
If explicit app/Skill selection becomes available later, support it as an additional
fallback rather than redesigning the capture backend around it.

Keep the ownership boundary explicit:

| Daily Command Center controls                                               | ChatGPT product controls                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tool/app names, descriptions, schemas, response shape, and error guidance   | Whether an app or Skill is available or automatically selected for a message   |
| Authentication handoff and application-user resolution                      | `@`, picker, Project, or other invocation surfaces available to the user        |
| Server-side workspace authorization and task persistence                    | When ChatGPT elects to offer or call an available capability                   |
| Skill instructions and examples packaged with the integration where allowed | The surrounding conversation context and automatic Skill-routing behavior      |

Do not claim that Command Center code can make its ChatGPT app automatically
available in every conversation. Optimize every integration surface we do control,
document the minimum current user interaction honestly, and keep explicit fallbacks.

#### Canonical explicit command

Adopt the phrase:

`SEND TO TASKS`

as the stable human-readable command for Daily Command Center task capture.

A message that clearly uses `SEND TO TASKS` to supply or refer to an action is an
explicit request to create the task. The capture workflow should not ask for a
second confirmation unless a materially required field is ambiguous or the
requested workspace cannot be safely resolved.

Example:

```text
SEND TO TASKS
Task: Test ChatGPT performance after reboot using a fresh chat and Firefox
When: Next convenient work session
Workspace: Indelitech
Priority: Low
```

Include `SEND TO TASKS` prominently in Skill instructions, app/tool descriptions,
and examples so that any ChatGPT surface capable of automatic capability selection
has a strong, low-ambiguity routing signal. Treat it as an application-level command
contract, not as a guaranteed ChatGPT platform-level selector.

#### Skill/package direction

Where the current ChatGPT platform permits it, package a dedicated Daily Command
Center task-capture Skill around the existing app/MCP task actions.

The Skill owns conversational behavior such as:

- recognizing explicit capture intent;
- recognizing the `SEND TO TASKS` command;
- using already-known conversation context;
- asking for confirmation when a task is only inferred; and
- requesting the minimum clarification when a required field is materially
  ambiguous.

The underlying app/MCP action owns the actual authorized write. Do not duplicate
persistence, user resolution, workspace membership checks, or task business rules
inside the Skill.

If the user's current ChatGPT plan/surface cannot install or automatically invoke
that Skill, keep the Skill/package in the repository as a future-ready artifact and
optimize the currently available app/MCP metadata instead. Do not make unsupported
Skill availability a blocker for the secure capture backend.

#### Capture behavior

For explicit requests such as “Add that to my tasks,” “Put that on my list,”
“Add that to Indelitech,” or a `SEND TO TASKS` block, the integration should create
a task using details already clear in the conversation. The user should not have to
repeat a known title, workspace, due date, priority, context, recurrence, category,
or estimate.

If ChatGPT identifies a likely action during ordinary conversation, it must not
silently create a task. Preferred behavior is:

“Want me to add that to your Command Center?”

A user confirmation such as “yes,” “do it,” “add it,” or “put it on my list” then
becomes explicit capture authorization and may reuse the existing conversation
context.

Useful diagnostic or planning context should be stored in the task description or
context field. Dates, priorities, recurrence, workspace, or other material details
must not be invented when ambiguous. Existing preview/confirmation behavior may be
simplified only where the explicit user instruction or confirmation provides
equivalent authorization.

#### Authorization requirements

Every capture must:

- authenticate and resolve the actual Command Center application user;
- resolve a logical requested workspace such as Personal to that user's exact
  physical workspace instance;
- validate the requested workspace against that user's memberships on the server;
- reject an unauthorized or forged physical workspace ID even if ChatGPT supplies
  it;
- never default an unknown authenticated principal to Marc; and
- fail closed when identity or workspace authorization is missing or ambiguous.

The same phrase therefore has user-specific behavior:

- Marc: “Add that to Personal” → Marc's physical Personal workspace.
- Christa: “Add that to Personal” → Christa's different physical Personal workspace.

Neither user should need to know a physical workspace ID.

#### 1G-B2 acceptance criteria

- `SEND TO TASKS` is documented as the canonical explicit capture command and is
  represented in available Skill/app/tool metadata.
- An explicit capture with complete conversational context can be completed without
  restating known fields when the Daily Command Center capability is available to
  the conversation.
- A materially ambiguous field is omitted, given a safe existing product default,
  or clarified; it is not fabricated.
- A likely task inferred from ordinary conversation requires user confirmation
  before creation.
- Captured context is useful and bounded, without copying unnecessary sensitive
  conversation content.
- The same application-user and physical-workspace boundary used by hosted routes
  protects conversational capture.
- Tests prove same-user/same-workspace success, cross-user denial,
  cross-workspace denial, disabled/unmapped-user denial, forged-physical-workspace
  denial, and accidental duplicate/replay safety.
- Documentation states the current ChatGPT invocation limitations and distinguishes
  them from behavior controlled by Command Center.
- `@` invocation is tested/documented only if the user's current ChatGPT surface
  actually exposes the installed Daily Command Center capability; its absence does
  not fail the milestone.

### 1G-B3 — Stronger overdue visual treatment

Deliver this work only after the identity/capture work, in a separate focused UI
pull request. The hosted Today case with a task due yesterday is the primary
acceptance case.

Required behavior:

- overdue tasks sort above tasks due today;
- overdue status is immediately recognizable but restrained;
- use the existing design system with an accessible danger/red accent, considering
  a left danger border and lightly tinted background;
- replace the tiny status text with a stronger badge such as
  `OVERDUE · 1 DAY`;
- make the Overdue row in the 45-day horizon visually distinct;
- show an overdue count prominently near “Needs action today” when applicable;
- keep priority visually and semantically separate from overdue status; and
- do not use flashing or pulsing animation.

#### 1G-B3 acceptance criteria

- A task due yesterday is unmistakably overdue on Today and relevant task views.
- Overdue items precede due-today items without changing priority semantics.
- Singular/plural overdue age and count text is correct.
- Light and dark themes meet the project's accessibility and contrast expectations.
- Keyboard, screen-reader, reduced-motion, narrow-screen, and existing task-action
  behavior do not regress.

## Explicitly deferred from 1G-B

Do not bundle any of the following into 1G-B:

- Bills or banking integrations;
- Household product UI;
- invitations;
- PWA or native mobile work;
- widgets;
- DNS migration or `command.coreyg.dev` domain changes; or
- unrelated feature-level RBAC expansion.

The `command.coreyg.dev` and domain transition remains Milestone 1G-C.

# Project roadmap

Last updated: 2026-09-13

This document is the canonical near-term delivery order. Milestone implementation
notes describe what shipped; this roadmap records what is complete, what is active,
and what is intentionally deferred.

## Milestone status

| Milestone | Status                                       | Scope                                                                                 |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1G-A      | **Complete, merged, deployed, and verified** | Durable user, principal, and workspace-membership authorization foundation            |
| 1G-B      | **Active next milestone**                    | True multi-user identity, conversational task capture, and stronger overdue treatment |
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

1. Inspect current `main` after the deployed and verified 1G-A release.
2. Implement 1G-B1 true multi-user identity.
3. Complete the ChatGPT platform-capability gate, then implement 1G-B2.
4. Test cross-user and cross-workspace capture authorization.
5. Implement 1G-B3 as a separate, tightly scoped UI pull request.
6. Leave 1G-C as the later domain milestone.

### 1G-B1 — True multi-user identity

Implement the smallest safe path that:

- resolves a cryptographically verified Cloudflare Access identity to the correct
  active Command Center user;
- loads only workspaces in which that user has an active membership;
- preserves Marc's current Personal and Indelitech behavior;
- supports the identity architecture needed for separate Personal workspaces for
  Christa and Marc's sister;
- supports a future shared Household workspace without adding Household UI now;
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
  workspace choices and safe display metadata.
- Marc continues to see and use Personal and Indelitech without a data migration
  regression.
- A second user can have a distinct Personal workspace without inheriting Marc's
  Personal or Indelitech access.
- A disabled user, unmapped principal, missing membership, duplicate/ambiguous
  identity mapping, or unknown workspace is denied.
- Directly supplied workspace IDs cannot bypass membership checks.
- Cross-user task, visibility, Intel, and workspace-domain reads and mutations
  remain denied at the server boundary.

### 1G-B2 — Conversational ChatGPT task capture

Review and update the existing MCP/plugin capture integration so explicit capture
can reuse unambiguous conversation context instead of asking the user to restate
known fields.

#### Platform-capability gate

Before writing 1G-B2 implementation code, verify the current supported ChatGPT
custom-app/plugin invocation model against current official platform documentation
and record the result in the milestone implementation note.

Keep the ownership boundary explicit:

| Daily Command Center controls                                               | ChatGPT product controls                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tool names, descriptions, input schemas, response shape, and error guidance | Whether an app must be selected, mentioned, or otherwise invoked for a message |
| Authentication handoff and application-user resolution                      | Automatic availability or routing of a custom app in arbitrary conversations   |
| Server-side workspace authorization and task persistence                    | When ChatGPT elects to offer or call an available tool                         |
| Context fields accepted from a tool call and ambiguity validation           | The surrounding conversation context supplied to the tool                      |

Do not claim that Command Center code can make its ChatGPT app automatically
available in every conversation when the platform requires selection or explicit
invocation. Optimize the integration for the most natural supported flow, document
the minimum user interaction currently required, and keep the backend independent
of invocation mechanics so future automatic routing does not require a redesign.

#### Capture behavior

For explicit requests such as “Add that to my tasks,” “Put that on my list,” or
“Add that to Indelitech,” the integration should create a task using details that
are already clear in the conversation. The user should not have to repeat a known
title, workspace, due date, priority, context, recurrence, or estimate.

If ChatGPT identifies a likely action during ordinary conversation, it must not
silently create a task. The preferred interaction is: “Want me to add that to your
Command Center?” A confirmed capture may then use the existing conversation
context.

Useful diagnostic or planning context should be stored in the task description or
context field. Dates, priorities, recurrence, workspace, or other material details
must not be invented when ambiguous. Existing preview/confirmation behavior may be
simplified only where the platform interaction and user intent provide equivalent
explicit confirmation.

#### Authorization requirements

Every capture must:

- authenticate and resolve the actual Command Center application user;
- validate the requested workspace against that user's memberships on the server;
- reject an unauthorized workspace ID even if ChatGPT supplies it;
- never default an unknown authenticated principal to Marc; and
- fail closed when identity or workspace authorization is missing or ambiguous.

#### 1G-B2 acceptance criteria

- An explicit capture with complete conversational context can be completed
  without restating known fields.
- A materially ambiguous field is omitted, given a safe product default only when
  already defined by the application, or clarified with the user; it is not
  fabricated.
- A likely task inferred from ordinary conversation requires user confirmation
  before creation.
- Captured context is useful and bounded, without copying unnecessary sensitive
  conversation content.
- The same application user and membership boundary used by hosted routes protects
  MCP/plugin capture.
- Tests prove same-user/same-workspace success, cross-user denial,
  cross-workspace denial, disabled/unmapped-user denial, and forged-workspace-ID
  denial.
- Documentation states the current ChatGPT invocation requirement and distinguishes
  it from behavior controlled by Command Center.

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

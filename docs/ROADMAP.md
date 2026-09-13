# Project roadmap

Last updated: 2026-09-13

This document is the canonical near-term delivery order. Completed milestone notes preserve implementation detail; this roadmap records the current boundary and what comes next.

## Milestone status

| Milestone | Status | Scope |
| --- | --- | --- |
| 1G-A | **Complete, merged, deployed, and verified** | Durable application users, principals, workspace memberships, and server authorization |
| 1G-B | **Complete, merged, deployed, and verified** | Physical per-user workspace isolation, conversational ChatGPT task capture, and stronger overdue treatment |
| 1G-C | **Active next milestone** | Move the user-facing web app to `command.coreyg.dev` while preserving Cloudflare Access protection and rollback safety |

Milestones 1G-A and 1G-B are closed. Do not reopen them unless a regression or security problem is discovered.

## Milestone 1G-A — User/workspace ownership foundation

Completed and verified in production.

Delivered:

- durable application users;
- cryptographically verified authentication-principal mappings;
- role-bearing workspace memberships;
- membership-based server authorization; and
- fail-closed cross-user/cross-workspace protection.

See `docs/MILESTONE-1G-A-USER-WORKSPACE-OWNERSHIP.md` for implementation detail.

## Milestone 1G-B — Multi-user identity + conversational task capture

Completed and verified in production on 2026-09-13.

### 1G-B1 — Physical workspace instances

Delivered:

- separation of the logical user-facing workspace key (`personal` / `indelitech`) from the exact physical D1 workspace ID;
- preservation of Marc's existing physical `personal` and `indelitech` rows without moving production data;
- support for another user to map logical Personal to a different physical workspace;
- physical-workspace isolation for tasks, visibility, collector snapshots, and workspace-domain data;
- an explicit physical `workspace_rollups` policy preserving Marc's Indelitech-to-Personal roll-up; and
- fail-closed handling for unmapped, disabled, ambiguous, unauthorized, or forged workspace access.

See `docs/MILESTONE-1G-B1-WORKSPACE-INSTANCES.md`.

### 1G-B2 — Conversational Daily Command Center capture

Delivered:

- `SEND TO TASKS` as the canonical explicit capture command;
- direct `create_task` for an unambiguous explicit user capture request without a mandatory preview/reconfirmation loop;
- confirmation before persistence when a task is merely inferred from ordinary conversation;
- reuse of clear conversation context without asking the user to restate known fields;
- a future-ready `skills/daily-command-center-tasks/SKILL.md` artifact;
- documented ChatGPT platform limitations around app/Skill availability, `@` invocation, and product-level action confirmation; and
- capture tests proving the same per-user physical-workspace boundary used by hosted routes.

The backend remains authoritative for identity, workspace membership, authorization, idempotency, and persistence. ChatGPT invocation mechanics are intentionally replaceable.

See `docs/MILESTONE-1G-B2-CONVERSATIONAL-CAPTURE.md`.

### 1G-B3 — Stronger overdue visibility

Delivered:

- deterministic product-timezone overdue age labels such as `OVERDUE · 1 DAY`;
- a prominent overdue count near “Needs action today”;
- restrained danger-border/tint treatment for overdue Today cards and canonical task rows;
- a visually distinct 45-day Overdue horizon row;
- separate overdue and priority signals; and
- explicit light/dark styling with no flashing or urgency animation.

The existing overdue-first attention ordering and stored priority semantics were preserved.

See `docs/MILESTONE-1G-B3-OVERDUE-VISIBILITY.md`.

## Milestone 1G-C — `command.coreyg.dev` custom domain

### Goal

Make `https://command.coreyg.dev` the canonical user-facing web address for Daily Command Center without weakening Cloudflare Access, changing application data, or coupling the web-domain transition to the separate task-capture MCP endpoint.

The current web deployment is a Cloudflare Worker, so this milestone should use a **Worker Custom Domain**, not a Pages-domain migration. Cloudflare can attach a Custom Domain directly to a Worker, create the DNS record, and provision the certificate when the hostname belongs to an active Cloudflare zone.

### Preconditions

Before changing production routing, verify in Cloudflare that:

- `coreyg.dev` is an active zone in the same Cloudflare account, or onboard it and complete the registrar nameserver change first;
- `command.coreyg.dev` does not already have a conflicting CNAME or other incompatible DNS record; and
- the existing Daily Command Center Access application can be extended to protect `command.coreyg.dev` while preserving its current policies and application audience.

Do not guess these account-level facts from repository configuration.

### Delivery order

1. Record the current production Worker, Access application, audience, and rollback hostname before any routing change.
2. Add `command.coreyg.dev` as the web Worker's Custom Domain using Wrangler configuration (`custom_domain: true`) only after the Cloudflare zone prerequisite is confirmed.
3. Add/protect the new public hostname in the existing Cloudflare Access application when possible so the current policy and audience remain stable. Do not create a replacement Access application unless the existing one cannot safely cover the hostname.
4. Update protected-deploy validation so the committed custom-domain posture is checked before deployment.
5. Deploy through the existing owner-authorized current-main gate.
6. Verify from the public Internet that unauthenticated access is intercepted by Access and authenticated access reaches the same hosted application/session/workspace boundary.
7. Verify hosted APIs, Personal/Indelitech switching, task reads/writes, Intel, and existing identity isolation through the new hostname.
8. Keep the current Access-protected `workers.dev` web hostname only as a short rollback path during cutover. After the custom domain is verified, decide in a separate hardening step whether to disable the web Worker's `workers.dev` route. Do not change the MCP Worker's hostname merely to match the web domain.

### 1G-C acceptance criteria

- `https://command.coreyg.dev` resolves to the production Daily Command Center Worker with a valid Cloudflare-managed certificate.
- An unauthenticated request to the custom hostname cannot reach application content without passing Cloudflare Access.
- The existing authorized user still resolves to the same application user and logical Personal/Indelitech memberships.
- No task, workspace, D1, KV, Intel, or MCP data migration is required.
- Cross-user and cross-workspace authorization remains unchanged.
- The protected deployment workflow verifies the committed domain/security posture before deploying.
- The old web hostname is either retained temporarily as an Access-protected rollback path or intentionally retired after verification; it is never left as an unprotected bypass.
- The task-capture MCP endpoint remains independent unless a separate tested migration is intentionally approved.

### Explicitly deferred beyond 1G-C

Do not bundle the following into the domain transition:

- Household product UI or invitations;
- Bills, banking, or full budgeting;
- PWA/native mobile packaging;
- Home Screen or Lock Screen widgets;
- location/Focus behavior; or
- unrelated feature-level RBAC expansion.

Those belong to later productization milestones after the canonical web domain is stable.

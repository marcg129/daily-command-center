# Milestone 1G-B — Closeout

Date: 2026-09-13

Status: **Complete, merged, deployed, and verified.**

## Production revision

Milestone 1G-B closed after PR #55 merged and the resulting `main` revision `534bbaa683705098f3fdc24b9b131980abfd9ace` passed the independent Ubuntu/macOS/Windows matrix and the protected Cloudflare production deployment.

## Delivered slices

### 1G-B1 — Multi-user identity / physical workspace instances

- verified Access principals resolve to durable application users;
- public logical workspace names resolve to exact per-user physical D1 boundaries;
- Marc's existing Personal and Indelitech data remained in place;
- separate users can own separate physical Personal workspaces; and
- task, visibility, collector-snapshot, and workspace-domain boundaries fail closed across users.

### 1G-B2 — Conversational task capture

- `SEND TO TASKS` is the canonical explicit capture command;
- explicit, unambiguous requests can write without a redundant preview/reconfirmation loop;
- inferred tasks still require user confirmation;
- conversation context can supply already-known task fields; and
- the same authenticated application-user/workspace boundary protects MCP capture.

### 1G-B3 — Overdue visibility

- overdue work now has explicit age badges and a prominent Today overdue count;
- Today cards, the 45-day Overdue row, and canonical task rows receive restrained danger treatment;
- priority remains a separate signal; and
- light/dark styling uses no urgency animation.

## Verification boundary

The final milestone state passed:

- pull-request CI on Ubuntu, macOS, and Windows;
- merged-`main` CI on Ubuntu, macOS, and Windows;
- repository tests/build;
- task-capture MCP build;
- hosted Intel Worker build;
- smoke checks;
- protected production configuration validation;
- current D1 migration validation;
- production web Worker deployment;
- cron-only Intel Worker deployment;
- fail-closed MCP Worker deployment; and
- final deployment-posture validation.

## Next milestone

Milestone 1G-C owns the canonical web-domain transition to `command.coreyg.dev`. Domain/DNS/Access routing work must not be mixed back into 1G-B.

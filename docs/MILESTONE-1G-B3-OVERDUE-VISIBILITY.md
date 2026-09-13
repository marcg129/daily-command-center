# Milestone 1G-B3 — Stronger overdue visibility

Date: 2026-09-13

Branch: `milestone/1g-b3-overdue-visibility`

Status: **Complete, merged, deployed, and verified.**

## Objective

Make overdue work unmistakable at a glance without changing stored priority semantics or adding distracting motion. The primary acceptance case is a hosted Today task due yesterday.

## Implementation

- Existing attention ordering remains authoritative: overdue items already sort ahead of due-today/high-priority work.
- Added deterministic product-timezone overdue age copy: `OVERDUE · 1 DAY`, `OVERDUE · N DAYS`, and `OVERDUE · TODAY` for an already-late timestamp on the current product day.
- Today attention cards use a restrained danger left border/tint and a text badge, while the existing priority badge remains a separate signal.
- The Today panel shows a dedicated overdue count near the total attention count.
- The 45-day horizon gives its Overdue row distinct danger treatment.
- Canonical task rows show the same overdue badge plus the original due value.
- Light and dark themes receive explicit overdue tokens.
- Overdue treatment has no animation, flashing, or pulsing behavior.

## Non-goals

This slice does not alter task persistence, due-date rules, recurrence, priority values, workspace authorization, conversational capture, navigation, or notification behavior.

## Validation

The focused PR and the merged `main` revision both passed the full Ubuntu, macOS, and Windows CI matrix, including repository checks, MCP build, Intel Worker build, and smoke tests. The protected production deployment completed successfully for the web Worker, Intel Worker, MCP Worker, and final deployment-posture validation.

Validated behavior:

- A task due yesterday reads `OVERDUE · 1 DAY`.
- Singular/plural labels are correct.
- Same-day late timestamps do not claim a full day late.
- Overdue items remain ahead of due-today items without changing priority semantics.
- Today exposes both total attention and overdue count.
- Overdue status is textually and visually distinct from priority.
- The 45-day Overdue row is visually distinct.
- Light/dark tokens exist and overdue styling uses no motion.
- Existing keyboard/task-action behavior and responsive layout continue to pass the full repository CI matrix.

# Milestone 1E-D validation note

This note records the final review correction used to validate the hosted task-surface adapter.

- Hosted timestamp due values remain full timestamps when mapped into the UI compatibility model.
- Task attention and the 45-day horizon evaluate those timestamps as real due instants instead of treating them as unscheduled.
- Date-only due values and legacy `Today` behavior remain unchanged.
- The hosted D1 mutation adapter still preserves one-record workspace roll-up semantics and atomic recurring completion.

The final PR candidate must pass the normal Ubuntu, macOS, and Windows check/smoke matrix before merge.

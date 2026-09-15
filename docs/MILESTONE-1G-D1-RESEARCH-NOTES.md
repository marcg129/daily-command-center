# Milestone 1G-D1 — current implementation research notes

Verified: 2026-09-13/14

Purpose: preserve the external technical facts used by the 1G-D1 implementation plan so the coding session does not need to rediscover them.

## Cloudflare D1

### STRICT tables and integers

Cloudflare currently recommends SQLite `STRICT` tables for D1 schemas to avoid stored-type mismatches.

D1 stores SQLite `INTEGER` values as 64-bit signed integers internally, but Cloudflare's Worker API does not support JavaScript BigInt values for D1 binding writes. JavaScript numbers are only exact through `Number.MAX_SAFE_INTEGER`.

Therefore the Bills schema intentionally limits monetary minor-unit integers to `9007199254740991` even though SQLite/D1 can internally store a larger signed integer.

Source:

https://developers.cloudflare.com/d1/worker-api/

### `batch()` atomicity

Cloudflare documents `D1Database.batch()` as a SQL transaction. Statements execute sequentially; if a statement fails, the sequence aborts/rolls back.

This is appropriate for later 1G-D2 operations such as:

- create Bill + initial occurrences;
- resolve occurrence + replenish materialization horizon; and
- schedule-edit lifecycle changes that must not partially persist.

Source:

https://developers.cloudflare.com/d1/worker-api/d1-database/

### Migrations

D1 migrations are sequential `.sql` files recorded in the D1 migrations table. `wrangler d1 migrations apply` applies unapplied migrations in sequence.

Cloudflare's current Wrangler documentation states that a backup is captured after applying migrations. If a migration errors, that migration is rolled back while prior successful migrations remain applied.

Therefore 1G-D1 should:

- use the next free migration number on current main;
- never rewrite/renumber an already deployed migration;
- keep the Bills migration additive; and
- rely on the protected existing deployment workflow to apply it before Worker deployment.

Sources:

https://developers.cloudflare.com/d1/reference/migrations/

https://developers.cloudflare.com/d1/wrangler-commands/

### Foreign keys

Cloudflare documents D1 as enforcing foreign-key constraints by default for queries and migrations, equivalent to SQLite with foreign keys enabled.

`PRAGMA defer_foreign_keys = true` is available when a migration temporarily violates relationships while rebuilding tables. The planned Bills migration only creates new tables referencing already-existing `workspaces` and `users`, so no deferral is required.

Source:

https://developers.cloudflare.com/d1/sql-api/foreign-keys/

### SQLite compatibility/schema inspection

D1 uses SQLite SQL semantics and supports schema inspection including `PRAGMA table_list`, `PRAGMA table_info`, and `sqlite_master`. `PRAGMA table_list` exposes whether a table is STRICT.

The repo's existing Node 24 `node:sqlite` tests are therefore an appropriate fast schema/migration validation layer, while the existing protected D1 deployment remains the real production migration gate.

Source:

https://developers.cloudflare.com/d1/sql-api/sql-statements/

## Repo-specific implementation implications

- No new database/ORM dependency is warranted for 1G-D1.
- No custom transaction abstraction is required in D1 schema/schedule work.
- Migration tests should execute the real SQL files through the full current chain using `DatabaseSync`, matching existing tests.
- Production code should continue using prepared/bound statements in 1G-D2.
- Money stays integer minor units and must be validated as a JavaScript safe integer before persistence.
- Date-only Bill recurrence remains application logic; do not depend on database timestamp/timezone arithmetic.

## Consumer-finance recurrence/product findings retained from the parent design

- RFC 5545 recurrence rules omit invalid calendar dates; that behavior is not desirable as the primary Bill recurrence semantic for month-end obligations.
- YNAB Scheduled Transactions provide a relevant consumer-finance precedent for treating a 31st-of-month schedule as the last day in shorter months.
- Upcoming-by-date Bills views are standard/high-value in current consumer finance products such as Rocket Money; that supports the planned 1G-D -> 1G-E sequencing.

References:

https://datatracker.ietf.org/doc/html/rfc5545

https://support.ynab.com/scheduled-transactions-a-guide-BygrAIFA9

https://help.rocketmoney.com/en/articles/3117398-where-can-i-view-my-subscriptions-and-bills

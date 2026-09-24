# September 2026 db-push migration-history repair

## Incident and scope

Production reported Prisma P3009 for `20260107000000_add_widget_sort_order`.
The operator verified `DashboardWidget.sortOrder` as integer, NOT NULL, default
0 and resolved that migration as applied. Status then listed 41 pending migrations.
Read-only catalog queries found no `delivery_*` functions and no non-internal
triggers in `public`. `db push` had supplied the Prisma schema, not custom SQL.

`server/scripts/repair_migration_history.js` is a **one-time, pinned repair** for
that image/schema/history, not a replacement for normal migrations. It includes
the older pending migrations as well as delivery. Original migration files and
successful migration records are not modified.

## Deploy through Portainer without replaying the backlog first

1. Have a current PostgreSQL backup/snapshot available before applying repair.
2. In the stack environment (`stack.env`, supplied by Portainer), set
   `MIGRATION_RECOVERY_MODE=hold`. If editing Compose directly, place it under
   `services.api.environment`. It must reach the **API container**.
3. Deploy the image containing this repair. Startup must report:
   `[Startup] RECOVERY HOLD: skipping migrate deploy and db push. Existing schema only.`
   This is an explicit temporary hold; the current application starts without
   attempting pending migrations. It does not re-enable rolled-back catalogue code.
4. Open **API container → Console → /bin/sh**. Run:

   ```sh
   cd /app/server
   node scripts/repair_migration_history.js --check
   ```

   The tool constructs its connection from the same POSTGRES variables as startup
   if `DATABASE_URL` is absent. It does not print credentials. `--check` is a full
   transactional rehearsal, **not a lock-free/read-only check**: all changes are
   rolled back. It takes table locks and can briefly pause API/worker DB traffic.
   Use a quiet maintenance window for both commands.

5. Only after `REHEARSAL PASSED; ALL CHANGES ROLLED BACK`, run:

   ```sh
   node scripts/repair_migration_history.js --apply
   ```

   Expect `COMMITTED: 41 migrations, ... functions, ... triggers verified` for
   the reported starting history. A mismatch or failure rolls back the repair
   and reports an object name or SQLSTATE; send that output for investigation.
   Do not mark additional migrations applied manually to bypass a failed check.
6. Remove `MIGRATION_RECOVERY_MODE=hold` and the legacy
   `ALLOW_DB_PUSH_FALLBACK=true` override, then redeploy. Normal startup should say
   `No pending migrations to apply` and `Migrations applied via migrate deploy`.
   The tool is not invoked automatically on later startups.
7. Recheck delivery readiness. Missing-variation/product rejections are a separate
   catalogue problem; this repair does not claim to fix them or enable storefront
   activation. It does not reconstruct past source-change events that occurred
   while triggers were absent; affected delivery data still needs revalidation.

If repair fails, the hold permits the existing application to remain available
while the specific mismatch is investigated. Do not remove it and blindly retry
the backlog. Hold is for this existing-schema incident, not for fresh installs.

## Verification and transaction boundary

- Pins SHA-256 of the complete 60-file history and current Prisma schema. Different
  source images are rejected; the repair cannot silently absorb later migrations.
- Requires all pre-backlog migrations applied, no unresolved failed history,
  known names, and matching checksums on successful records.
- Generates an empty reference schema from the pinned Prisma model. Compares
  actual column types, defaults, nullability, enum values, indexes and PK/FK
  definitions. Merely having a column or table with the same name is insufficient.
- Reconstructs final CHECKs (including inline/unnamed checks), partial indexes,
  function definitions/comments and trigger bindings from original migration SQL.
  Superseded two-scope and independent-stock-owner checks are resolved in the
  empty reference schema, never temporarily imposed on real inbound rows.
- Refuses unexpected or altered existing custom objects, disabled triggers,
  malformed schema, active delivery display and invalid data. No blanket
  duplicate-object exception suppression, destructive schema push or table reset.
- Executes pending data backfills. These can update historic order/review UTC
  dates, missing publication metadata, automation status, null contact
  classifications and delivery scheduling metadata. Recovery preserves non-null
  publication/contact values, existing sync accounts and progressed cascade states.
  It cannot infer values already lost or overwritten by past db pushes.
- Does not write stock quantities, PO quantities, receipt deltas, successful ack
  revisions or outgoing WooCommerce APIs. It does not delete catalogue records.
- Uses Prisma's advisory migration lock plus exclusive table locks, with a 5-second
  lock timeout and 120-second **per-statement** timeout. Runtime scales with data.
- SQL, backfills and new applied-history rows commit in **one transaction** only
  after final catalog verification. The same transaction removes the scratch
  schema. Connection loss/error rolls back; repeat application verifies a no-op.
- History entries use original-file checksums, preserve prior rows and identify
  this verified reconciliation in logs. Normal `prisma migrate deploy` is tested
  after repair; it sees no pending migrations.

## Tests

Native regression: `server/scripts/tests/migration-repair.native.test.js` uses an
explicit `MIGRATION_REPAIR_TEST_DATABASE_URL` pointing to a disposable database
whose name begins `migration_repair_test_`. Never point it at production; it
creates a complete fixture schema. SQL lexer and startup tests run without a DB.

Coverage includes schema mismatch, unresolved failure, invalid CHECK data, late
backfill rollback/redaction, advisory lock exclusion, rehearsal rollback, final
trigger behaviour, preserved stock/synced inputs, repeat repair, disabled-trigger
rejection, normal Prisma deployment and scratch-schema cleanup.

Validated locally on PostgreSQL **17.1** (matching the production major/minor
shown in Portainer): **12 native checks passed**, including a parent-stock-owned
receipt and an existing inbound input. **11 SQL/startup checks passed** separately.
The disposable database was dropped and its PostgreSQL server stopped. An earlier
basic repair/repeatability run also passed on PostgreSQL 18.4. No production
database was accessed during development.

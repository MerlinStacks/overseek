# September 2026 db-push migration-history repair

## Incident and scope

Production reported Prisma P3009 for `20260107000000_add_widget_sort_order`.
The operator verified `DashboardWidget.sortOrder` as integer, NOT NULL, default
0 and resolved that migration as applied. Status then listed 41 pending migrations.
Read-only catalog queries found no `delivery_*` functions and no non-internal
triggers in `public`. `db push` had supplied the Prisma schema, not custom SQL.

`server/scripts/repair_migration_history.js` is a **pinned repair** for
that image/schema/history, not a replacement for normal migrations. It includes
the older pending migrations as well as delivery. Original migration files and
successful migration records are not modified.

## Automatic container-start recovery

Startup now uses `server/scripts/startup_migrations.js`. Recovery is enabled by
default in the new image; existing stack environment files need no new setting.

1. Run normal `prisma migrate deploy`. Healthy and fresh installs use this path.
2. Retry Prisma connection/timeout errors P1001, P1002, P1017 and P1008 up to
   three times, five seconds apart. Other errors are not treated as transient.
3. On P3009/P3018, attempt the pinned repair once per startup. It requires the
   complete matching Prisma schema, reviewed history and valid data described
   below. Currently the only unresolved failures it can reconcile are:
   - `20260107000000_add_widget_sort_order`
   - `20260115000000_add_sms_channel`
   Both are DDL-only migrations, with file checksums checked and their complete
   resulting schema verified. Other unresolved failures stop recovery.
4. Preserve each failed attempt and its logs, mark it rolled back, and add the
   verified applied record **in the same transaction as the complete repair**.
   Any verification/backfill failure rolls back all repair changes.
5. Rerun `migrate deploy` after commit. Start the application only after it passes
   and the plugin installer succeeds. A second migration failure cannot trigger
   a second repair in that startup.

`MIGRATION_AUTO_REPAIR=false` disables automatic repair, but retains transient
retries and stops on migration failure. Set it in the API container environment
(`stack.env` for Portainer). `MIGRATION_RECOVERY_MODE=hold` still takes precedence
and skips all migration/repair attempts for the manual incident procedure below.
Remove an existing `hold` setting to enable normal startup recovery.

The legacy `ALLOW_DB_PUSH_FALLBACK` setting no longer has any effect: startup
never falls through to `db push`, including after rejected recovery. No migration
files, customer volumes or successful migration records are reset. This does not
guarantee recovery from arbitrary failures or reverse changes already committed
by a previously failed migration. Repairs for newer image schemas/history require
a separately reviewed specification; a pin mismatch stops recovery.

Repair takes exclusive table locks and can pause traffic from other running
instances. Automatic recovery retains the same timeouts, delivery-display gate,
data preservation rules and transactional backfills as the manual procedure.

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
   Healthy later startups do not invoke repair. Automatic recovery is considered
   only if deployment fails with P3009/P3018.
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
- Requires all pre-backlog migrations applied, known names, and matching
  checksums on successful records. Manual repair rejects all unresolved failed
  history; automatic repair admits only the two reviewed failures above and
  allows the verified failed widget migration as the sole pre-backlog exception.
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

Run the standalone checks with:

```sh
node --test server/scripts/tests/migration-repair.test.js server/scripts/tests/startup-rollback.test.js server/scripts/tests/startup-migrations.test.js
sh -n server/start.sh
```

Native regression: `server/scripts/tests/migration-repair.native.test.js` uses an
explicit `MIGRATION_REPAIR_TEST_DATABASE_URL` pointing to a disposable database
whose name begins `migration_repair_test_`. Never point it at production; it
creates a complete fixture schema. SQL lexer and startup tests run without a DB.

Coverage includes schema mismatch, unresolved failure, invalid CHECK data, late
backfill rollback/redaction, advisory lock exclusion, rehearsal rollback, final
trigger behaviour, preserved stock/synced inputs, repeat repair, disabled-trigger
rejection, normal Prisma deployment and scratch-schema cleanup.

Validated locally on PostgreSQL **17.1** (matching the production major/minor
shown in Portainer). The automatic-recovery regression includes rejected unknown
failures/checksums, failed-widget rollback, preserved failed-attempt logs, and the
real startup runner recovering from Prisma P3009 then passing migrate deploy.
There are **13 native subtests** plus their parent test, and **19 SQL/startup checks**.
The disposable database was dropped and its PostgreSQL server stopped. An earlier
basic repair/repeatability run also passed on PostgreSQL 18.4. No production
database was accessed during development.

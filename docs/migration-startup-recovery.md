# Migration startup and safe recovery

`server/start.sh` runs `prisma migrate deploy` once, with its full stdout and
stderr attached to the container logs. A failure exits with Prisma's exit code
before plugin installation or application startup. This applies in every
environment. `ALLOW_DB_PUSH_FALLBACK` is obsolete and has no effect.
Startup never runs `db push`, `migrate resolve`, or a reset, and never retries a
failed migration internally. A container restart policy can still repeat startup;
pause a failing rollout/restart loop through normal operational controls while
investigating. A failed deploy may already have applied SQL: stopping startup does
not roll back all migration effects.

## Preserve evidence, then diagnose

1. Retain the **first complete `migrate deploy` output**, including Prisma error
   code, migration name, database error, SQL context and all stderr lines. Later
   attempts can report a failed-history error instead of the original SQL failure.
   Record the image/build identity and migration files used. Treat logs as sensitive
   and redact credentials/customer data before sharing.
2. From the **server working directory**, using the same image, migration files,
   and explicitly configured target database environment, inspect status:

   ```sh
   npx prisma migrate status --config ./prisma/prisma.config.ts
   ```

   This is a diagnostic, not a repair; a nonzero status is useful evidence. Do not
   invoke the normal startup script just to obtain status. Startup can construct
   `DATABASE_URL` from `POSTGRES_*`; a standalone Prisma command does not execute
   that shell setup. Ensure it has the intended `DATABASE_URL` without printing
   secrets. In a stopped-container investigation, use the established one-off
   container procedure with startup bypassed and the same environment/image.
3. With read-only database access, inspect `_prisma_migrations` if present,
   especially `migration_name`, `started_at`, `finished_at`, `rolled_back_at`,
   `applied_steps_count`, and `logs`. Missing history is also evidence. Correlate
   failed entries with the original error and exact migration SQL, rather than
   assuming every failure means an unbaselined database.
4. Diagnose the actual cause: connectivity/authentication, permissions, missing
   or divergent migration history, SQL/data constraints, or partial prior changes.
   If old startup logs suppressed stderr, the original error may be unrecoverable
   from those logs; consult retained migration/database logs. Do not infer it from
   a subsequent successful schema push.

## Recovery must match the database's actual state

Before schema/history repair, take a recoverable backup and reproduce the issue
on a restored isolated copy using the exact release migrations. Compare actual
objects and data against the migration SQL, including custom functions, triggers,
indexes and constraints. Review and test a targeted repair/baseline plan with the
database owner. Only then apply the approved repair and retry `migrate deploy`.
For a transient connection failure, correct connectivity and retry after checking
whether any migration was recorded as failed or partially applied.

Do not blindly mark migrations applied/rolled back, edit migration history, reset
the database, or run `db push --accept-data-loss`. A migration-resolution command
changes bookkeeping; it does not execute the missing SQL. No universal resolve
command is safe for an unknown database state. A genuinely pre-existing database
needs a reviewed baseline that accounts for all SQL effects, not just Prisma models.

## Databases previously started via `db push`

**A successful `db push` does not establish correct migration history or prove that
custom SQL exists.** It synchronizes Prisma-modelled schema without executing
versioned migration SQL. Existing tables can also conflict with later migrations.
`migrate status` and even a successful `migrate deploy` are not a full drift audit:
objects missing from migrations already recorded as applied may remain missing.

Delivery freshness depends on functions and triggers introduced by
`20260922123000_delivery_freshness_targets`, with later function changes in
`20260923110000_variant_supplier_freshness` and
`20260923130000_delivery_bom_noop_guards`. Receipt migrations also install custom
SQL guards. Audit all applicable migrations, not only these examples. With
read-only PostgreSQL catalog queries, compare function definitions and trigger
definitions/enabled state (`pg_proc`, `pg_trigger`, `pg_get_functiondef`,
`pg_get_triggerdef`) to the release SQL. Table/column existence is insufficient.
Validate delivery invalidation and receipt guards on the restored copy after the
repair. This startup change does not detect or restore missing triggers on an
already-drifted database.

## Local regression checks (no database)

From repository root:

```sh
sh -n server/start.sh
node --test server/scripts/tests/startup.test.js
```

The tests use isolated temporary fake `npx`, `node`, `npm`, and `sleep` commands.
They check error streams/exit codes, fail-closed behavior regardless of environment
or the obsolete override, successful startup ordering, installer failure, and
application exit/heap behavior. They do not validate real migration SQL, live
database state, or a built container image.

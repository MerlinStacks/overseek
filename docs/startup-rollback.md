# Emergency startup rollback

The rollback of `49ed1c4e` restores its 47 feature files to `13e59a35`.
This also rolls back the null-image and catalogue-membership fixes. The older
2.23.1 work is preserved. This is a source rollback, not a database rollback.

Startup retains migration stderr for diagnosis. In production, migration failure
stops startup unless `ALLOW_DB_PUSH_FALLBACK=true`. The legacy fallback runs
`prisma db push` without `--accept-data-loss`, with at most 30 attempts. A successful
migration or fallback must still pass the plugin installer before the app starts.

## Recovery limitations

A successful fallback does not mean migrations are repaired. `db push` does not
repair migration history or provide custom migration SQL, including triggers.
Already-applied database changes are not undone by reverting source files.
Preserve the original migration error, inspect the actual schema and migration
history, and repair the failed migration and required custom SQL before treating
the deployment as recovered. Do not mark a migration resolved without verifying
its intended database effects.

## Standalone checks

```sh
node --test server/scripts/tests/startup-rollback.test.js
sh -n server/start.sh
```

The tests run the real startup script with temporary fake commands and no database.
They cover startup ordering, production gating, stderr preservation, safe fallback
arguments, bounded retries with mocked sleep, and installer failure.

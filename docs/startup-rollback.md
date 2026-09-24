# Emergency startup rollback

The rollback of `49ed1c4e` restores its 47 feature files to `13e59a35`.
This also rolls back the null-image and catalogue-membership fixes. The older
2.23.1 work is preserved. This is a source rollback, not a database rollback.

Startup retains migration stderr for diagnosis. It now uses bounded transient
retries and the pinned automatic recovery described in
[migration-history-repair.md](migration-history-repair.md). Unrecognised failures
stop startup. `ALLOW_DB_PUSH_FALLBACK` no longer enables a schema-push fallback.
Successful migration deployment must still pass the plugin installer before
the app starts.

## Recovery limitations

A past successful fallback does not mean migrations are repaired. `db push` does not
repair migration history or provide custom migration SQL, including triggers.
Already-applied database changes are not undone by reverting source files.
Preserve the original migration error, inspect the actual schema and migration
history, and repair the failed migration and required custom SQL before treating
the deployment as recovered. Do not mark a migration resolved without verifying
its intended database effects.

## Standalone checks

```sh
node --test server/scripts/tests/startup-rollback.test.js server/scripts/tests/startup-migrations.test.js
sh -n server/start.sh
```

The tests run the real startup script with temporary fake commands and no database.
They cover startup ordering, failure gating, stderr preservation, absence of
schema-push fallback, bounded retries, one-shot recovery and installer failure.

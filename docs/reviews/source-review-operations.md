# Reviewed operational scripts

These scripts are import-safe and default to dry-run. They have not been run against live data as part of the source review.

Use `--help` to inspect an individual script without opening clients. Otherwise an explicit PostgreSQL `DATABASE_URL` and exactly one scope are required:

- Reindexing and diagnostics: `--account=ACCOUNT_ID` or `--all`.
- Session revocation: `--user=USER_ID` or `--all`.
- Optional `--before=YYYY-MM-DDTHH:mm:ssZ` fixes the creation cutoff; otherwise the run's start time is used. Migration-only session work should supply its actual migration cutoff, not revoke newly created sessions.
- `--limit=N` defaults to 10,000, maximum 1,000,000. `--batch-size=N` defaults to 50, maximum 500.
- Dry-run reports matching counts without indexing or revoking sessions. Diagnostics always return aggregate counts only; row dumps were removed.

Writes require **both** `--apply` and `--confirm=TASK:SCOPE:DB_HOST/DB_NAME`, where `SCOPE` is `ALL`, `account:ACCOUNT_ID` or `user:USER_ID`, and `TASK` is the script basename without `.ts`. Use the actual credential-free database host, port (if configured) and database pathname. Do not put passwords or connection query parameters into confirmations or logs.

Reindex writes additionally require `OPERATIONAL_SEARCH_CONFIRM=TASK:SEARCH_HOST/SEARCH_PATH`, matching the configured Elasticsearch destination (including any port). The default Elasticsearch destination is `localhost:9200/` if its URL is not configured. These checks happen before clients are opened.

Reindexing is non-destructive: these scripts no longer delete shared search indices and do not perform global mapping rebuilds. Orders use current local identity, status, total, currency, customer fields and dates, and recompute configured tags. Products include current stored variations. Failed/skipped rows and remaining rows are reported, not counted as successful indexing. Applied runs with failures or incomplete coverage exit nonzero; inspect the outcome before deciding whether to continue. Concurrent changes are not a database-wide point-in-time snapshot; creation cutoffs and an initial upper ID bound keep traversal finite.

Session revocation repeats the user/cutoff/active conditions in each conditional write and reports remaining eligible sessions. It invalidates refresh tokens, not already-issued access tokens; their existing expiry/revocation rules still apply.

Type-check these otherwise-excluded scripts with `npm exec -w server -- tsc --noEmit -p tsconfig.operational.json`. Tests inject mocked database/search dependencies and do not perform live operations.

## Legal page configuration

Supply `VITE_TERMS_UPDATED_AT` and `VITE_PRIVACY_POLICY_UPDATED_AT` as valid `YYYY-MM-DD` dates only when the corresponding document is actually revised. Missing or invalid dates are omitted. Configure usable `VITE_LEGAL_EMAIL` and `VITE_PRIVACY_EMAIL` contacts before publishing. Existing legal commitments remain for operator review; these source changes do not invent replacement legal terms.

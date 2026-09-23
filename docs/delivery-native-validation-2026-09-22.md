# Delivery native PostgreSQL validation — 2026-09-22

## Result

**27 test files passed; 323 tests passed; zero failures or skipped tests.**
Final Vitest duration: 6.34 seconds. This includes the four requested suites,
`launchReadiness.sql.test.ts`, and 12 new native integration cases in
`server/src/services/deliveryEstimates/nativeConcurrency.test.ts`.

No production logic, existing tests, migration files, or application database were
modified. No commit was created. Early development failures were corrected only
in the new fixture: missing historical Account/AccountFeature columns and an
incorrect mocked receipt ACK envelope. No production defect was identified by
this run.

## Isolated runtime

- PostgreSQL **18.4**, Linux x86-64, compiled with GCC 7.5.0.
- Node **22.23.1**, Vitest **4.1.10**, `pg` **8.22.0**, Prisma **7.8.0**.
- No installed native binaries were found in `/usr/lib/postgresql`, on PATH,
  under temporary Node modules, or under the Homebrew prefix.
- Downloaded and extracted `@embedded-postgres/linux-x64@18.4.0-beta.17`
  in `/tmp/opencode/delivery-native-validation`; no global installation.
- Tarball: `https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-18.4.0-beta.17.tgz`
- Tarball SHA-256: `795d587bb466423385db256dc81e61f2ee40c9e10efde21e881f3e997dd1bdb2`.
- New data directory: `/tmp/opencode/delivery-native-validation/data` (0700).
- Private socket directory: `/tmp/opencode/delivery-native-validation/socket` (0700).
- Socket port: **57439**; `listen_addresses=''` disables TCP entirely.
- Database/role: `delivery_test`; host authentication rejects connections,
  local socket authentication trusts the private OS-owned socket.
- `DATABASE_URL`, `DIRECT_URL`, PGlite selection, and standard libpq connection
  environment variables were unset by the runner. No secret files were read.
- Every suite creates/drops a random `freshness_test_*` schema. The new suite
  uses one native pg connection and a separate, single-connection Prisma pool.

The existing temporary PostgreSQL data directory was not started or modified.
PGlite fallback was unnecessary because the extracted native server ran successfully.

## Coverage executed

### Migration chain and prerequisites

The following **actual SQL files**, in chronological order, were executed over a
synthetic pre-delivery source baseline. Every new delivery table, constraint,
function and trigger came from the migration files:

1. `20260921000000_delivery_estimates`
2. `20260921010000_delivery_input_sync`
3. `20260921020000_delivery_sync_account`
4. `20260921030000_delivery_inbound`
5. `20260921040000_delivery_inbound_targets`
6. `20260922000000_order_delivery_estimate_snapshot`
7. `20260922010000_guarded_receipts`
8. `20260922020000_delivery_launch`
9. `20260922123000_delivery_freshness_targets`
10. `20260922133000_delivery_freshness_prerequisite`
11. `20260922134000_delivery_inbound_scope_constraints`
12. `20260922160000_delivery_launch_recovery`

`freshnessMigration.test.ts` verified that the schema-push-only baseline fails
the real catalog prerequisite query (29 missing requirements); installing the
freshness hooks without attestation still leaves 14 missing; both migrations
produce zero missing requirements. Disabled/misbound/conditional triggers and
incorrect function markers are rejected.

Source triggers covered product/variation changes and deletion, BOM changes,
supplier changes, PO changes, account teardown, transactional rollback, and
deadline parking/restoration for disabled or unsupported accounts. Scope and
revision constraints were exercised by the complete-chain suite.

### Real queries and two-connection races

The new native suite mocks only the external Woo transport and redirects the
application Prisma singleton to the isolated real client. Production functions
generate and execute their own SQL, including relation-filtered updates and
transactional ACK finalization:

- Account `FOR UPDATE` blocks the independent connection; `pg_blocking_pids`
  establishes an actual wait before releasing the lock.
- Readiness succeeds against the full migrated schema and real Prisma reads.
- Explicit feature-disable transaction rolls back feature state, control intent,
  settings intent and trigger deadline changes together; a committed disable
  parks renewal, queues disabled settings/control, blocks readiness and finalizes
  the disable ACK.
- A newer desired input revision remains pending after the older in-flight ACK.
- Replacement input/account leases prevent stale ACK and cleanup writes.
- A competing inbound generation/version update holds the control row lock;
  the stale worker claim blocks and then fails its CAS after commit, without
  sending an input.
- Current input ACK finalization marks it synced and sleeps the drained account.
- Control revision and lease replacements prevent old ACK finalization.
- Guarded cutover finalization certifies owners, changes Account transport mode,
  unfreezes receiving and queues a fresh inbound generation.
- Receipt prepare/apply finalization advances the owner sequence and stores stock;
  the immutable-intent trigger rejects a subsequent delta edit.
- Independent account/owner lease replacement prevents receipt ACK acceptance
  and preserves the replacement lease.

Existing SQL readiness suites additionally exercise tombstone ACK ordering,
eligible/excluded products, variable parents, and stale/unverified proofs.

This is delivery integration coverage, not a replay of all historical application
migrations or a live WooCommerce transport test. The opt-in guards remain in
place for ordinary test runs; this native invocation executes them all.

## Exact final invocation and evidence

Working directory: `/home/agent/workspaces/Coding Files/Overseek/overseek/server`.

```bash
bash /tmp/opencode/delivery-native-validation/run.sh src/services/deliveryEstimates > /tmp/opencode/delivery-native-validation/final-native.log 2>&1
```

The retained runner and `run.mjs` start only the private cluster, create the
dedicated test database, print versions, invoke the repository Vitest executable
with `run src/services/deliveryEstimates --reporter=verbose`, check for residual
test schemas, and stop the cluster using an EXIT trap. Its explicit test URL is:

```text
postgresql://delivery_test@localhost:57439/delivery_test?host=/tmp/opencode/delivery-native-validation/socket
```

Final log: `/tmp/opencode/delivery-native-validation/final-native.log`.
SHA-256: `06f9cb556314535ef52c3224970ca65b4ffb4fbacb235a7241b8fa06da5df51d`.

```text
Test Files  27 passed (27)
     Tests  323 passed (323)
Isolated test schemas remaining after cleanup: 0
server stopped
```

Independent post-run verification:

```bash
/tmp/opencode/delivery-native-validation/package/native/bin/pg_ctl -D /tmp/opencode/delivery-native-validation/data status
```

Result: `pg_ctl: no server running` (expected exit status 3). The stopped private
cluster, binary package, scripts and log are retained under `/tmp/opencode` for
reproduction. There are no surviving test server processes.

A non-failing pg deprecation warning was emitted for parallel queries inside an
interactive transaction. It did not affect the assertions; it is recorded in the
log. No production changes were made to suppress it.

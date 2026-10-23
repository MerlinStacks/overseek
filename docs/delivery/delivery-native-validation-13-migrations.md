# Native delivery validation after receipt-cascade migration

## Final stock-derived BOM correction — latest superseding result

**13 unchanged migrations; 36 test files; 396 tests passed; zero failures and zero
skips. Production server build passed.** Final full-suite duration: **18.82s**.
An additional temporary actual-Prisma integration suite passed **6/6 cases**
with no skips; those six are separate from the repository's 396-test count.

Runtime: native PostgreSQL **18.4**, real Node **22.23.1**, Prisma Client **7.8.0**,
`pg` **8.22.0**, Vitest **4.1.10**, server TypeScript compiler **7.0.2**. Prisma
Client was regenerated after the user's dependency reinstall, using the private
validation config with no dotenv/application DATABASE_URL access. No dependency
versions or lockfiles were changed by this validation.

### Stock-derived BOM evidence

The frozen `stockDerivedBom.test.ts` has **six cases**, rather than the four
originally described. All passed on native PostgreSQL:

- Cost-only SupplierItem/material/labour rows remain eligible native owners and
  retain direct supplier lead times and PO due dates/quantities.
- Child-product, internal-stock and orphan-variation references are excluded.
- Zero variation IDs and empty child references also fail closed.
- Adding/removing inventory references fires dirty-target invalidation and
  invalidates/restores the cutover metadata fence. Inactive references remain
  conservatively stock-derived.

That repository test uses a SQL-backed adapter for inbound nested reads. To
verify the **actual Prisma-generated relation/filter queries** too, a temporary
suite at `/tmp/opencode/delivery-native-validation/stock-bom-prisma.test.ts`
uses the existing native helper, applies all 13 migration files, and calls real
`buildInbound`, `buildCutoverBatch`, and `cutoverBatchStillCurrent` functions with
the actual Prisma client. Its six cases verify the same cost-only/reference
boundaries, including dangling/zero/empty references, both add/remove trigger
invalidation, and persisted baseline proof. No service or query methods are
mocked in that supplemental suite.

The complete delivery run also retains all 22 prior actual-Prisma concurrency and
receipt/cascade cases, migration/readiness/prerequisite coverage, cutover batches,
source fences, and explicit-disable behavior.

### Exact commands

Working directory: `/home/agent/workspaces/Coding Files/Overseek/overseek/server`.

```bash
env -u DATABASE_URL -u DIRECT_URL DOTENV_CONFIG_PATH=/dev/null PATH="/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH" /tmp/opencode/node-v22.23.1-linux-x64/bin/node ../node_modules/prisma/build/index.js generate --config /tmp/opencode/delivery-native-validation/prisma-freeze.config.ts > /tmp/opencode/delivery-native-validation/stock-bom-prisma.log 2>&1

bash /tmp/opencode/delivery-native-validation/run.sh --config /tmp/opencode/delivery-native-validation/stock-bom.vitest.config.mjs --no-file-parallelism > /tmp/opencode/delivery-native-validation/stock-bom-prisma-native.log 2>&1

bash /tmp/opencode/delivery-native-validation/run.sh src/services/deliveryEstimates --no-file-parallelism > /tmp/opencode/delivery-native-validation/final-stock-bom-native.log 2>&1

env -u DATABASE_URL -u DIRECT_URL DOTENV_CONFIG_PATH=/dev/null PATH="/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH" /tmp/opencode/node-v22.23.1-linux-x64/bin/npm run build > /tmp/opencode/delivery-native-validation/stock-bom-build.log 2>&1
```

The production build completed its plugin runtime **check only**, shared-core
CJS/ESM compilation, and server compilation. No plugin archive was rebuilt.
No repository source or test fixture changes were needed; only this evidence
document and temporary verification files were written, besides normal generated
Prisma/build artifacts. No commit was made.

### Cleanup and checksums

Both native invocations ended with **zero remaining test schemas** and
`server stopped`. Independent `pg_ctl` verification returned **no server running**.
Only `/tmp/opencode/delivery-native-validation/data` was resumed; all other user
databases and processes were untouched.

From the repository root, `sha256sum -c
/tmp/opencode/delivery-native-validation/freeze-migrations.sha256` reported **OK
for all 13 migration files**. The new backend manifest includes delivery source,
tests, native helpers, BOM services, Prisma schema and the current package lock.

Evidence files below are in `/tmp/opencode/delivery-native-validation/`:

| File | SHA-256 |
| --- | --- |
| `final-stock-bom-native.log` | `475441d567e7e9340e81723c5037daa1b7b884ca1d30f3ca942a63a5fa92923e` |
| `stock-bom-prisma-native.log` | `af608e007c3f226d9e83875fd1b3726e185a7aa0a4fe29c81cbc455cf29adf0c` |
| `stock-bom-build.log` | `5074fd0b06c8f8d6f3edb48712d8c53152e935e0c92ee2410b34c4f49bedffe1` |
| `stock-bom-prisma.log` | `f0da8ae2e2ac866d0cc9dd18914fdd3a73ba8357e5ad45da51714825ce42956a` |
| `stock-bom-backend.sha256` | `d1dc2a5841e4343ee74652c2500f8eb9b7733b29a0ecb8ff435e6b9d796253ff` |
| `stock-bom-prisma.test.ts` | `3f726fcf834e8683ce910de75d2ec0ae7238b93f5e4feae6a05e889eb64a93d2` |

Key frozen source hashes, relative to `server/src/services/deliveryEstimates/`:

```text
830385c494b3fc6469963a7c6aba0734dee0411974221ed468d9d9e7b7636613  stockDerivedBom.ts
e4dcf4844249c1e8c7fead74ca568d8892c179e7d20afc799023f0b3c7b219a4  inbound.ts
326ab85071ef870c2ae41e8f82025fd9552d9ed95985fd0f1dcbc294a218d884  cutoverBatch.ts
810888df35fcfc741c8cbe34f10ad9d437cadc3db3f097bbb08e0e22258831ee  stockDerivedBom.test.ts
```

The preceding freeze results below remain historical evidence.

## Prior backend runtime freeze

**13 unchanged migrations; 35 test files; 390 tests passed; zero failures and zero
skips. Production server build passed.** Final native suite duration: **18.55s**.
The actual-Prisma native suites contain **22 cases**: 14 in
`nativeConcurrency.test.ts` and eight in `nativeReceiptCascade.test.ts`.

Runtime remains native PostgreSQL **18.4**, Node **22.23.1**, Prisma **7.8.0**,
`pg` **8.22.0**, and Vitest **4.1.10**. Regenerated Prisma Client before the final
tests/build with a validation-only config that imports no dotenv and uses only
the private test URL. No application DATABASE_URL was used.

### Freeze-specific checks

- Native `cutoverBatch.test.ts`: 50-parent pages over 500/1000 products,
  complete variation handling, owner/row/UTF-8 bounds, empty baseline,
  source-change/insert/delete fences, and no stock/price-only invalidation.
- `controlDrain.test.ts`: bounded fair multi-command loop, disable priority,
  command/wall budgets, lost ACK replay, source-conflict recovery, and historical
  command compatibility.
- `launch.test.ts`: private baseline/guarded preparation with the old display
  active, while readiness/activation remain blocked.
- Native request guard: missing actual trigger rejects cutover before a control
  row or receiving freeze is created.
- Native final transition guard: trigger disabled during guarded transport ACK
  leaves mode LEGACY and receiving frozen; repair allows immediate retry without
  waiting for a diagnostic cache to expire.
- Explicit disable request and ACK complete with that actual trigger still
  disabled. This extends the existing native request-guard case, preserving the
  expected 22 native case count.
- Complete migration chain, function-body provenance, schema-push-only failure,
  indexed renewal, readiness, receipt cascade and two-connection CAS/lease/ACK
  cases all pass.

### Commands and build

Working directory for all commands:
`/home/agent/workspaces/Coding Files/Overseek/overseek/server`.

```bash
env -u DATABASE_URL -u DIRECT_URL DOTENV_CONFIG_PATH=/dev/null PATH="/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH" /tmp/opencode/node-v22.23.1-linux-x64/bin/node ../node_modules/prisma/build/index.js generate --config /tmp/opencode/delivery-native-validation/prisma-freeze.config.ts > /tmp/opencode/delivery-native-validation/freeze-prisma.log 2>&1

env -u DATABASE_URL -u DIRECT_URL DOTENV_CONFIG_PATH=/dev/null PATH="/tmp/opencode/node-v22.23.1-linux-x64/bin:$PATH" /tmp/opencode/node-v22.23.1-linux-x64/bin/npm run build > /tmp/opencode/delivery-native-validation/freeze-build.log 2>&1

bash /tmp/opencode/delivery-native-validation/run.sh src/services/deliveryEstimates --no-file-parallelism > /tmp/opencode/delivery-native-validation/final-native-freeze-serial.log 2>&1
```

The actual production build script completed: plugin runtime **check only**,
shared-core CJS/ESM builds, then server `tsc`. It did not package or change the
plugin or start the application. Prisma regeneration and compiler output are
generated artifacts; no production source, UI, plugin, or migration was edited.

### Investigation notes and test-only correction

The initial full run exposed a stale fixture assumption in the existing
control-ACK race test. Its synthetic competing revision retained the previous
command payload and was immediately due, so the new fair loop could process it
in the same call. The test now clears the old envelope as actual intent writers
do and defers replacement dispatch, asserts only one transport call, and verifies
the replacement action/revision are preserved. No production change was needed.

A subsequent parallel-file run hit PostgreSQL `could not open relation with OID
94684` during catalog prerequisite inspection amid concurrent fixture-schema
teardown. The production guard correctly failed closed. Final execution uses
`--no-file-parallelism` to avoid unrelated fixture DDL racing catalog inspection.
The real two-connection locking and revision races inside the native tests still
execute concurrently. Parallel-file catalog-DDL flakiness remains an observed
test-harness limitation; it was not hidden with retries or a production fix.

### Cleanup and frozen provenance

```text
Test Files  35 passed (35)
     Tests  390 passed (390)
Isolated test schemas remaining after cleanup: 0
server stopped
```

Post-run `pg_ctl -D /tmp/opencode/delivery-native-validation/data status` reports
**no server running**. Only this private cluster was resumed/stopped; shared
WordPress/MySQL and other agents' processes were untouched. No commit was made.

Final evidence files under `/tmp/opencode/delivery-native-validation/`:

| File | SHA-256 |
| --- | --- |
| `final-native-freeze-serial.log` | `3290b8deac7eabbf47ef04a8dfda66847709ce995d1e05ba065bfc483465c47b` |
| `freeze-build.log` | `5074fd0b06c8f8d6f3edb48712d8c53152e935e0c92ee2410b34c4f49bedffe1` |
| `freeze-prisma.log` | `f77872fe962d0f98e336995140c3277f672d5387c86b422891e8c93474bfc8cb` |
| `freeze-migrations.sha256` | `e2be77fe37364180483eba38acd62e59f080b16df146c68632af75e392db5309` |
| `freeze-backend.sha256` | `f9813ca1eaa855508b1b0276e3cbc7ff1051c159fd655f0d5d2962fb99765697` |

The migration manifest records all 13 SQL files; their hashes are unchanged from
the preceding validation. The backend manifest pins delivery source/tests,
native fixture helpers, BOM services and the Prisma schema. Key freeze hashes:

```text
efe0e39876e8f41350848812ef6c6b412daac610cb1c6bfec31c585b23b69d5a  deliveryEstimates/launch.ts
adb8319cc729af4ea2ee220bbb14386541ed909eed80f7ea358405d56f240159  deliveryEstimates/cutoverBatch.ts
1dabbb83daa886e0215875c246dcc4909ee687e47e1ae638852c7300e53f2227  deliveryEstimates/freshnessPrerequisite.ts
95bda118f908189b9ad07c2bf988a58980e56f7f6ca05be7add3eb8a1dcb2bd5  deliveryEstimates/nativeConcurrency.test.ts
cffe8070d3a9c814068bd62f5fbb3ed9bf2f37ad8f6c54432566039d061c618e  server/prisma/schema.prisma
```

Delivery paths above are relative to `server/src/services`. The prior results
below are retained as historical evidence, not the final freeze count.

## Prior 13-migration run result

**13 actual migration files; 33 test files; 360 tests passed; zero failures and zero
skips.** Final duration: **9.90 seconds**. This supersedes the earlier 12-migration,
323-test result for the tested backend snapshot.

Runtime: PostgreSQL **18.4** (native Linux x86-64), Node **22.23.1**, Prisma
**7.8.0**, `pg` **8.22.0**, Vitest **4.1.10**.

All tests under `server/src/services/deliveryEstimates` ran, including the actual
Prisma concurrency suite, complete migration chain, readiness/deletion SQL,
freshness prerequisite/trigger tests, and the new native receipt/cascade suite.

## New native integration coverage

`nativeReceiptCascade.test.ts` adds eight cases, each using the actual production
functions and native Prisma/pg queries. Woo transport, Redis and logging are
mocked; receipt, BOM planning, inventory calculation, cascade, renewal and wake
services are not mocked.

1. **Parent-owned variation receipt:** real `recordGuardedReceipt` commits the
   repaired CHECK shape (`variationWooId=11`, `stockOwnerWooId=10`,
   `variationId=null`). Invalid owner shape is rejected. Forced transaction
   rollback removes stock, cycle and operation changes together. Source/delta
   immutability triggers reject edits.
2. **Skipped/empty receipt provenance:** unlinked and finished-BOM lines produce
   an immutable empty cycle. Reversal uses that stored cycle, even when current
   PO lines now reference a stock-managed component. No invented stock delta.
3. **Durable cascade phases:** pending/waiting-receipt -> applied/pending-cascade
   -> eight failed derived Woo writes -> failed-cascade -> authorized retry ->
   done. Actual BOM graph/calculator/guard/finalization queries run. Original
   native delta is applied once; prepare/apply calls remain exactly two through
   retries; only the derived assembly receives absolute stock writes.
4. **BOM consume/cancel before ACK:** actual order planning and guarded transport
   bridge produce sequences 1/-2 and 2/+2. Duplicate consume/cancel is idempotent;
   workers settle both in sequence and finish derived cascades.
5. **BOM consume/cancel after ACK:** successful consumption cascade promotes its
   ledger to COMPLETED; cancellation records the inverse, finishes its cascade,
   and preserves REVERSED ledger state.
6. **Unknown legacy BOM work:** materialization creates one pending operator-review
   item without changing historical ledger or stock, or creating native deltas.
   Legacy reversal fails closed. An old received PO without a guarded cycle
   cannot fabricate guarded reversal provenance.
7. **Migration upgrade provenance:** seeds historical applied, reconciled and
   pending operations before migration 13. Settled rows retain done cascade state;
   only unfinished rows become waiting-receipt. Source defaults remain
   purchase_order/null, old cycle skippedLines remain null, unknown legacy work
   remains pending with null targets, and an old received PO gains no invented
   receipt cycle. Account transport remains LEGACY and cutover epoch remains null.
8. **Final bodies/prerequisites/renewal:** compares installed `pg_proc.prosrc`
   bodies against the final CREATE FUNCTION definitions in all 13 files, including
   all 14 freshness functions and the three receipt protection functions. The
   real prerequisite query reports no missing objects. Actual renewal and wake
   services queue a target exactly once without rewriting payload/revision.
   EXPLAIN with sequential scans disabled confirms the renewal predicate can use
   `DeliveryInputSync_inbound_renew_idx`; this is index usability verification,
   not a production-volume performance benchmark.

The prior 12 native concurrency cases also pass against all 13 migrations:
Account row-lock waiting, inbound generation CAS, stale input/control ACKs,
replacement leases, successful finalization, real readiness, and explicit
feature-disable transaction rollback/commit.

The schema-push-only prerequisite rejection and source/renewal trigger suites
also pass. The baseline contains synthetic historical source tables; every new
delivery table, constraint, trigger and function comes from its actual migration.

## Scope and isolation

Only the previously created private PostgreSQL environment was resumed:

- Datadir: `/tmp/opencode/delivery-native-validation/data`
- Unix socket: `/tmp/opencode/delivery-native-validation/socket`, port 57439
- TCP disabled (`listen_addresses=''`); private datadir/socket permissions 0700
- Dedicated database/role: `delivery_test`
- Per-test random schemas: `freshness_test_*`
- Production `DATABASE_URL`/`DIRECT_URL` unset by the runner

No production service or migration was edited. Changes for this validation are
the new test and synthetic receipt baseline helper, plus an optional pre-migration
fixture callback in `nativeDeliveryDatabase.ts`. No commit was made. Shared
WordPress/MySQL services and other agents' processes were untouched.

## Exact command and cleanup evidence

Working directory: `/home/agent/workspaces/Coding Files/Overseek/overseek/server`.

```bash
bash /tmp/opencode/delivery-native-validation/run.sh src/services/deliveryEstimates > /tmp/opencode/delivery-native-validation/final-native-13.log 2>&1
```

The runner invokes Vitest with `run src/services/deliveryEstimates
--reporter=verbose`, explicitly selects only the private test URL, verifies schema
cleanup, and stops its own cluster in an EXIT trap.

```text
Test Files  33 passed (33)
     Tests  360 passed (360)
Isolated test schemas remaining after cleanup: 0
server stopped
```

Independent verification:

```bash
/tmp/opencode/delivery-native-validation/package/native/bin/pg_ctl -D /tmp/opencode/delivery-native-validation/data status
```

Result: **`pg_ctl: no server running`**, expected exit status 3.
The stopped private cluster and logs remain available for reproduction.

Final log SHA-256:
`8a10536731bfd09225eb90db2352086e1454955ab9fe0332138e03935088e68b`.

## Read-only provenance hashes

Migration 13: `20260922170000_receipt_cascade/migration.sql`

```text
cebb7d21fd39b128b00c4d54f8c0f50bc64e99320f7ee8b760cb9653bc0065d6
```

Key backend source SHA-256 values recorded immediately after the passing run:

```text
2fa2b753f6a9677049319294cf3885381644257ad08d95453186258ac6414c9f  deliveryEstimates/receipts.ts
26244ea3866e0c00f828f15e783394058f95f17588264d8d396a71e059f8b023  deliveryEstimates/receiptWorker.ts
85c2ac571c393fa8727ad42e8ab16144dc02ad767fe7b4dc509aad35b4704763  deliveryEstimates/receiptCascade.ts
4dd0772e0511e3768f5c432b9095759307477b53258c6c8abeb970eaa87cc191  deliveryEstimates/bomStockTransport.ts
14a268b0e7ff1a51db623979650cf337a4e93bd26b74c3860164020224c83f09  BOMConsumptionService.ts
ae3c7749efdece39e507ec78927a0cc1fb96e514b75bd99f6f55148512545bbc  BOMInventorySyncService.ts
```

Paths above are relative to `server/src/services`. Later backend changes require
their own validation; these hashes identify this result's source snapshot.

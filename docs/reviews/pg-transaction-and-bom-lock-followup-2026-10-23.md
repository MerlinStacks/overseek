# PostgreSQL transaction and BOM lock follow-up

Follow-up to the production log starting at `2026-10-23T02:23:33Z`, after deployment of `9c50ada5`.

## What the log establishes

- Startup and migrations completed. Node is now PID 1, and the earlier Fastify deprecation and inactive-BOM forecast stack traces are absent from this sample.
- `pg` reports overlapping queries on a single connection. The installed Prisma PostgreSQL adapter gives each transaction one connection and exposes query methods that can be called concurrently. The installed `pg` driver deprecates its implicit connection query queue. Independent queries through separate pooled connections are not the defect.
- The BOM job lost its lock with last acknowledged progress **367 / 1,908**, all 367 reported as skipped. The counters do **not** prove the next operation never began or that no write is in flight. The old log has no processing timestamp or ownership history, so it cannot distinguish an inherited/orphaned occurrence from a current worker's lock failure.
- Heap usage is **423.4 MiB / 6,192 MiB (6.8%)**, not high heap pressure. RSS includes native/external buffers; neither this snapshot nor startup growth alone establishes a memory leak.

## Local changes

### Serialize only transaction IO

`server/src/utils/serializedPrismaPg.ts` wraps the adapter's public transaction methods:

- `queryRaw` and `executeRaw` share a per-transaction FIFO promise sequence.
- Commit/rollback release the connection only after previously submitted IO settles. Late queries cannot use an already-closing/released connection.
- Original query errors reach callers without retry or conversion; rollback can still drain after a rejection.
- Savepoint methods use the same execute queue without nested-queue deadlock.
- Separate transaction connections and ordinary pooled reads remain concurrent. SQL, isolation levels and transaction scope are not rewritten, and no warning is suppressed.
- Both application and standalone clients in `server/src/utils/prisma.ts` use this adapter. Standalone pool-disposal behavior is preserved.

### Stop stock writes when a worker no longer owns its lock

`server/src/services/queue/JobLease.ts` uses BullMQ's public token-checked `extendLock` script. It renews only an existing lock owned by this execution; it cannot acquire a missing lock or steal a replacement worker's lock.

The BOM worker verifies ownership before bulk work, at each product boundary, after stock calculation and immediately before provider writes. Missing/stolen/expired locks and Redis verification failures raise `JobLeaseLostError`. The stock-sync methods propagate that error instead of counting it as one bad product and continuing the bulk run.

This is a fail-closed boundary, **not** an atomic fence at WooCommerce. A provider request already in flight when ownership is lost can still complete and must be reconciled. Failed/stalled occurrences are not automatically retried or reset. Lock duration/stall retry allowances are unchanged.

### Useful lock diagnostics

`server/src/services/queue/QueueFactory.ts` now records bounded scalar execution metadata and listens for BullMQ's lock-renewal success/failure events. Stalled BOM failures include:

- worker process/start time and the job's `processedOn` timestamp;
- whether this worker actually observed the matching execution;
- last successful lock renewal and renewal-failure count, if observed;
- existing account/job/progress fields and reconciliation guidance.

No job tokens, SQL, database credentials or retained customer payloads are logged. An old job sharing the same ID but a different processing timestamp is not mistaken for the current execution.

## Verification and rollout

Focused transaction, pool ownership, lock and BOM stop-boundary tests pass, along with targeted server lint and typechecking. The server production build passes. Final full server suite: **420 files / 3,836 tests passed; 14 files / 132 tests skipped**. No client code was changed by this follow-up.

No schema migration is introduced. Deploy the matching API/worker build and retire the old processes. A local Docker/PostgreSQL integration run was unavailable because this environment has no Docker daemon; the tests use synthetic driver/lease boundaries, not the production database or Redis.

The existing `sync_bom_a03315be-5bf4-47fa-bc5f-e8e5df59e8d5` occurrence was **not** inspected, reset, removed or replayed in production. Preserve its history, ensure any old writer is stopped, and compare live stock and available acknowledgements before an operator-approved fresh sync. The new log fields help diagnose subsequent occurrences but cannot reconstruct missing historical evidence.

If the `pg` warning persists after this deployment, capture a `--trace-deprecation` stack from that build, preserving existing heap settings. Do not disable deprecations or globally serialize the whole database pool as a workaround.

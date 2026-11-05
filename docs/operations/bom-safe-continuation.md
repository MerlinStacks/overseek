# BOM safe continuation

## What it does

**[Repair & resume](bom-auto-repair.md)** is now the recommended recovery action.
The continuation described here is under **Advanced: continue untouched products
only** and does not unlock normal sync. An existing repair attempt blocks this
older continuation path so it cannot replay uncertain repair targets.

The BOM Inventory Sync page offers **Review continuation** to users with current
`manage_inventory` permission when a retained failed run blocks Sync All.

New worker executions save a bounded, ordered manifest of product/variation IDs
in the BullMQ job before processing. Before each product they persist an in-flight
checkpoint; after acknowledgement they advance the checkpoint. Product failures
are retained as uncertain indexes. A crash or lost acknowledgement conservatively
leaves that product uncertain, even if no Woo request actually began.

The passive review checks both legacy/shared job IDs and any existing continuation.
For every failed source occurrence it requires a valid manifest and checkpoint.
Only targets proven unattempted across **all** failed source runs are eligible.
The interrupted target, previous uncertain targets, other variations of uncertain
products, downstream BOM dependencies, and removed targets are excluded. Newly
created BOMs are not added to the source run.

## Operator procedure

1. Deploy the matching API and worker code through the normal deployment process.
   Retire old worker processes and quiesce/drain previously admitted BOM work
   before enabling continuation: old jobs may still carry count-based cleanup
   options capable of pruning other accounts' evidence in this shared queue.
   Every updated BOM producer disables automatic completed/failed pruning.
   Preserve Redis job data/progress and the usual database/Redis backups; no
   database migration is required.
2. Review the continuation counts. An expired lock or `failed` state is **not**
   evidence that the old process and its HTTP requests have stopped. Verify this
   through process and provider observations before confirming. If this cannot be
   established, do not continue.
3. Keep BOM definitions unchanged during the continuation. The approval binds to
   the observed dependency graph and failed execution evidence, but does not lock
   out independent inventory editors or fence WooCommerce requests atomically.
4. Confirm the worker/HTTP-settlement condition and choose **Continue unaffected
   products**. The server rechecks current permission and the reviewed fingerprint;
   the worker checks the evidence/graph again before processing. Source jobs are
   never removed, replayed, or marked successful by this action.
5. Monitor the existing compact sync status/progress. The continuation recalculates
   stock from uncached Woo reads and requires write acknowledgement. Failed reads
   do not fall back to cached stock. Lease checks remain at product/write boundaries.
6. Review excluded stock separately. Finishing the continuation does **not** unlock
   normal Sync All or scheduled BOM admission. Reconciliation remains required.

## Failure and retry semantics

- One retained continuation slot per account (`bom_recovery_<normalized account>`)
  deduplicates concurrent requests and retry after an ambiguous HTTP response.
  Its payload records source job IDs, the observed fingerprint, requesting user,
  and the confirmation timestamp. Both success and failure remain retained.
- Refresh status after an unacknowledged submission. Repeating the same reviewed
  request returns that continuation's status; it does not create a replacement.
- A changed source occurrence, checkpoint, target membership or dependency graph
  invalidates approval. A worker-side mismatch fails before stock processing.
- A failed continuation cannot itself be automatically continued again. Preserve
  its checkpoint and investigate; do not delete its slot to force another attempt.
- Product-level failures do not stop processing other admitted products, but the
  final job is failed rather than marked safe for automatic replay.
- All manifests/graph reviews are capped at 10,000 BOM targets. Over-limit,
  malformed, foreign-account, unavailable or incomplete evidence fails closed.

## Older jobs

Jobs with only counters (for example `367 / 1,908`) have no reliable product cursor.
Their historical query order, in-flight target and partial writes cannot be
reconstructed from those counters. The UI explains that continuation is unavailable
and performs no writes. Deploying this feature does not fabricate a checkpoint for
the existing failed occurrence. An authorized inventory review is still needed to
establish a safe recovery for those older jobs.

Do not use queue cleanup, manual retries, `DEL`, or cancellation to erase failed or
completed recovery evidence. To release the block after explicit inventory review,
use **Complete inventory review & unlock** on the BOM page. Follow
[Review inventory and unlock BOM sync](bom-inventory-review.md): the operator's
notes and normalized execution evidence are archived before an occurrence-bound
release marker is applied. This is separate from continuation and also supports
counter-only legacy runs after a full inventory review.

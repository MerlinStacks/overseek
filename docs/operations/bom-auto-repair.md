# Automatic BOM repair

**Repair & resume** is the normal recovery path on **Data Sync → BOM Inventory**.
It replaces the catalogue-wide manual stock review with a fresh calculation and
verification run. Manual inventory review and untouched-target continuation remain
collapsed fallback/advanced options.

## Deploy

Deploy the matching web, API and **all BOM workers** together. Retire old worker
processes before enabling repair: old code does not understand repair jobs. In
the default deployment workers run inside the API process. No database migration
is required; repair evidence uses the existing audit trail and retained queue jobs.
Preserve normal Redis/database backups.

## Use it

1. Sign in with inventory-management (`manage_inventory`) permission and open the
   blocked BOM page. Run details and repair eligibility load automatically.
2. If the page asks for a **previous-worker/request-settlement confirmation**, have
   a system administrator verify the old execution's process is stopped and all
   outstanding WooCommerce requests have finished. Then tick that one box. A
   failed queue state, an expired lock, or a fixed waiting period is not proof.
   If this cannot be established, do not confirm it. No manual catalogue-wide
   inventory review or review notes are required for automatic repair.
3. Click **Repair & resume**. It runs in the background with progress updates.
   Keep BOM definitions and mappings stable while it runs.
4. On full success the page reports how many targets were repaired and how many
   were already correct. The old failure is archived and normal manual/scheduled
   admission is unlocked. The repair has already synced the catalogue; there is
   no need to run Sync All immediately afterward. It does not turn on a schedule
which an operator previously paused.

Older workers sometimes marked a queue job completed while recording failed or
unfinished product writes in its progress. Those records now require repair too;
the queue's completion label alone is not treated as proof of safe stock writes.

If a submission is interrupted while archiving an earlier repair slot, its
admission claim stays retained rather than expiring automatically. Refresh status;
if it persists, an administrator must establish that the interrupted admission
request has stopped before using the manual fallback. Never delete/reset the
claim while an older request could still resume slot removal.

A completed prior repair with no uncertain writes can provide the settlement
evidence for another attempt, as long as the original source executions have not
changed. In that case the extra checkbox is not shown. A crashed repair or an
unacknowledged write requires renewed settlement confirmation.

## What it repairs

- Reads every **current active stock-bearing BOM**, even if the old failed run
  retained counters only and has no reliable product cursor.
- Calculates child BOMs before dependent parents, including acyclic sibling
  variation dependencies. Cycles and dependencies on failed inputs become named
  exceptions instead of guessed calculations.
- Uses fresh WooCommerce reads, exact variation endpoints and current internal
  inventory. Failed live reads never fall back to cached component counts.
- Updates only derived parent/variation inventory, preserving live backorder
  policy. It checks quantity and availability status where supplied, requires
  write acknowledgement, then independently rereads stock/components to verify
  the result. It does not consume components or repeat order deductions.
- Refreshes local stock mirrors so the preview reflects observed source stock.
- Leaves intentionally deactivated and supplier/cost-only components alone.

It **does not** invent physical counts, guess intended mappings, turn stock
management on, or convert a parent-managed variation into a new native stock
owner. Those facts/settings must be correct before they can be used as inputs.

## If there are exceptions

Unrelated products are still checked/repaired. The page then shows each exception
with the product link, SKU, variation ID, safe failure category and corrective
action. Use **Show more exceptions** if needed.

- **Mapping, quantity or stock-owner problem:** fix that product/component's
  configuration and run repair again.
- **Woo connection/permissions/rate limit:** restore the connection or let the
  provider limit clear, then run repair again.
- **Stock changed during verification:** inspect competing inventory updates and
  run a fresh repair against settled inputs.
- **Unsettled stock work:** allow receipts, component deductions and other stock
  cascades to finish or reconcile them in their own workflow. Repair does not
  override pending native operations, frozen receiving or unresolved legacy
  stock work. Unknown legacy target sets cannot be assumed unrelated.
- **Cycle/dependency problem:** inspect the linked BOMs and their stock owners.
  Dependents of failed products are excluded from writes during this attempt.

Normal bulk admission remains paused until the whole repair verifies successfully;
this is not a blind “clear error” button. However, valid independent products have
already been processed and the remaining blockers are explicit, not a generic
failure. Subsequent repair attempts use fresh inputs and archive the previous
report before reusing its queue slot. Do not manually retry an initialized job.

## Safety and evidence

Repair uses a retained `bom_repair_<normalized account>` job in the existing BOM
queue, with one attempt and no automatic completed/failed pruning. All BOM
admission/status paths recognize this fourth slot. Individual sync buttons/API
requests cannot bypass running or unreconciled BOM work.

The worker checks its lease, cancellation, source execution fingerprint and
current BOM definition at write boundaries. It checks inventory-manager permission
again when executing and finalizing. Pending native stock movements and active
stock cascades are not superseded by a repair calculation.

Only a complete verified run can archive/release the original executions. The
audit records actor, normalized source manifests/checkpoints, safe failure
categories, repair counts, product exceptions and execution fingerprints. Atomic
Redis comparisons stop stale approval from marking a changed/reused job reviewed.
A successful repair report is also bound to its own execution. A partial report,
lost lease, changed graph, unavailable archive or missing acknowledgement never
authorizes normal bulk replay.

Queue admission alone does not prove the old worker's HTTP writes settled; that
is why legacy/ambiguous cases need the single explicit confirmation. Likewise,
this is not an atomic freeze across WooCommerce, sales, physical inventory and
independent integrations. Fresh/read-back checks reduce stale writes and surface
detected changes; they cannot certify physical stock or fence every external
writer. If these limits prevent safe repair, use
[manual inventory review](bom-inventory-review.md) or investigate the specific
stock movement before proceeding.

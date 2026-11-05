# Review inventory and unlock BOM sync

Use **[automatic Repair & resume](bom-auto-repair.md)** first when **Data Sync →
BOM Inventory** is blocked. The procedure below is the **Manual inventory review
(fallback)**, opened from its collapsed section on that page. It is for cases in
which automatic verification cannot establish safe stock inputs or an operator
deliberately chooses to review inventory rather than automatically repair it.
Manual unlock does not repair inventory for you.

## Deploy and prepare

1. Deploy the matching API, worker and web changes through the normal release
   process. No database migration is required; the archive uses `AuditLog`.
   Retire old API/worker instances, not just the browser bundle. In the default
   deployment, workers run inside the API process; keep the replacement API
   available to perform this review.
2. Preserve normal database/Redis backups. Do not delete jobs, clear Redis,
   manually retry the failed job, or edit its progress.
3. Pause automatic BOM syncing in **Overview & schedules** for the maintenance
   window. Coordinate with other inventory operators: no BOM definition edits,
   queue retries or independent stock corrections during verification. If stock
   is changing through sales or other integrations, use an agreed inventory
   cutoff/maintenance window and account for movements since that cutoff.
4. Have a system administrator verify that the **previous execution's process**
   is gone and any outstanding WooCommerce requests have finished. Check process
   and store/request logs. Restarting the old process can establish that it no
   longer runs, but does not prove a request already received by WooCommerce has
   finished. A failed state, expired lock, or an arbitrary waiting period is not
   proof. Do not confirm this condition if it cannot be established.

## Review the inventory

1. Open **Data Sync → BOM Inventory** as a user with **inventory management**
   (`manage_inventory`) permission. The failed-run panel loads automatically.
   Everyone who can access the page can see the safe failure category and run
   identifiers; only inventory managers can release the block.
2. Record the run ID and finish time. For an unrecognized failure, a system
   administrator must inspect worker logs around that execution. Raw provider
   messages are intentionally not displayed because they can include credentials.
3. Establish the review scope:
   - **Reliable checkpoint:** inspect every uncertain target, its other
     variations, and downstream BOMs which depend on its stock. The linked
     product, variation ID and retained failure category identify where to
     investigate. The UI shows at most 100 targets per run; if truncated, review
     the entire BOM inventory or have an administrator inspect the complete
     retained manifest/checkpoint. A checkpoint is not a receipt for a Woo write.
   - **Counters only / missing checkpoint:** review **all BOM inventory**. A
     counter such as `367 / 1908` cannot identify which products were attempted,
     so neither the 199 pending products nor a guessed “367th product” is an
     adequate review scope.
4. Click **Total BOM Products** to see the full locally calculated list, not only
   **Needs Sync**. Expand products to inspect components. Open affected product
   links in separate tabs to inspect the BOM. Also review the deactivated-items
   banner and confirm those exclusions are intentional.
5. Compare each reviewed BOM against the source of truth:
   - In WooCommerce, check the actual product/variation, stock-management
     settings, quantity and recent stock/order movements. Verify the mapping
     points to the intended variation, not just its parent.
   - Verify component quantities against physical stock or the authoritative
     stock ledger. Correct Woo-managed components in WooCommerce and internal
     components in OverSeek's internal inventory. Do not overwrite correct live
     stock with stale cached preview values.
   - Confirm required quantities and waste factors. In a simple BOM, buildable
     units are the minimum of `floor(component stock / required quantity)`;
     required quantity includes waste and repeated references to the same
     component are combined. For example, 98 boards at one board per product
     support 98 finished products, assuming no other limiting component.
   - Review dependent BOMs as well. A partially completed parent-stock update
     may affect calculations for products that use that parent as a component.
   - Reconcile any uncertain parent write against actual WooCommerce quantity
     and stock movements, including sales after the failure. Correct confirmed
     discrepancies through normal inventory controls, not by replaying the old
     job. Keep notes of what changed and why.
6. Refresh/import products from WooCommerce through the normal product sync and
   wait for it to finish, then refresh the BOM preview. **The BOM page's refresh
   button reads local data; it does not fetch live WooCommerce inventory.**
   Recheck against live stock before approving the review. A zero “Errors” badge
   only reflects row-level UI errors, not proof that a retained run is safe.

## Release the block

1. Choose **Refresh run details** after finishing your investigation.
2. Enter review notes (20–4000 characters) describing scope, stock evidence,
   corrections and old-worker/request-settlement verification. For example:

   > Retired the previous API worker and verified its Woo requests completed.
   > Legacy run: reviewed the full BOM inventory and active/deactivated component
   > mappings against the stock ledger and live Woo variations. Corrected the
   > identified component counts, accounted for subsequent sales, imported fresh
   > product stock and checked dependent BOMs. Evidence: inventory review ABC-123.

   Use actual evidence; do not copy this as an attestation for checks not done.
3. Tick both confirmations, then click **Complete inventory review & unlock**.
4. The server rechecks current permission, account ownership, terminal job states
   and an occurrence-specific review fingerprint. It writes a durable audit
   archive **before** applying any release marker. An atomic Redis comparison
   prevents a stale review from marking a changed or reused job as reconciled.
   Failed jobs are not relabeled successful or replayed.
5. The banner disappears after status refresh and normal manual/scheduled BOM
   admission is allowed again. The review itself makes **no stock writes** and
   does **not** enqueue a sync. Keep the schedule paused until ready; choose
   **Sync All**, monitor the result, then restore the schedule if appropriate.
   A subsequent admission may remove the archived executions' reusable Redis
   slots; the normalized manifest/checkpoint, counters, safe failure categories,
   execution fingerprints, operator, notes and confirmations remain in the audit
   trail (`BOM_INVENTORY_RECONCILED`, resource `BOM_SYNC`). Raw provider secrets
   are not copied into the audit trail.

## If approval fails

- **Run changed:** reload details and investigate the new evidence. Approval is
  bound to an execution, not just its reusable job ID.
- **Still running/queued:** do not force-clear it. Resolve that work and verify
  request settlement first.
- **Archive/database unavailable:** the block remains. Restore the service and
  refresh before trying again.
- **Response lost or partially applied:** refresh run details and sync status.
  Some execution markers may already have been saved, but remaining unreviewed
  failures still block admission. Review the remaining evidence before approving
  again; don't blindly repeat the old request.
- **Malformed/oversized evidence:** preserve it for a separately reviewed
  administrative archive. Do not use queue cleanup as a workaround.
- **A new run fails after release:** this is a new incident. Previous approval
  cannot authorize it; inspect the new run and its product details.

These checks are not a distributed inventory freeze. Operators still need to
coordinate independent inventory edits and provider-side requests. Do not unlock
when the required facts cannot be verified.

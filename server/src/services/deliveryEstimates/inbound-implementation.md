# Server inbound projection stage

Historical stage report. Current freshness coverage and stock-derived versus cost-only
BOM eligibility are documented in `docs/delivery-freshness-launch.md`. Current source
reads filter `boms` to inventory-linked items; SupplierItem/labour-only cost BOMs use
normal native-product inputs and owner certification, never component-derived dates.

The wire contract remains `inbound-contract.md`. This implementation sends only
`receiptSafety: 'unverified'`; `pending` is not live readiness. Status reports
`storefrontActivated: false`, even when every transport revision is acknowledged.

## Durable work and bounds

- `DeliverySyncAccount` holds separate pending-work/full-build flags, a coalesced full
  generation, active generation, phase/cursor, fenced build version, retry state and
  independent inbound capability. `DeliveryInboundDirtyTarget` coalesces ordinary
  invalidation by `(accountId, wooId)` with an incrementing version.
- Source mutation transactions lock **Account first**, before source/stock writes
  and before the PO advisory lock. Dirty intents commit or roll back with source data.
- Each background transaction visits at most 10 dirty targets and, when a full build is
  pending, one additional page of at most 10 products/outboxes. Reserving the full-build
  page prevents a continuous target stream from starving the scan;
  at most four pages per drain, oldest-served accounts first. Targets take precedence.
  A target snapshot/outbox and version-CAS deletion commit atomically. A re-dirtied
  version survives deletion of the older version; failed pages retain their targets.
  The API never scans the catalogue. Manual sync and supplier edits/deletion are the
  only full-build triggers. A running full sweep completes its cursor, then repeats
  if another full-build trigger dirtied its generation. Ordinary targets neither
  increment the full generation nor rewind the cursor.
- Each product reads at most 1001 variations (overflow sentinel), 1001 direct
  ORDERED PO lines (overflow sentinel), and one BOM existence row. The supported
  limits are 1001 targets, 1000 source lines, 1000 aggregate batches, quantity
  1..1,000,000 and lead days 0..3650. Exceeding a bound emits a parent
  `integrity_error` with no lead or batches; omitted targets are cleared. No partial
  optimistic truncation. Transport also enforces the 512 KiB envelope bound.
- Eight consecutive page failures park the build; backoff is capped at 15 minutes.
  Explicit sync clears failure/suppression and resumes the cursor. Failure writes
  are fenced against subsequent progress/retry. Normal saves do not clear a terminal
  build or unsupported capability decision.
- Full builds visit only parents with a production min/max override or a variation
  with a production min/max override. Explicit zero is configured. They replay
  existing inbound outboxes not visited in that generation, even after configuration
  removal or product deletion. Untouched catalogue products are never enrolled.
- Ordinary targets are eligible only if that exact parent/variation has configured
  production or an inbound outbox already exists. Delivery settings alone do not
  enrol an unconfigured catalogue. Existing rows remain eligible for clears even
  without settings/production. Eligibility never clears disabled-feature settings,
  unsupported capability suppression, or terminal failure state.
- Transport retries send the stored payload unchanged, including expired timestamps.
  Freshness is only created by a new build. No periodic freshness renewal is claimed.
- A dispatch scan with no candidate reconciles its wake under the Account writer
  lock: empty accounts sleep, pending work retains its next wake, and `lastServedAt`
  advances. The update CAS checks the observed transport lease and generation/version,
  so a newly claimed lease cannot be overwritten. This includes empty supplier builds;
  five empty accounts cannot indefinitely consume all five dispatch selection slots.

## Mutation coverage

Transactional targeted dirty intents cover PO create, status/expected-date update,
complete line replacement, draft deletion, receipt and reversal. PO replacement
queues the union of old/new direct parent IDs; deletion uses old lines; receipt and
reversal use the loaded PO item parent IDs. Internal IDs are resolved tenant-scoped
inside the source transaction. Notes/tracking-only PO edits do not enqueue work.
Generic product saves enqueue only actual supplier assignment/clear or parent
stock-owner (`manageStock`) changes. Name, price and SEO edits enqueue nothing;
unchanged supplier/stock-owner values enqueue nothing. Local delivery production
edits enqueue only that parent. Supplier update/deletion and explicit delivery sync
retain full-build fanout, restricted as above. Direct PO variation inputs are validated against
their tenant-owned parent; the builder independently validates the current mapping.
SupplierItem links, names and SKUs never infer supply. Only `product.supplierId`
supplies lead days, inherited by variations. Existing inbound rows also receive
empty replacements after product deletion on the next full supplier/manual rebuild
or a specifically enqueued target, rather than on unrelated inventory activity.

Variation ownership edits in `services/products.ts` now save each bounded batch under
the Account lock, atomically with parent invalidation. An explicit `manageStock`
accepts `true`, `false`, or `'parent'`, matching Woo variation REST ownership values.
Only `true` sets the local Boolean independent-management flag; `rawData.manage_stock`
preserves the exact Boolean/parent marker. Missing ownership leaves both existing
fields intact. False inherits when the live/local parent manages stock. Changed
ownership clears/replaces the projection on rebuild; unchanged values do not enqueue.
Parent transport honors an explicit Boolean `manageStock` instead of overwriting it
with the previous local value. These saves do not certify remote stock acknowledgement.

## Incremental costs

- Name/price/SEO-only product saves: **zero additional inbound reads/writes**, no
  inbound account lock/transaction. Supplying supplier/stock-owner fields performs
  an account-locked current-source comparison; unchanged values enqueue nothing.
- For `K` distinct requested Woo parents, eligibility performs two indexed/scoped
  lookups per chunk of at most 100 IDs (configured parents and existing inbound
  rows). Each eligible parent gets one dirty-target upsert, regardless of catalogue
  size; each nonempty eligible chunk gets one account wake/version upsert. No
  payload construction, outbox revision update or network occurs on this path.
- PO mutation cost is proportional to its old/new direct parent IDs, not catalogue
  size. Tenant resolution adds one ID-constrained product lookup per 100 distinct
  internal parent IDs, followed by the eligibility costs above. Duplicate lines
  for one parent coalesce. Unlinked/empty PO inputs perform no target work.
- Variation ownership processing adds one tenant/parent-scoped bulk read per existing
  five-variation batch containing explicit ownership fields, rather than per-variation
  reads. Local upserts remain one per variation. A changed batch invokes parent
  eligibility/invalidation once; unchanged batches do not. Batches without ownership
  fields add no ownership reads, account transaction or dirty work. Woo requests run
  after the local transaction and retain the existing five-request concurrency bound.
- No-candidate reconciliation performs one locked control read, one pending-row lookup
  and, if necessary, one leased-row recovery lookup plus a CAS control update. It
  creates no outboxes and performs no network requests or catalogue reads.
- A target page builds at most ten parents using the existing per-product source
  limits. Only those parents get new inbound payloads/revisions; unrelated inbound
  rows are not read, replayed or revised. Target selection and CAS deletion use the
  account/identity indexes, with an account/creation-time ordering index.
- A full build costs `O(C + E)` projection work where `C` is configured parent count
  (including variation-only overrides) and `E` is existing inbound rows outside that
  scan. Database filtering of the configured set may examine unconfigured catalogue
  rows, but never loads/project them. Supplier fanout currently uses this entire
  relevant account set, not just the edited supplier's products. Migration backfill
  preserves full work already pending from the earlier stage.

## Exact coverage gaps / pending safety work

1. **Receipt transport is unchanged.** Local receipt/reversal commits precede
   fire-and-forget absolute Woo stock writes. Concurrent receive/reversal transports
   can arrive out of order, fail, or be lost at process exit. Account locks serialize
   local writes/builds only; they are not a remote receipt fence. The purchase-order
   route also performs transition checks, reversal/update and receipt as separate
   operations; it is not a single transition transaction. Existing stock quantities,
   whole-order semantics, remote retries and BOM cascade behaviour are preserved.
2. **BOM edits are not hooked.** `routes/inventory/bom-products.ts`, other BOM routes,
   BOM services/cascades and internal-component edits do not enqueue inbound work.
   At this historical stage any BOM existence was unsupported. Receipt gating protects
   managed stock but is **not sufficient for unmanaged production-only estimates**:
   a newly added BOM can leave a previously pending unmanaged target stale until
   rebuild. Therefore unmanaged support is also **not ready for live storefront
   use**, even with `receiptSafety: 'unverified'`. There is no storefront activation
   in this stage. Cover BOM mutations (with reviewed lock ordering) or add a separate
   fail-closed eligibility gate before activating unmanaged estimates.
3. **External catalogue/stock mutations are not hooked.** `services/sync/ProductSync.ts`
   reconciliation/upserts/deletions, Woo webhooks, direct Woo changes and stock-specific
   routes do not transactionally invalidate this stage. Product/variation deletion
   clears are generated on a full supplier/manual rebuild or a specifically queued
   parent, not immediately and not on unrelated ordinary inventory mutations.
   Explicit variation ownership edits in `services/products.ts` are now covered by
   their own transactional targeted invalidation. Delayed 404 deletion there is still
   not queued and needs a later full rebuild or a covered mutation of that parent.
   Adding these hooks requires reviewing their write/lock order and transport lifecycles.
4. **No automatic 24-hour refresh.** Without a covered mutation or manual sync, blobs
   expire and must fail closed locally. This is input persistence, not live activation.
5. Tests exercise transaction rollback/generation fencing with in-memory adapters;
   no live PostgreSQL deadlock/concurrency test or database migration was executed.
   Client/plugin code and the local adapter are outside this server-only change.

Before activation, implement durable pending-before-stock fencing, ordered/idempotent
stock transport and final projection acknowledgement. Never interpret `synced`, a
fresh timestamp, or `inboundInputs: true` as receipt certification.

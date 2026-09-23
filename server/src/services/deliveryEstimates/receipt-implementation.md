# Staged guarded receipts — server implementation

`receipt-contract.md` is the protocol authority. This stage adds no enable,
reconciliation, release, or cutover endpoint. `Account.receiptTransportMode`
defaults to `LEGACY`; capability discovery never changes it.

## Local receipt semantics

- The existing Account → PO lock order selects the persisted mode inside the
  stock transaction. Legacy stock calls and their background BOM cascade retain
  their existing path. Guarded calls return before legacy transport construction.
- Guarded receipt validation accepts verified, independently managed simple
  products/variations only. Missing mappings, supplier-only lines, variable
  parents, parent-managed variations, and BOM products/components reject the
  transaction. Component rejection deliberately avoids an uncovered BOM cascade.
- Duplicate lines aggregate per owner within a receipt. Separate receipt events
  never coalesce. An active receipt cycle makes repeated receives no-ops.
- Reversal reads positive operations from the active cycle, revalidates their
  original local/Woo identities, and records opposite deltas. Edited current PO
  lines are not reversal inputs. Missing guarded provenance rejects reversal.
- Local stock, audit, PO status, receipt cycle, owner sequence, operation, and
  inbound invalidation commit together. Neither Redis nor Woo is needed on save.
- Generic status edits cannot manufacture/drop guarded RECEIVED state; the
  dedicated receive/unreceive methods own these transitions.
- PO/product provenance is stored as immutable scalar IDs, without cascading
  source FKs. PO deletion cannot erase pending, parked, applied, or reversal
  operations. The SQL trigger protects immutable operation fields. Account
  ownership is still enforced through account FKs and tenant-scoped queries.

## Dispatch semantics

- A bounded scheduler serves up to 10 accounts per tick (hard maximum 25), one
  owner head operation per account. Independent account and owner token leases
  expire after 120 seconds. Operation attempts increment after capability
  validation, immediately before receipt transport, including attempts later
  lost to process crashes.
- A shared account lease single-flights capability discovery. Missing
  `guardedReceipts: true`, unsupported schema, or auth/404 failures persist
  account suppression. New owners cannot trigger repeated old-plugin probes.
- Transient capability discovery failures use a separate durable account attempt
  budget and due time, enforced by both selection and direct dispatch. Discovery
  reserves an attempt and exponential-backoff deadline before probing, so a crash
  cannot reset the budget. Backoff is 30 seconds to 1 hour, capped at eight
  attempts before account blocking. Success resets this budget; discovery outages
  do not consume the queued owners' operation attempts.
- Prepare requires an exact ACK before apply. A replay already acknowledged as
  applied can finish directly. ACK identity/schema/state, active guard, and
  `receiptSafety: unverified` are validated. Applied stock quantities must be safe
  integers (including negative values); prepared/uncertain quantities must be null.
- Lost responses replay the same immutable operation and phase; a persisted
  prepared ACK allows apply replay after a restart. The plugin's append-only
  journal, not server quantity comparison, prevents repeat stock application.
- Explicit uncertainty, invalid ACKs, conflicts, and exhausted attempts park the
  owner. Transient losses use exponential 30-second to 1-hour backoff, capped at
  eight durable attempts. No later owner sequence can pass an unresolved head.
- HTTP 409 with exact plugin code `overseek_receipt_busy` is transient advisory
  lock contention: replay the same operation with the bounded operation backoff.
  Other 409 conflicts remain parked. A busy replay cannot send a later sequence.
- Late/expired ACKs cannot update operation state or clear a replacement lease.
  Applied state, owner advancement, and inbound dirty intent commit atomically.
  Receipt ACKs do not upgrade receipt safety or activate storefront estimates.
- Delivery display settings and current transport mode do not cancel already
  recorded inventory operations. No receipt status UI/API has been introduced.

## Exact remaining gaps before cutover

- This is server infrastructure only; the plugin must separately implement the
  guarded capability and prepare/apply journal/guard protocol. Older plugins park.
- No inventory baseline/cutover, legacy task draining, manual uncertain-operation
  reconciliation, final version-bound projection release, or expired-data renewal.
- Guarded BOM stock mutation coverage is intentionally unsupported and rejected.
- Unit tests use transactional in-memory doubles and transport mocks. Actual
  PostgreSQL locking/constraints/trigger behavior, MySQL journal durability,
  native Woo hooks, and multi-process crash recovery require integration tests.
- The additive migration is supplied but not executed by this implementation task.

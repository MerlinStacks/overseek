# Guarded receipt transport v1 — staged, not enabled by default

Purpose: make a persistent local pending guard precede a receipt/reversal stock change, and never blindly repeat an ambiguous stock operation. This is not yet the final projection-release protocol and does not enable customer-facing estimates.

## Compatibility boundary

- Account transport mode defaults to `legacy`. No UI/API may automatically enable guarded receipt transport in this stage. Existing stores continue the original receipt/reversal behaviour.
- In guarded mode, record immutable operations in the same Postgres transaction as local stock/PO changes. Do not also run legacy Woo stock writes for those operations. Existing BOM cascade logic must remain separate and must not mark a receipt complete.
- Only direct simple products and independently stock-managed variations with verified identity are supported by the guarded protocol. Unsupported ownership/types fail explicitly; do not silently convert stock ownership or fall back to an absolute-stock update.
- No change to storefront activation or receiptSafety. Capabilities add `guardedReceipts: true`, `receiptFinalization: false`; `inboundReceiptSafety` and `storefront` remain false. The account mode stays legacy until a later explicit cutover procedure verifies compatibility and drains/reconciles legacy writes.

## Immutable operation

```ts
type ReceiptOperation = {
  operationId: string; // UUID-like opaque [A-Za-z0-9_-], <=128; account-scoped
  sequence: number; // positive safe integer, strictly +1 per account/stock owner
  productWooId: number; // positive parent/simple Woo ID
  variationWooId: number | null; // explicit null for simple
  stockOwnerWooId: number; // productWooId or independent variationWooId
  delta: number; // nonzero integer -1m..1m; +receipt / -reversal
};
```

Per-owner operation ordering must survive crashes and retries. Do not coalesce receipt deltas, rewrite an existing operation, or send a later sequence while an earlier apply is unresolved. Aggregate duplicate PO lines for one owner into one delta before recording. Preserve the actually received quantities for later reversal; guarded reversals must not blindly reverse edited PO lines.

## Authenticated plugin protocol

Reuse linked-account REST management permissions and mandatory `X-Overseek-Account-Id`. Endpoints:

- `POST /delivery-estimates/receipts/prepare`
- `POST /delivery-estimates/receipts/apply`

Both accept exactly `{ schemaVersion: 1, operation: ReceiptOperation }`, max 16 KiB. Both return `{ schemaVersion: 1, operationId, sequence, stockOwnerWooId, state: 'prepared'|'applied'|'uncertain', stockQuantity: number|null, guardActive: true, receiptSafety: 'unverified' }`.

Reject reused operation IDs with different data, sequence gaps/stale conflicts, invalid identities or unsupported local stock ownership with 409/400 as appropriate. Exact replay must not mutate stock again. Old operation IDs remain in an append-only local journal so a replay after newer operations is still recognised.

1. **Prepare:** lock the owner, validate actual Woo type/parent/stock owner and managed-stock state, persist an active guard and the immutable operation in private InnoDB storage, commit, then acknowledge prepared. No stock writes.
2. **Apply:** require the exact prepared operation and current owner guard under a per-owner lock. Persist `applying` durably BEFORE invoking Woo stock APIs. Apply an increment/decrement to authoritative Woo stock, not an absolute server snapshot. On success persist `applied` and observed result. Keep guard active.
3. **Ambiguity:** a crash/error after entering applying leaves `uncertain`; neither a repeat apply nor a later sequence may call Woo stock mutation again. Return uncertain on retry. Reconciliation is a later explicit workflow, not an automatic overwrite or reverse/reapply.

Native Woo stock hooks may invoke other plugins and are not transactionally coupled to our journal. This protocol allows **at most one endpoint-controlled invocation of the native stock API for an operation**, with explicit uncertainty; it does not promise exactly-once stock effects across arbitrary hooks or database-driver reconnect/replay behaviour. Unexpected query traces remain uncertain rather than triggering another invocation. Do not hold a WordPress transaction across native stock hooks. An owner advisory lock serialises cooperating endpoint calls, but cannot claim all other inventory writers use it.

Do not mark an operation applied solely from matching quantity (sales can return to the same quantity). Do not send supplier/customer/cost data. Use Woo CRUD/stock APIs, no direct stock-table writes; clear caches as Woo requires. Product types, ownership, quantity and stock state must be revalidated before mutation.

## Durable server worker

- Per-owner persistent sequence/lease, immutable operation rows with attempts/due time/error, account and PO provenance. Capture the operation in the same transaction as local receipt changes; transactional intent must not depend on Redis or Woo availability.
- Background prepare ACK must match schema/operation/sequence/owner/state before apply is sent. A lost prepare ACK can be retried. Apply replays are safe only because the plugin journal checks identity before touching stock.
- Record `applied` only for an exact successful ACK. `uncertain`, schema/ownership conflicts, auth/capability problems and capped retries park for explicit attention. Later same-owner operations remain blocked. Never silently route a guarded operation through legacy stock transport.
- Bounded processing and exponential backoff, no catalogue scans or remote requests on PO save. Older plugins must not be probed once per queued owner every tick; account-level suppression is required. Disabled delivery display does not cancel already-recorded inventory operations.
- Acknowledgement means stock operation completed, not estimates safe. Dirty the relevant inbound projection after apply; it remains receiptSafety=unverified. No final release/verified projection in this stage.
- Optional status read may expose counts/errors, but there is no enable/release/reconcile endpoint or merchant control until cutover and recovery are implemented/tested.

## Next safety work before guarded cutover or storefront activation

Inventory baseline/cutover, legacy task drain, manual uncertain-operation reconciliation, final version-bound inbound projection release, all relevant stock/BOM mutation coverage, expired-data renewal, and real PostgreSQL/MySQL/native-Woo integration tests. The local adapter continues rejecting managed-stock estimates meanwhile.

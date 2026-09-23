# Delivery inbound inputs v1 — staged safety contract

This stage persists supplier/inbound projections but **does not certify receipt safety**. Existing PO receipt stock transport is asynchronous and not ordered with projections. Do not expose supply-dependent promises from these inputs yet.

## Wire envelope and capability

Reuse `/delivery-estimates/inputs`, account authentication, revision checks and the 512 KiB envelope bound. New `scope: 'inbound'`, positive entityId = parent/simple Woo product ID.

```ts
type Lead = { min: number; max: number } | null; // integer 0..3650 calendar days
type InboundPayload = {
  wooId: number; // same as entityId
  generatedAt: string; // UTC ISO instant from actual build, never refreshed on transport retry
  expiresAt: string; // generatedAt + 24h, conservative input validity, NOT a safety certificate
  receiptSafety: 'unverified'; // ONLY value currently accepted; cannot send ready/verified yet
  targets: Array<{
    wooId: number; // simple/parent or a variation belonging to this parent
    stockOwnerWooId: number | null; // intended independent owner, null if unsupported/unknown
    state: 'pending' | 'unsupported' | 'integrity_error'; // no ready state in this stage
    supplierLead: Lead;
    batches: Array<{ dueDate: string; quantity: number }>; // date YYYY-MM-DD, positive integer <=1m
  }>;
};
```

Full replacement: no old target or batch survives omission. Empty targets is a tombstone and must be accepted even if the Woo product has been removed. Cap targets at 1001 and total batches at 1000; do not silently truncate. Malformed mappings/quantities/leads fail closed or emit an explicit integrity_error with no batches, not a ready empty projection.

Capability response adds `inboundInputs: true`, `inboundReceiptSafety: false`. Keep configurationSync=true, storefront=false. Server must check inboundInputs separately before dispatching this scope; older sync-capable plugins must still receive settings/production but park inbound rows.

## Projection source

- Only direct linked product/variation PO lines from tenant-owned ORDERED purchase orders. Full ordered quantity reflects existing whole-order receipt semantics, not a partial-receipt balance.
- Validate direct variation belongs to parent; do not match SKU/name or infer SupplierItem mapping. Aggregate each line once into dated batches per target. Exclude draft/received/cancelled and undated/overdue lines from dated supply; date policy is the UTC date label stored from the PO's date input (never apply an accidental timezone shift).
- Supplier range comes from the product's assigned, tenant-owned Supplier; a valid complete min/max pair wins, otherwise a valid single default. Unset means null; malformed/half ranges are integrity errors. Variations inherit this supplier source; no invented SupplierItem mapping.
- Stock-derived finished-product BOMs and stock-owner ambiguity are unsupported. Any declared child-product, child-variation or internal-product reference counts as stock-derived, including inactive or malformed references. SupplierItem/labour-only cost BOMs do not exclude the native product: only its production range, assigned supplier lead and direct product PO lines participate; component dates are never inferred. Parent-managed variations share their effective owner's deduplicated pool; independent owners remain separate.
- Rebuild intents must survive commit/process failure and be coalesced, bounded background work. Rebuild current source data, including empty replacements after PO removal; never reuse an old ready projection or renew freshness on a transport retry.
- Local saves must not make remote requests. Existing stock-receiving behaviour must remain unchanged in this stage.

## Local adapter rules

- Read only local configuration, production and inbound input blobs, plus live Woo product/variation stock and actual caller-provided eligible WC shipping rate objects. No network, stock writes, shipping-rate calculation or catalogue scans.
- Resolve real Woo stock owner, variation inheritance (zero is explicit), whole-cart demand, virtual/nonshipping exclusions, and purchasability/backorders. Reject unsupported custom types, invalid/fractional quantities, stale/missing input and unsupported/mismatched ownership.
- **Managed-stock physical items remain unavailable while receiptSafety is unverified, even if current stock covers quantity.** This prevents an unreceive/reversal window from promising stock awaiting removal. Do not bypass this gate for a preview marked reliable. The pure engine's synthetic fixtures remain useful for algorithm testing.
- Unmanaged physical products may use production-only estimates when local input confirms the target is not unsupported/integrity_error. Pending means receipt-unverified here; no supplier wait is used for unmanaged in-stock products.
- All reads remain linked-account scoped. Settings `enabled=false` always suppresses. There is no activation/display hook in this stage; the adapter is a callable service for later integration.
- Before shopper activation, implement a durable pending-before-stock receipt/reversal fence, ordered/idempotent stock transport, and final projection acknowledgment. Do not flip receiptSafety to verified without that separate protocol.

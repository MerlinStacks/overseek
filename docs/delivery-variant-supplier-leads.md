# Variant supplier leads: plugin contract

Discovery advertises `capabilities.variantSupplierLeads: true`. The v1 inbound
envelope is unchanged. Each target retains its producer-resolved `supplierLead`;
targets sharing a physical owner must still have identical `batches`. Proof owner
membership, stock-owner identity, freshness, guard fencing and held-stock rules
continue to apply.

The live adapter resolves all physical cart targets before invoking the engine.
For each owner it takes the maximum minimum and maximum maximum supplier lead
among those targets only. A null lead resolves to the configured fallback (30 when
absent); explicit zero remains zero. Unselected siblings cannot slow an individual
product preview. Virtual/nonshipping lines do not contribute. Stock, held demand
and batches remain one pool, while each variant keeps its production range.

The pure engine still accepts one effective `stock_owners[owner].supplier_lead`.
Cumulative dated supply covering pooled shortage takes priority. Otherwise the
effective lead applies, retaining the existing floor at the latest usable partial
batch. Production follows supply; whole-order readiness takes the latest endpoints
and ships together. No engine contract change is required.

## Shared fixture

`packages/overseek-core/test-fixtures/delivery-variant-supplier-leads-v1.json`
is a complete server-shaped inbound envelope: parent owner 10, targets 11 (2–4)
and 12 (7–10), identical three-unit batches, unsupported parent target and one
owner proof. Ingestion tests rebase only timestamps to the current UTC validity
window; adapter tests use its fixed clock and proof fixture. The full four-unit
cart uses 7–10, a four-unit A preview uses 2–4, and a two-unit cart uses dated supply.

## Safe input diagnostics

Validation returns `overseek_delivery_input_invalid`, HTTP 400, generic message
`Invalid delivery input.`, with `data.reason` from this fixed allowlist:

- `schema_invalid`
- `inbound_expired`
- `inbound_generated_in_future`
- `inbound_ttl_invalid`
- `product_missing`
- `product_type_unsupported`
- `variation_missing`
- `variation_parent_mismatch`
- `stock_owner_mismatch`
- `owner_pool_batches_mismatch`
- `production_range_invalid`
- `supplier_lead_invalid`
- `payload_limits_exceeded`

Unexpected exceptions map to `schema_invalid`; raw exception text and values are
never returned. The body-size limit preserves HTTP **413** and code
`overseek_delivery_input_too_large`, with `data.reason: payload_limits_exceeded`
and message `Delivery input exceeds the size limit.` Collection-limit validation
continues to use HTTP 400 and `overseek_delivery_input_invalid`.
Authentication/account errors and durable revision/receipt-proof conflict
responses keep their own existing codes.

## Verification

Run the PHP harnesses `delivery-input-reasons.php`, `delivery-inbound-inputs.php`,
`delivery-managed-stock.php`, `delivery-discovery.php`, `delivery-engine.php`, and
`delivery-render-cache.php` under `overseek-wc-plugin/tests/`.

The native aggregate includes `native/delivery-native-variant-leads.php` using its
existing disposable fixture lifecycle and real REST ingestion/Woo inherited stock.
It remaps the shared fixture to its owned native parent/children, current timestamps
and real receipt proof. It checks exact fast-preview and full-cart dates, distinct
variant production ranges, reversed cart order, null fallback versus configured
and target zero, covering dated supply, single-count stock/batches, prepare/apply
guard suppression and matching-proof release. Real REST assertions check typed
expiry/future/TTL/range/owner/batch/schema/collection errors and the HTTP 413 body
limit contract. Settings changes go through real REST and control reactivation.

Its `finally` restores stock/backorder policy, production/settings and inbound
payload with the current proof sequence. The aggregate then cleans up all owned
fixtures. Provision/run via `tests/delivery-native-integration.md`; the native
suite requires the guarded disposable `wordpress_tests` installation. See
`docs/delivery-variant-native-validation-2026-09-23.md` for the completed native
run, exact commands, results and cleanup evidence.

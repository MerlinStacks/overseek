# Local Woo delivery adapter (staged, callable only)

Load `class-overseek-delivery-live-adapter.php` after Woo is available. It loads
the private storage reader, pure engine and rate resolver. No hooks are installed.

```php
$adapter = new OverSeek_Delivery_Live_Adapter();
$result = $adapter->calculate(
    $complete_cart_rows,
    $eligible_wc_shipping_rates,
    new DateTimeImmutable('2026-09-21T12:00:00Z') // optional, UTC clock by default
);
```

## Caller contract

- Pass a **complete, consistent, single ship-together cart snapshot**, using Woo
  `get_cart()` row shape: `data` (live `WC_Product`/`WC_Product_Variation` object),
  `product_id`, `variation_id` (zero for simple products), `quantity`. IDs and
  quantities are strict integers; fractions, numeric strings and floats are
  rejected rather than rounded. Maximum 200 lines and 1,000,000 units per owner.
  Separate cart keys may hold distinct product instances with the same ID.
  These aggregate when their relevant snapshots agree: type/variation identity,
  parent, virtual/shipping flags and, for physical items, purchasability, stock
  owner, management, quantity, status and backorder permission. Conflicting
  snapshots fail closed. Object references and unrelated presentation metadata
  are not compared; unsupported bundle fulfilment remains unsupported.
- Pass actual `WC_Shipping_Rate` objects whose eligibility the caller has already
  established for that complete cart and destination. Empty rates suppress the
  result. This API cannot prove that a caller omitted no lines or packages.
  Multi-package/split fulfilment is outside this API: do not call it for those
  orders. No global cart access, rate calculation or destination guessing occurs.
- The adapter reads `read_settings()`, `read_product(parentId)` and
  `read_inbound(parentId)` from `OverSeek_Delivery_Input_Storage`. Each returns
  `{revision: positive integer, payload: array}` or null, using the currently
  linked account. Storage can be subclassed for local tests. There is no caller
  account selector. Missing linkage, disabled settings or changed linkage fail
  closed. Reads do not install tables or refresh expired inputs.

## Resolution and safety

Simple physical items and variations are supported. Parent objects are loaded
only by explicit ID, and production/inbound blobs are read and indexed once per
parent per call. Repeated calls discard all caches, including stock and expiry.
There are no catalogue scans. Virtual/nonshipping objects are excluded before
quantity or projection checks. Custom physical types fail closed.

Variation null/null or omitted production overrides inherit the parent; explicit
zero/zero remains zero. Unknown effective ranges suppress the entire cart,
including collection. Live identity, parent type, purchasability, stock status,
stock management, owner quantity and backorder flags are resolved from Woo.
`get_stock_managed_by_id()` is authoritative; only the target or its real parent
can own stock, and the inbound target must match that owner. Owner demand is
aggregated across cart lines/variations without double counting the owner stock.

Inbound must have the matching parent ID, a unique known target, valid lead and
batch dates/quantities, and strict UTC timestamps with exactly 24-hour validity.
Future-generated and expired inputs fail closed, including equality at expiry.
This is deliberately stricter than ingestion's five-minute future-clock-skew
allowance: a stored future-generated input remains `inbound_stale` until the
adapter clock reaches `generatedAt`. It then becomes usable within its original
validity window; no timestamp is rewritten or expiry extended.
Only `receiptSafety: unverified` is accepted in this stage. **Every managed-stock
physical cart remains unavailable, even when live stock covers all demand.**
There is no reliable-preview bypass. A durable ordered receipt/reversal fence
and acknowledgment protocol is required before changing this rule.

Unmanaged in-stock items may use production-only dates when their current target
is `pending` with a matching owner. Supplier leads and inbound batches never add
wait time for these items. Unsupported targets (including upstream BOM detection),
integrity errors, tombstones, stale/missing blobs or mismatches suppress all
dates. The adapter does not independently discover arbitrary third-party BOM
metadata: it relies on current upstream unsupported/integrity classification
and rejects custom Woo types. It never promotes a projection to receipt-verified.
The importer permits `pending` simple targets with `stockOwnerWooId` equal to
their own Woo ID even when stock is unmanaged, matching this production-only path.

## Rates and collection

Rates match authoritative method/instance metadata and, for exact mappings, the
full opaque `WC_Shipping_Rate::get_id()`. Exact overrides precede confirmed
instance-wide policies and backward-compatible core-instance policies. Unknown
options stay blank without suppressing other mapped options. Duplicate rates and
invalid configured defaults fail closed; a default never substitutes an absent rate.

Woo core `flat_rate`, `free_shipping`, `local_pickup`, plus explicitly configured
`wbs` and `wbsng` options are supported. Explicit `fulfilmentType: collection` on a
rate produces pickup readiness; `local_pickup` must be configured as collection.
Delivery uses configured transit ranges. Collection uses whole-cart readiness
without inventing a transit/preparation delay. Cutoff, timezone, work/transit
calendars and closures are handled by the existing pure engine.

WBS/WBSNG require `exact_rate` or confirmed `all_provider_rates`; old unverified
rows remain blank. Global vendor method getter -1 is normalized in discovery to
actual rate instance zero, never parsed from a title hash. WBSNG multi-shipment
solution metadata stays excluded. See `docs/delivery-shipping-options.md` for the
API/UI contract, admin actual-rate observation and native 6.18.0 fixture.

## Results and limitations

Success is the pure engine's `available` result with readiness and per-method
dates. It means a local production-only calculation succeeded, **not storefront
activation or receipt certification**. Failure is exactly
`{status: 'unavailable', reason: '<diagnostic>'}` with no partial dates. Common
adapter codes include `feature_off`, `inbound_stale`, `inbound_target_missing`,
`stock_owner_mismatch`, `receipt_safety_unverified`, `unsupported_method` and
`inconsistent_cart`. Unexpected local failures return `local_input_unavailable`.

This is not an allocation/reservation system or transactional Woo snapshot.
There are no stock writes, remote requests, shipping calculations, storefront
display/activation hooks or order snapshots. Live extension compatibility has
not been certified by the stub tests.

Run the standalone local harness:

```sh
php overseek-wc-plugin/tests/delivery-live-adapter.php
```

# Request-scoped cart render calculation reuse

## Contract

`OverSeek_Delivery_Storefront_Context::cart_result(array $rates): array` remains the
shared classic/native Blocks API. Requested rates must be the actual objects in
one certified current package. A cache miss calculates the complete current WC
cart and **all** its actual package rates in one adapter call. The existing resolver
decides eligibility; unmapped options simply have no returned method. Subsequent
callbacks for mapped or unmapped options share that result, including unavailable
results, provided the fresh fence still matches.

`OverSeek_Delivery_Render_Cache` holds **one entry in PHP request memory only**.
No persistent cache, session mutation, public bypass, remote request, shipping
calculation or new receipt-policy implementation is introduced. The existing real
activation gate runs for admission and every changed snapshot. Classic/Blocks no
longer run a duplicate gate before the shared context. An inactive cold callback
performs only bounded gate/control reads, never an adapter calculation or assets.

The SHA-256 key is derived from bounded primitives, not serialized Woo objects:

- Linked account and current environment fingerprint; authoritative control and
  settings revision/payload-hash pairs (therefore activation, epoch and enabled
  state changes invalidate an admitted result).
- Complete cart rows, keys, product/variation IDs, quantities and current product,
  parent and owner type/purchasability/managed-stock/status/quantity/backorder state.
- Complete current package inputs, destination, coupons, user and rate identities,
  methods, instances, label, cost, taxes, tax status, description and metadata.
  `get_delivery_time` is never read while creating a key, preventing recursion.
- Referenced product and inbound revision/hash pairs, including receipt proofs.
  Supported input writers atomically change revisions and payload hashes.
- Live receipt guard operation/sequence/active token and native stock metadata for
  all referenced owners/products, read directly rather than trusting object caches.
- Native held-stock quantities for each managed owner, with current cart hash,
  session draft/awaiting-payment order IDs, order status/hash and matching exclusion.
  Native `wc_get_held_stock_quantity` retains HPOS/filter behavior; no copied held
  stock SQL or optimistic zero assumption. Native stock-store support is rechecked.
- Current UTC minute (covers cutoff/midnight transitions) and explicit generated/
  expiry boundary state for each inbound row. A boundary invalidates even without
  an input write. The adapter receives the snapshot's actual UTC clock on a miss.

Each snapshot uses one bounded UNION query for input headers, receipt guards and
stock metadata. Managed owners additionally require native held-stock reads and a
second identical batch fence afterward. A write during that interval fails closed.
On a miss, matching snapshots are required **before and after** the unchanged
adapter calculation. A token read error, nonprimitive extension payload, bound
violation or changed fence clears the entry and returns unavailable, never the last
available dates. Guard/stock code and proof checks remain in the receipt agent's
implementation; an unchanged fence only certifies equivalence to its prior result.

Bounds: 200 cart lines, 100 rates, 600 referenced products, 4,096 fence rows, 40,000
primitive nodes, depth 12, 64 KiB per string and 2 MiB encoded snapshot. Unknown
objects/resources are rejected without invoking `__sleep`/`JsonSerializable`.
Only engine results leave the cache; guard, account, stock and private input tokens
never enter public HTML or product responses.

## Query expectations

For one managed stock owner, warm callbacks require two batch reads plus the native
held-stock read, rather than rerunning settings/product/inbound/stock/proof reads and
the engine per rate. Native extensions may add queries inside their own getters.
For unmanaged-only carts a warm callback needs one batch read. The cost still
includes live receipt checks by design; request reuse must not hide a newly pending
guard. No caller can select a stale snapshot from an older cart state.

The standalone real-adapter/native-interface harness exercises 20 managed options,
then all classic callbacks, with **one adapter calculation**. Its modeled first
20-option render uses **82 queries** versus the reported 380-query native baseline.
This is an offline measurement, not a claim that live Woo's query count is 82.

```sh
php overseek-wc-plugin/tests/delivery-render-cache.php
php overseek-wc-plugin/tests/delivery-storefront.php
php overseek-wc-plugin/tests/delivery-cart-display.php
node overseek-wc-plugin/tests/delivery-storefront-js.cjs
```

## Native performance probe requests (disposable existing fixture)

Use the same already-activated, proof-valid fixture as the earlier 19/380-query
probe. The harness must preload native current cart/package/rates; do not call a
carrier or calculate shipping merely to benchmark this layer. Record SQL deltas,
actual `OverSeek_Delivery_Live_Adapter::calculate` invocation count via the private
profiler, elapsed time and output. Do not add a public diagnostic endpoint.

1. **Fresh request, 1 option:** invoke its native delivery-time getter; capture the
   baseline including the first receipt-validated calculation.
2. **Fresh request, 20 options:** invoke all native getters, then the corresponding
   classic callbacks. Expect one calculation across both renderers, distinct
   per-method output, and bounded warm fence queries rather than 19 per callback.
3. **Same request, unmapped option:** include it in the current rate set before the
   first render; invoke it repeatedly. Expect blank output and no extra calculation.
4. **Snapshot mutations between callbacks:** change quantity, variation, address,
   coupon, rate cost/metadata, stock/held demand, input revision or matching own-order
   reservation context in the disposable fixture. Refresh only current package
   inputs in the harness. Expect a new calculation or blank when association fails.
5. **Receipt race:** after the first available result, have the existing receipt
   fixture mark the owner's guard pending. The next getter must be blank. Clearing
   it with a newer operation/sequence and the old proof must remain blank; a newly
   synchronized matching proof can admit a new calculation.
6. **Disable/environment/account/settings mismatch:** mutate via the existing
   disposable control fixture after warming. Expect immediate blank output and no
   adapter call. Repeat on a fresh inactive request to measure bounded admission.

These are probe requests for the native test owner, not production mutations or
feature activation. No runtime or bootstrap changes are required to run them.

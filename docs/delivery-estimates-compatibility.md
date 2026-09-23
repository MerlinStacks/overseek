# Delivery estimate presentation compatibility

**Implementation ready for controlled rollout; not production deployed.** The gate
supports readiness-checked activation and independent disable. Private baseline and
guarded preparation can run while Pi remains active; Pi must be manually deactivated
only once verified inputs are ready, before refreshing readiness and activating
OverSeek. This is isolated compatibility evidence, not merchant-store certification.

## WooCommerce placements

- Product block: `overseek/delivery-estimate`; legacy shortcode: `[overseek_delivery_estimate]`, with optional `product_id`.
- Classic Cart/Checkout: additive `woocommerce_after_shipping_rate` output. Existing callbacks, labels, prices and taxes remain untouched.
- Blocks: plain-text `woocommerce_shipping_rate_delivery_time`. Existing provider delivery text is preserved rather than overwritten.
- Native per-option delivery-time coverage requires WooCommerce **9.7+**, despite the PHP getter's older `@since 9.2.0` annotation. WooCommerce **9.9+** puts it in the primary description position underneath the checkout method label. Cart uses the native lower price/delivery-time row.
- The separate Blocks pickup-location selector is not covered by the rate hook. Normal core `local_pickup` rate options have collection wording; this does not certify the separate pickup-location flow.
- Product-page session quote reuse is limited to the reviewed native hash implementations (9.7–10.9 and 11.0–11.1). Unknown versions, debug mode, mismatched destination/cart/coupons/cache version, and unavailable quotes fail closed. It never runs an extra shipping calculation.

Source references:

- [Woo 9.7 shipping-rate getter](https://github.com/woocommerce/woocommerce/blob/9.7.0/plugins/woocommerce/includes/class-wc-shipping-rate.php)
- [Woo 9.6.2 shipping-rate class without the getter](https://github.com/woocommerce/woocommerce/blob/9.6.2/plugins/woocommerce/includes/class-wc-shipping-rate.php)
- [Store API rate schema](https://github.com/woocommerce/woocommerce/blob/9.7.0/plugins/woocommerce/src/StoreApi/Schemas/V1/CartShippingRateSchema.php)
- [Woo 9.9 Checkout option renderer](https://github.com/woocommerce/woocommerce/blob/9.9.0/plugins/woocommerce/client/blocks/assets/js/blocks/checkout/inner-blocks/checkout-shipping-methods-block/block.tsx)
- [Classic per-rate template hook](https://github.com/woocommerce/woocommerce/blob/9.7.0/plugins/woocommerce/templates/cart/cart-shipping.php)

## Weight Based Shipping: explicit mapping policy

Native final-ZIP validation installed Weight Based Shipping for WooCommerce
**6.18.0**, by weightbasedshipping.com, and exercised both supported providers:

- Legacy method ID `wbs`, class `Wbs\ShippingMethod`.
- New method ID `wbsng`, class `Aikinomi\Wbsng\ShippingMethod`.

Both derive full rate IDs from a title hash/slug, not a stable rule identifier. Zone rates generally look like `wbs:<instance>:<title-derived-id>`; global rates omit the numeric instance segment. The method getter can return `-1` for a global method while the actual Woo rate instance ID is `0`.

Consequences:

1. Never split every rate ID and assume its second segment is a numeric instance ID.
2. Method-instance discovery alone does not identify every delivery option or certify one transit range for all its rules.
3. Renaming an option can change its full rate ID. Repeated titles can produce suffixes dependent on emitted options.
4. Existing WBSNG classic breakdown output must be preserved. Its multi-shipment solution metadata does not authorize partial-shipment promises in this feature.
5. The adapter supports `wbs` and `wbsng` only through `exact_rate` or explicitly confirmed `all_provider_rates` rows. Old unverified WBS rows still save but do not produce estimates. Exact overrides (including disabled exclusions) precede broad mappings. Unmapped siblings remain blank without suppressing mapped options.
6. Snapshot factory/parser rules now preserve opaque IDs separately from authoritative method/instance metadata, including global instance zero. Shared PHP/TypeScript fixtures cover these identities. Parsing never certifies eligibility.
7. Manager-only discovery exposes bounded actual option observations from a manager's normal cart calculation, without calculating shipping. No generated title-based prediction is represented as an actual eligible option. See [mapping API/UI contract and native fixture instructions](delivery-shipping-options.md).

Public-source references (mutable trunk; installed store version still needs confirmation):

- [Plugin header](https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/trunk/plugin.php)
- [Legacy shipping method](https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/trunk/server/src/ShippingMethod.php)
- [WBSNG shipping method](https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/trunk/server/wbsng/src/ShippingMethod.php)
- [Legacy rate converter](https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/trunk/server/vendor/dangoodman/shengine-wc-converters/src/RateConverter.php)
- [WBSNG rate converter](https://plugins.svn.wordpress.org/weight-based-shipping-for-woocommerce/trunk/server/wbsng/vendor/dangoodman/shengine-wc-converters/src/RateConverter.php)

## Final artifact verification

Frozen 2.23.0 ZIP SHA-256:
`7367da7a9c94e8ad68f3b696642a7858a987fb2c8afcef21627a4f6b7ec49a3d`.
All **95 installed files** matched the ZIP; no packaged tests or gate bypass.

- WP **7.1.1**, Woo **11.1.1**, WBS/WBSNG **6.18.0**, PHP **8.4.23**, MySQL **8.4.8**.
- **40 actual checkout runs**, managed/unmanaged × CPT/HPOS × selected native rates;
  **80 saved snapshots**, shared parsing/metadata/email rendering and 25 shared fixtures.
- Native control, private preparation/coexistence, receipts/reversal/replay,
  reconciliation and proof publication, with **229 aggregate checks**; 43 child
  runs have verified packaged-runtime provenance (2 renderer, 40 capture, 1 receipt).
- **99 browser checks** using Chrome 149.0.7827.55 at 320/390/1280px; 22 delivery AJAX
  requests have verified runtime provenance. No activation filter/hard-gate bypass.
- Backend: native PostgreSQL **18.4**, all **13 migrations**, **396 tests / 36 files /
  zero skips**, server build passed. Client: **469 tests / 72 files**, build passed.

See [native record](../overseek-wc-plugin/tests/delivery-native-integration.md),
[PostgreSQL record](delivery-native-validation-13-migrations.md), and
[release runbook](delivery-release-runbook.md). The earlier dormant-registration,
62-assertion receipt and synthetic-rendering evidence is superseded by this actual
ZIP validation; it remains historical evidence, not the current launch status.

## Exclusions and merchant checks

Stock-derived finished-BOM delivery promises, custom inventory datastores, unknown shipping
providers/cache versions, new/separate Blocks pickup-location selection and provider
multi-shipment/partial-shipment promises are excluded. Native component guarded
inventory is supported; it does not imply stock-derived finished-BOM date support.
Cost-only SupplierItem/labour BOMs remain eligible as ordinary products. Unmapped rates
remain blank and ambiguous package arrangements do not invent shipment promises.

Merchant rollout still requires all migrations/builds, inventory pause/drain/restart,
configuration, sync and verified guarded proofs, deliberate Pi switch and activation
ACK. Verify the actual theme/cache, versions, WBS identities/rules, native stock
integrations/reservations, payment/order lifecycle, SMTP/email clients, mobile/desktop
presentation and disable/recovery behavior in the merchant's environment.
Local callback baselines are **25 queries for one / 82 for twenty callbacks**;
whole AJAX requests used **67–86 queries**, including bootstrap. These are not
production latency budgets or a claim of zero overhead. Remote CI is configured
separately and has not been executed as part of this docs finalization.

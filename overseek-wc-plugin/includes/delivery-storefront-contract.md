# Dormant delivery storefront presentation

This phase registers placement/presentation integration but **cannot activate estimates**. `OverSeek_Delivery_Storefront_Gate::is_active(): bool` returns false until the later validated cutover/finalization protocol replaces it. No setting, public request, shortcode attribute or WordPress filter can bypass this production gate. Existing availability flags do not equal activation. Capabilities.storefront remains false.

## Shared classes

- `OverSeek_Delivery_Storefront_Gate::is_active(): bool` (hard inactive stage).
- `OverSeek_Delivery_Display::method_text(array $result, string $rate_id): string`: validate available engine result and selected returned method, format strict date-only range with translation-ready Estimated delivery / Ready for collection labels; return blank otherwise. No dates invented from settings. Use WP date format without changing the local date label's day.
- `OverSeek_Delivery_Display::method_html(array $result, string $rate_id, array $branding = []): string`: same text, compact escaped scoped HTML, theme-inheriting typography, bounded validated branding styles, no large banners or external fonts.
- `OverSeek_Delivery_Storefront_Context::cart_result(array $rates): array`: one complete current Woo cart, actual current eligible rates, local adapter only. Reject ambiguous multiple-package context rather than making partial-shipment promises. No calculation of shipping/totals, external HTTP, stock writes or selected-rate mutations. Request caching must include relevant cart quantities/variation identities and rates; no stale static cache across changed cart snapshots.

## Product placement

- Dynamic block `overseek/delivery-estimate`, product context-aware, plus `[overseek_delivery_estimate]` shortcode. No automatic price/Add-to-Cart positions.
- Block editor uses an explicitly non-live placeholder/instructions, not invented dates. Attributes are placement/product context only, not editable business timing settings.
- Frontend inactive output is empty and loads no storefront-specific assets.
- Active future path emits a cache-safe empty placeholder, never personalised dates/address/session data into shared HTML. One small local read-only AJAX batch refreshes all estimate placeholders; debounce quantity/variation changes, cancel stale responses, no polling and no external service calls.
- Public read-only WC AJAX `overseek_delivery_estimates`: gate first, bounded JSON/form request (max 20 products, validated IDs, positive integer qty), published public product/valid variation only, no cart/session writes, no stock/supplier metadata. Response consists only of request identities and safe HTML. Send private/no-store headers. Per-request dedupe and no arbitrary user/cart data injection.
- Unknown address: use Overseek's configured default core method as an explicitly default-method estimate (no invented shipping price or rate selection). Known address: use only actual locally available rates associated with the current destination; prefer the valid previous selection, then configured default if actually present. If no eligible selected/default rate can be established without recalculation, stay blank. Never choose a third service or call a carrier just to show a product estimate.
- WBS/WBSNG require exact-rate or explicitly confirmed all-provider-rates policy; old unverified rows remain blank. Their full rate IDs are opaque and may be title-derived; global instance getters can report -1 despite rate instance 0. Do not infer eligibility or a service from a rate-ID prefix or label. See `docs/delivery-shipping-options.md` for discovery and native fixture instructions.

## Cart and checkout

- Classic: `woocommerce_after_shipping_rate`, add scoped escaped output without replacing labels, prices or other callbacks.
- Blocks: `woocommerce_shipping_rate_delivery_time`, plain text only. WooCommerce 9.7+ actually supplies this native field for all options; 9.9+ places it directly under the checkout method label. Feature-check getter and version. Preserve incoming nonempty provider delivery time and never touch description/cost/taxes/selection.
- The filter has no package argument; resolve a single complete supported current package before associating rates. Do not recurse into get_delivery_time or call calculate_shipping/calculate_totals.
- Classic hook should not duplicate native Blocks output. Existing provider descriptions and WBS's classic breakdown callbacks are untouched.
- Separate Blocks pickup-location selection is not necessarily a WC shipping-rate option: document and fail closed rather than claim that flow is supported until its own extension point is implemented.

## Verification and rollout

Unit-test renderer escaping, compact styling, disabled zero-asset/no-calculation path, published-product access, cache/session privacy, quantity/variation updates, core selection/fallback, provider text preservation, per-option classic/Blocks formatting, package ambiguity and recursion guards. No native DOM rewriting.

Live themed browser tests, page-cache tests, actual WBS/WBSNG rules, Blocks pickup flow and real checkout snapshot capture are still prerequisites to activation. Registering an inert block/shortcode is not feature completion.

# Dormant product delivery placements

## Parent bootstrap registration

Before `init` (normally in the existing `plugins_loaded` bootstrap):

```php
require_once __DIR__ . '/class-overseek-delivery-product.php';
OverSeek_Delivery_Product::register();
```

The method is idempotent and registers only `init` and public Woo's
`wc_ajax_overseek_delivery_estimates` dispatcher. Woo dispatches this action for
both anonymous and authenticated customers; an extra `nopriv` action is not needed.
The common classes can be required separately by the cart integration:
`class-overseek-delivery-storefront-gate.php`, `class-overseek-delivery-display.php`
and `class-overseek-delivery-storefront-context.php`.

`overseek/delivery-estimate` uses `woocommerce/productId` and `postId` context,
with optional identity-only `productId`. `[overseek_delivery_estimate]` uses the
current product; `[overseek_delivery_estimate product_id="123"]` is explicit.
There are no automatic placements. The editor clearly labels the placement
inactive, without sample dates. The production gate is literal `false` with no
filter, option, request parameter or shortcode escape hatch.

## Future active implementation (currently unreachable from production)

Shared HTML is an empty scoped span containing product/request identities only.
Assets enqueue only after the gate and valid placement identity. A small local
script posts batches of at most 20 to WC AJAX, with debounce, immediate abort and
generation checks. Quantity/variation changes clear old content. Forms are bound
only by matching native `data-product_id`, `product_id` or `add-to-cart` identity.
An enclosing matching form wins, then a unique matching form in the product card,
then a unique matching page form. Conflicting identities and duplicate page forms
stay unbound, so explicit shortcodes cannot borrow another product's selections.
Woo jQuery
variation events are supported when jQuery is already present; it is not loaded
as a dependency. No polling, cart fragments dependency or native DOM rewriting.
Editor and frontend assets use `OVERSEEK_WC_VERSION` for release cache busting.

POST accepts `{ "items": [{ "request_id": "placement-1", "product_id": 123,
"variation_id": 0, "quantity": 1 }] }` as JSON, or form `items` (JSON string or
decoded list). Maximum body 16 KiB, JSON form field 8 KiB, 20 items, quantity
1–1,000,000 and IDs 1–2,147,483,647 (variation zero means none). Invalid batches
return an empty list. Responses contain `items` with only request/product/variation
identities and escaped rendered HTML. Headers are private/no-store, including
inactive responses. No nonce is needed for this public read-only operation.

Published parent and variation status, passwords, correct variable parent and
variation activity/visibility are checked before private timing inputs. No stock,
supplier information, addresses, diagnostic reasons or private settings are returned.

Unknown means there is no positive address evidence on the current Woo customer:
`get_calculated_shipping()` is false and raw (`edit` context) shipping street,
city and postcode are empty. A country/state alone is insufficient: native Woo
fills those from the site base or geolocation even for anonymous visitors. Woo
loads its validated session address/calculated flag and logged-in saved address
into the current customer; no session or customer writes are needed. Do not use
`has_shipping_address()` here: even a default country makes it true. Only the exact
configured enabled default mapping may supply timing, with an explicit
default-method qualifier. Its temporary rate object is never inserted into a cart,
package, chosen methods or session and never displays a shipping price.

Known destinations require one complete current package. Already-loaded shipping
rates take priority: all package inputs (including quantities, variations,
costs/coupons) and customer destination must match. A mismatched or empty loaded
package fails closed rather than reviving an older session quote. If no packages
are loaded, a native session quote may be read **only** after exact native package
hash validation described below. Debug mode rejects both paths. Missing, empty,
stale or unsupported cache data stays blank without calculating shipping.
Prefer an eligible previous selection,
then the eligible configured default actually present; never a third service.
WBS/WBSNG require an exact option or explicitly confirmed instance-wide mapping.
Instance defaults without a nominated option must have exactly one eligible
offered option; ambiguous instances stay blank. Full option IDs remain opaque.
Multiple current packages fail closed, including the unknown-address path.

`cart_result(array $rates): array` admits cold requests through the real activation
gate, then validates rate object membership against that same complete package.
It sends the **whole current WC cart and complete current rate set** to the unchanged
local adapter once per coherent render snapshot. Request-only reuse is fenced on
every callback; see [the render cache contract](delivery-render-cache.md). Product batch dedupe is local
to one call and includes parent, variation and quantity. Callable constructor seams
in the internal service and read-only context helpers exist for standalone testing;
registered callbacks always construct production services after the hard gate.

## Native session hash compatibility

Reviewed `WC_Shipping::calculate_shipping_for_package()` at Woo release tags
**9.7.0, 9.8.0, 9.9.0, each 10.0.0–10.9.0, 11.0.0 and 11.1.0**. The read-only
compatibility boundary accepts stable patch releases in those minor lines only;
older, prerelease and unreviewed future minor lines cannot use session quotes.
The independently validated loaded-package path does not rely on this hash copy.

- **9.7–10.9:** copy the entire current package, assign `rates = []` in native
  insertion order, strip only `contents[*].data`, then compute
  `wc_ship_` + `md5(wp_json_encode(package) . shipping_transient_version)`.
- **11.0–11.1:** native private `get_package_hash()` additionally removes top-level
  `subtotal`, `total`, `package_id`, `package_name`, `rates`, `package_index`.
  All contents/line totals, `contents_cost`, coupons, destination, user identity,
  `cart_subtotal` and other package inputs remain hashed. If the native
  `woocommerce_shipping_package_hash_ignored_fields` filter has a callback, fail
  closed: an extension could otherwise exclude critical identity fields.
- Read only `shipping_for_package_{actual_current_key}` from the current Woo
  session. Require its exact `package_hash` and nonempty, bounded rate objects with
  exact ID-to-array-key correspondence. Never enumerate other sessions or quotes.
- Read the **existing** `WC_Cache_Helper` backing `shipping-transient-version`
  from the external cache's `transient` group, or the WP transient value/timeout
  options. An external-cache miss cannot fall back to the DB. Reject expired,
  missing or filtered versions, and recheck the version after hashing. Do not call
  the helper (it creates missing versions) or `get_transient` (it can delete expired
  rows). No version initialization, expiry cleanup, quote refresh or session write.
- Certify the whole current physical cart's keys/product/variation/quantities and
  the actual customer destination before looking up the cache. Hash comparison
  then covers the complete current native package inputs, not a product-only
  approximation. No Woo shipping/totals calculation or provider-rate discovery.

Source references (research only, never runtime requests):

- [Woo 9.7 shipping](https://github.com/woocommerce/woocommerce/blob/9.7.0/plugins/woocommerce/includes/class-wc-shipping.php)
- [Woo 9.9 shipping](https://github.com/woocommerce/woocommerce/blob/9.9.0/plugins/woocommerce/includes/class-wc-shipping.php)
- [Woo 10.9 shipping](https://github.com/woocommerce/woocommerce/blob/10.9.0/plugins/woocommerce/includes/class-wc-shipping.php)
- [Woo 11.1 shipping](https://github.com/woocommerce/woocommerce/blob/11.1.0/plugins/woocommerce/includes/class-wc-shipping.php)
- [Woo customer getters](https://github.com/woocommerce/woocommerce/blob/9.7.0/plugins/woocommerce/includes/class-wc-customer.php)
- [Woo session address defaults](https://github.com/woocommerce/woocommerce/blob/9.9.0/plugins/woocommerce/includes/data-stores/class-wc-customer-data-store-session.php)
- [Woo cache helper](https://github.com/woocommerce/woocommerce/blob/9.9.0/plugins/woocommerce/includes/class-wc-cache-helper.php)

The production hard gate remains literal `false`; hash support is not activation.

## Verification

```sh
php overseek-wc-plugin/tests/delivery-storefront.php
php overseek-wc-plugin/tests/delivery-render-cache.php
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 9.7.0
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 9.9.0
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 10.9.0
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 11.0.0
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 11.1.0
php overseek-wc-plugin/tests/delivery-storefront-quotes.php 11.2.0
node overseek-wc-plugin/tests/delivery-storefront-js.cjs
```

The PHP harness checks disabled zero-read/asset output, display date validation and
escaping, bounded branding, public product access, variation-parent validation,
request dedupe/bounds, core default selection and complete package/destination
certification. The quote harness covers base-country/geolocated guests, logged-in
saved addresses, explicit calculated shipping, returning checkout session quotes,
literal native JSON hash fixtures, stale address/cart/coupon/user/cost/version
changes, missing/malformed quotes, debug mode, external cache and no state writes.
The JS harness uses built-in Node modules and minimal DOM doubles;
it checks chunks, debounce, quantity/variation/reset events, out-of-order responses
and immediate abort, plus duplicate cards, different-product shortcodes, unique
page forms and ambiguous/mismatched form identities. No additional dependencies
or build step are needed.

Live themed browser/mobile, real Woo rate/package lifecycle, page-cache tests,
WBS/WBSNG rules and native Blocks pickup flow remain activation prerequisites.
Separate Blocks pickup-location selection is unsupported. This registration is
not feature activation; existing receipt/input availability gates still apply.

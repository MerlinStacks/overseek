# Cart / checkout presentation boundary

`includes/class-overseek-delivery-cart-display.php` defines
`OverSeek_Delivery_Cart_Display`. The bootstrap supplies the shared gate;
construction registers only:

| Hook | Callback | Behaviour |
| --- | --- | --- |
| `woocommerce_after_shipping_rate` | `after_shipping_rate($rate, $index)` | Add shared escaped/scoped HTML below the actual classic rate in the matching package. |
| `woocommerce_shipping_rate_delivery_time` | `delivery_time($original, $rate)` | Supply shared plain text for an empty native field, including unselected options. |

The main plugin bootstrap now instantiates this class. The production
`OverSeek_Delivery_Storefront_Gate::is_active()` remains hard false. Each callback
checks that gate before request checks, cart/session access, rendering or assets.
Display and context dependencies are loaded lazily only after the gate and current
rate checks pass. Non-autoloading `class_exists(..., false)` checks respect already
loaded classes (including harness doubles). Loading this class or running inactive
callbacks does not include the display, context, adapter or engine.
There are no assets, extra hooks, DOM rewriting or JavaScript in this integration.

Classic nonempty shared HTML is wrapped in a scoped `overseek-delivery-cart-estimate`
block with inline `display:block;margin-top:.15em`, placing even an inline-flex
renderer below the method label without global CSS. Blank HTML emits no wrapper.

## Context and safety

- Read only `WC()->shipping()->get_packages()`, the already-calculated shipping
  state. Require one package and the identical rate object under its exact ID;
  classic additionally requires the current package index. No selected-rate
  substitution, label matching, prefix matching or synthetic rates.
- Pass the **complete actual rate map** to shared `cart_result()`, which certifies
  it against the complete current cart/package/destination and calls the existing
  local adapter. Partial, stale and ambiguous custom/multiple-package contexts
  must fail closed there. No independent date computation or managed-stock bypass.
- Shared `method_text()` / `method_html()` choose the returned method by exact ID.
  Whole-order unavailability stays blank. `local_pickup` WC shipping-rate options
  use the shared Ready for collection wording.
- Preserve any incoming field other than the exact empty string verbatim, including
  whitespace and `"0"`. Do not call `get_delivery_time()` from its filter. Check both
  a real callable getter and WooCommerce >= 9.7 before accessing native context.
  Re-entry and exceptions yield blank HTML or the original field.
- Descriptions, costs, taxes, selection, other provider callbacks (including WBS
  breakdowns), stock and cart data are untouched. Never calculate shipping/totals
  or make HTTP requests.
- Customer cart/checkout pages, the two classic shipping/review WC AJAX endpoints,
  and Store API cart/checkout/batch routes are accepted. Admin, unrelated REST,
  non-store pages, order-pay and order-received pages fail closed. Classic output
  is suppressed on REST requests; native Blocks render their own field naturally.

## Blocks support limits

WooCommerce 9.7+ supplies the native delivery-time field for rate options; 9.9+
places it directly below the checkout method label. Older Woo versions can still
use the classic placement, but receive no native-field enhancement. No extra
Blocks UI is injected.

The separate Blocks **pickup-location selection flow is unsupported**. It is not
necessarily a `WC_Shipping_Rate` option and has no extension point in this class.
Supporting a normal `local_pickup` rate does not claim support for that flow.

## Offline verification

Run from the repository root:

```sh
php -l overseek-wc-plugin/includes/class-overseek-delivery-cart-display.php
php -l overseek-wc-plugin/tests/delivery-cart-display.php
for mode in default first-native old-version missing-version missing-getter store-api other-api ajax; do
  php overseek-wc-plugin/tests/delivery-cart-display.php "$mode" || exit 1
done
php overseek-wc-plugin/tests/delivery-live-adapter.php
```

The presentation harness supplies shared-class doubles so it can exercise the
future active branch without changing the production gate. It verifies hook
registration, inactive zero-read/zero-dependency-include behaviour, lazy loading
that respects doubles, the scoped under-method block wrapper (absent for blank
output), complete exact Core rate context,
unselected collection options, provider preservation, package/index association,
unsupported rates, version/getter checks, REST/classic separation, exception and
re-entry guards, and no calculation/assets/HTTP/mutation attempts. Renderer
escaping and actual complete-package certification are shared-class contracts,
not independently reimplemented by these doubles. The existing local-adapter
harness checks real whole-order and managed-stock safety.

These offline checks do not activate checkout. Live classic/Blocks theme tests,
real provider rules, the separate pickup-location flow and checkout snapshot
capture remain activation prerequisites described in the storefront contract.

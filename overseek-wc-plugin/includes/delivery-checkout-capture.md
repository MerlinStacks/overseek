# Final checkout capture

Parent bootstrap registration (after Woo is available):

```php
require_once __DIR__ . '/class-overseek-delivery-checkout-capture.php';
OverSeek_Delivery_Checkout_Capture::register();
```

Registration adds two callbacks at `PHP_INT_MAX`: classic
`woocommerce_checkout_order_processed` (three arguments), and Store API
`woocommerce_store_api_checkout_order_processed` (one argument). Dependencies
load lazily. The production `OverSeek_Delivery_Storefront_Gate::is_active()` must
return true; this class offers no override. Bootstrap wiring belongs to the parent.

## Timing and immutability

Both native processed actions run after order/cart validation and shipping-line
creation, before payment processing/cart emptying. We deliberately do not attach
to order creation, metadata update, Store API update-from-request, status changes,
thank-you, payment completion, or email rendering. GET and repeated PUT/PATCH
draft edits cannot freeze the first provisional shipping choice.

Woo 9.7.0's Store API fires the processed action while the submitted order can
still be `checkout-draft`; newer Woo sets `pending` before the action. Therefore
requiring a paid order, `needs_payment()`, or rejecting every draft status would
lose legitimate zero-total and older Blocks submissions. The native **processed
action** is the final-submission boundary. Only pending/failed orders (plus
Blocks checkout-draft at that boundary) are eligible. Already paid orders skip.
An initial submitted promise remains immutable even if payment fails and a later
submission changes the selection. Existing metadata, including malformed metadata,
is never replaced. This intentionally records the first submitted promise, not a
later retry's changed promise. The existing locked first-write helper remains the
sole writer. Email must read that snapshot, never recalculate missing dates.

## Context and support

- Certify one complete physical package through the shared storefront context,
  including native session quote/hash validation when loaded rates are absent.
- Require exactly one chosen rate and one order shipping line. Use the rate's
  opaque ID and authoritative method/instance getters, never a product-page
  default or a rate inferred from its title. WBS/WBSNG global `-1` is normalized
  to instance `0`, matching the provider contract.
- Compare hook order **and freshly loaded CRUD order** line multisets against
  the full cart: product IDs, variation IDs, quantities, including virtual lines.
  Compare shipping method, instance, title, cost, taxes, any explicit `rate_id` /
  `_rate_id` metadata, and destination. Core order shipping items do not retain an
  opaque option ID: the current validated package plus chosen session rate supplies
  that identity, with the order shipping line corroborating it.
- Call the same `Storefront_Context::cart_result()` used for display with all
  current actual rates. Select only the exact chosen rate's available result.
  Missing/invalid production times, unavailable managed-stock proof, stale inputs,
  unmapped chosen methods, partial/multiple packages and absent evidence skip.
  Neither capture nor the context initiates shipping calculation or HTTP.
- Standard `local_pickup` rates capture collection = whole-order readiness and
  null delivery. **Blocks' separate location-based pickup flow (`pickup_location`)
  is unsupported** here, and must not be advertised as supported by the normal
  local-pickup hook. Readiness/activation should block stores using that flow with:
  “Blocks location-based pickup estimates are not supported. Use a supported
  shipping-zone Local pickup rate or disable delivery estimates for this setup.”
  This is an integration requirement for the readiness owner, not an implemented
  activation check in this class.

## Verification

```sh
php overseek-wc-plugin/tests/delivery-checkout-capture.php
php -l overseek-wc-plugin/includes/class-overseek-delivery-checkout-capture.php
php -l overseek-wc-plugin/tests/delivery-checkout-capture-integration.php
```

The standalone harness uses native-hook and Woo CRUD doubles with the real
snapshot factory/writer. It verifies draft updates, both submission hooks,
first-write retries, unavailable contexts, line/shipping mismatches and collection.
Shared context, adapter, resolver and snapshot harnesses cover their own internals.

The native integration harness requires a **disposable `wordpress_tests` database**,
active Woo and OverSeek, and real cutover/activation/input sync already completed.
Create a synced physical simple product priced zero, a configured
zero-cost supported rate offered to Sydney AU 2000, and enable guest checkout.
The product must have valid production/inbound inputs. Run separately with HPOS
on and off; run again with a normal Local pickup fixture:

Unmanaged products retain the normal flow. A managed product automatically adds
reservation coverage and must have **already-certified verified inbound proof**,
an inactive matching owner guard in the real guarded epoch, at least four positive
stock units, no existing reservations, backorders disabled, and native stock
management/hold minutes enabled. The harness verifies certification through the
production stock-snapshot reader and requires the real local adapter to be
available. It does not activate the gate, alter guards, seed proof, or adjust stock.

Managed coverage creates native pending/draft order holds using the same actual
cart hash. Other orders reserve all but this cart's two units; the session draft
reserves those two. Assertions verify the exact held quantities and prior demand,
that only the own session draft is excluded, that missing/stale session identity
cannot exclude it, and that another order with the same hash consuming all stock
makes the estimate unavailable. Reservations are released before the native
checkout flows. The native processed-hook observers verify a real two-unit hold
and compare the saved chosen-rate snapshot against the current complete-cart
factory result. All fixture orders/holds are cleaned up, including on failure.
Successful zero-total Blocks checkout performs Woo's normal stock reduction:
use a newly certified disposable fixture for subsequent runs rather than editing
stock or proofs to reset it.

```sh
OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 \
OVERSEEK_CHECKOUT_PRODUCT_ID=123 OVERSEEK_CHECKOUT_RATE_ID=flat_rate:7 \
wp --path=/path/to/disposable/wordpress eval-file \
  overseek-wc-plugin/tests/delivery-checkout-capture-integration.php --use-include
```

This runs real classic `WC_Checkout::process_checkout()` through the processed
action, then stops before the redirect/payment using a test sentinel; it runs real
Store API GET/PUT/PUT/POST with a zero-total order and checks stored snapshots.
Classic populates both `$_POST` and `$_REQUEST` (Woo reads the checkout nonce from
`$_REQUEST`) and simulates a POST request method; the original globals are restored
in `finally` even after a failed assertion.
It refuses an inactive real gate, denies outbound HTTP, uses native shipping
calculation only to prepare the fixture, and deletes its created orders. It
mutates the disposable session/customer/cart and is not for a merchant database.

Local execution: PHP 8.4.23 standalone harness and lint. The current PHP snapshot
baseline also passes all 25 final shared opaque-ID parity cases (array and JSON),
including `rate-leading-zero`; no parser change is needed.
The native agent reported 12 successful core/WBS/WBSNG classic/Store API CPT/HPOS
runs with the request-global wrapper fix, 16 checks each. The fix is now in this
harness. The newly added managed reservation assertions still require a native
run with a certified fixture; those results are not implied by the earlier runs.
Woo 9.7.0 and current trunk hook timing were inspected in upstream source; this
does not constitute installed-version/browser/payment-provider certification.

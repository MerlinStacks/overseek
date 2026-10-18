# Meta conversion diagnostics

Deploy both the backend and the updated WooCommerce plugin for these fixes to take effect.

## Purchase value and currency

Meta purchases require an explicit finite, non-negative order total and a supported ISO currency. Numeric decimal strings are accepted; blank values, formatted prices, booleans and invalid currencies are not. Currency is trimmed and uppercased. Legitimate zero-value orders remain valid.

Shipping and tax exclusions apply to purchases only. Invalid deductions or deductions exceeding the order total are not clamped to a fabricated zero. Invalid server purchases appear as `FAILED` deliveries with a `NON_RETRYABLE:` explanation; scheduled retries must not resend them unchanged. Correct the source data rather than inserting a default currency or price.

The browser purchase uses the actual WooCommerce order total with the same exclusions, normalizes currency, and suppresses invalid/negative purchase values.

## Connection tests

Meta connection tests require the Test Event Code from Events Manager. Without it, the test endpoint returns an error without sending the synthetic $1 USD purchase. Check the event under **Test events**, not live revenue reporting. Clear the temporary test code after testing: while configured, the service attaches it to all Meta events.

## AddToCart matching

Classic WooCommerce AJAX additions allocate a fresh event ID in `adding_to_cart`, before the request is sent. That ID is included in the POST and reused by the browser's successful `added_to_cart` event. Repeated additions from one button no longer reuse an old ID. Non-AJAX links and product forms also rotate IDs, and the server must not reuse a checkout cookie ID for an unrelated cart addition.

Server AddToCart value uses the added item's price times quantity, not the whole cart total. The browser quantity is also included in the event value.

## Verification after deployment

1. In Meta Test events, complete orders with different totals and compare browser/server `value`, `currency` and `event_id` with WooCommerce. Include any enabled shipping/tax exclusions.
2. Add the same product twice using a classic AJAX button. Each operation must have a different ID, with the browser and server copies sharing that operation's ID.
3. Check OverSeek delivery logs for failed purchases and Meta responses. Confirm the installed plugin version includes these changes.
4. Check for other plugins, themes or tag-manager containers sending events to the same pixel. Their events are outside this pipeline and can still cause warnings.

These changes do not repair historical events or guarantee that every missing server event has the same cause. Consent, missing match data, delivery failures and third-party cart implementations still need to be checked if coverage remains low. Judge the fix using new events; Meta diagnostics can lag behind deployment.

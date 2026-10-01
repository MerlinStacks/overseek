# OverSeek WooCommerce Plugin

A WordPress plugin that connects your WooCommerce store to your self-hosted OverSeek server.

Current version: **2.25.2**.

### Simple delivery estimate setup

In Overseek, open **Settings → Delivery estimates**, set your dispatch schedule and shipping day ranges, then choose **Turn on**. Shipping methods load automatically from WooCommerce. Turning on saves your timings and enables estimates once your store has received them; you can leave the page while this finishes. Use the same switch to turn estimates off at any time, including when you have unsaved edits.

The page uses production + shipping times with automatic background updates. There are no setup tabs, manual sync steps, or advanced inventory controls. Existing delivery-date plugins can remain active, although their own messages may still appear alongside Overseek's.

Simple mode uses saved product production times, variant overrides, calendars and shipping mappings for items available now. It does not require inventory cutover or supplier/receipt proofs. Unsynced catalogue entries do not block other synced products. Backordered or insufficient-stock items show no date in this mode.

Saving keeps existing product/variant timings, closures, shipping identities and styling. An inventory upgrade already in progress must finish before estimates can be enabled.

### Where estimates appear

- **Cart and checkout:** estimates appear automatically beside configured shipping methods on supported WooCommerce layouts. Classic checkout uses the shipping-rate hook; WooCommerce Blocks use the rate's native delivery-time field when the shipping provider has not already supplied one. Do not add an Overseek delivery shortcode or block to either page or the shipping-method area.
- **Product pages (optional):** expand **Show estimates on product pages**, choose a shipping method, then place the **Overseek Delivery Estimate** block or `[overseek_delivery_estimate]` shortcode in your product template. Both use the current product.

Checkout compatibility checks identify the store's existing WooCommerce cart and checkout layout. They do not require placing an Overseek delivery block or shortcode on those pages.

> **Important:** This plugin is **not standalone** - it connects your WooCommerce store to your self-hosted OverSeek server. You must set up the server first.

## Requirements

- WordPress 6.4+
- WooCommerce 8.0+ (classic or Blocks-based checkout)
- PHP 8.1+
- A running OverSeek server (see main [README](../README.md))

## Installation

1. **Copy the plugin** - Upload the `overseek-wc-plugin` folder to `/wp-content/plugins/`
2. **Activate** - Go to WordPress Admin -> Plugins -> Activate "OverSeek WooCommerce Integration"
3. **Configure** - Navigate to WooCommerce -> OverSeek and paste your configuration JSON from the OverSeek dashboard

## Configuration

After activating, go to **WooCommerce -> OverSeek** in your WordPress admin.

### Required Settings

| Setting | Description |
|---------|-------------|
| **API URL** | Your OverSeek server API URL (e.g., `https://api.yourdomain.com`) |
| **Account ID** | Your account ID from OverSeek dashboard |
| **Secret Key** | Your secret key for server-side event verification |

### Optional Features

| Setting | Description |
|---------|-------------|
| **Enable Live Chat** | Shows the live chat widget on your store |
| **Enable Server Tracking** | Server-side commerce events plus cache-safe browser pageviews |
| **Email Relay** | Allows OverSeek to send emails via your WordPress SMTP |

## What the Plugin Does

### Server-Side Tracking
Tracks add-to-cart events and purchases through WooCommerce server hooks. Page/product views use a same-origin browser collector so cached visits are counted too; these browsing events require JavaScript and can be blocked by browser tools.

Pageviews and product views exclude identifiable background requests (AJAX/fetch, non-document requests and prefetch/prerender traffic). Repeated view hooks are counted once per request, not suppressed across a time window. GET requests without browser fetch metadata remain supported; POST views require an explicit navigation header. Background requests with no distinguishing headers can still resemble real visits, and prefetched pages activated without another server request are not measured by this server-only tracker.

### Live Chat Widget
Embeds a chat bubble on your storefront that connects customers to your unified OverSeek inbox.

### Email Relay
Enables OverSeek to send marketing emails and notifications through your WordPress server's configured SMTP provider (useful if your OverSeek server doesn't have outbound email).

### Email Preference Center
Adds a customer-facing preference center that can be embedded on a normal WordPress page with either:
- shortcode: `[overseek_preference_center]`
- Gutenberg block: `OverSeek Preference Center`

Customers arriving with an `overseek_email_preferences` token in the page URL can unsubscribe from marketing only or all email without leaving the store domain.

### WooCommerce REST API Integration
The plugin works alongside WooCommerce's built-in REST API for:
- Order sync (bidirectional)
- Product sync (bidirectional)
- Customer sync (bidirectional)
- Inventory updates

### WooCommerce Blocks Compatibility
The plugin fully supports the block-based checkout introduced in WooCommerce 8.x. Visitor cookies are initialised during Store API REST requests so that tracking works correctly regardless of checkout type.

### Caching Plugin Compatibility
Catalogue pages can remain in full-page caches. Page/product views are collected by a small JavaScript request to the same-origin `?wc-ajax=overseek_view` endpoint, with `private, no-store` responses. Public page context is signed; visitor identity, campaign attribution and event IDs are resolved per visit. Browsing analytics therefore requires JavaScript; cart, checkout and purchase events continue to use WooCommerce server hooks.

- Do **not** add `_os_vid` or other tracking cookies to cache bypass/variation rules.
- Keep WooCommerce cart, checkout, account, logged-in traffic and `wc-ajax` endpoints excluded in your page cache and CDN. The plugin also sends early no-cache directives for private pages, but PHP cannot change a response already served by an upstream cache.
- Delivery dates are fetched separately from shared HTML. Chat hours are evaluated by the uncached widget script at visit time.
- Changed storefront configuration requests a page-cache purge, coalesced to one per request. Supported purge integrations: LiteSpeed Cache, WP Rocket, W3 Total Cache (page cache), and WP Super Cache. Custom proxies/CDNs can subscribe to the `overseek_purge_page_cache` action, which receives an array of reasons. External caches without an integration require their own purge.

#### Updating the plugin

Versioned asset URLs change with each plugin release. From 2.25.0, the first WordPress request loading a different plugin version also purges supported page caches and schedules background configuration refreshes. This covers manual ZIP replacements and file deployments as well as WordPress updates. Subsequent updates through WordPress mark the cache for cleanup at update completion; the next request finalizes cleanup using the new code. Same-version WordPress reinstalls also trigger cleanup.

Last-known-good configuration stays available during refresh. Only plugin configuration transients are removed through WordPress's transient API (including persistent object-cache entries); visitor sessions, purchase deduplication and the failed-event retry queue are preserved. Redis/Memcached is not globally flushed. WP-Cron must run for background refreshes.

On the **first upgrade from an older release**, the old code has no update-completion purge hook. Open a WordPress admin page after installation to run version detection, then purge any separately managed CDN. On multisite, version detection/config refresh is per site on its next WordPress request. Replacing files with the **same version outside WordPress's updater** requires a manual page-cache purge.

Delivery readiness has its own existing environment fingerprint: plugin/WooCommerce versions and WordPress upgrade events invalidate it. Managed delivery estimates may need readiness revalidation after an update; clearing page caches does not reactivate them.

### Bot Detection
Server-side tracking includes improved bot detection patterns to filter out crawlers, headless browsers, and monitoring bots, reducing false positives in visitor analytics.

## REST API Endpoints

The plugin registers the following endpoints under `wp-json/overseek/v1/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check for connectivity testing |
| `/settings` | GET | Retrieve store settings (currency, units) |
| `/events` | POST | Receive server-side tracking events |
| `/email-relay` | POST | Send emails via WordPress SMTP |

## Troubleshooting

### "Plugin endpoint not found"
- Ensure the plugin is activated
- Check that permalinks are configured (Settings -> Permalinks -> Save)
- Verify your `.htaccess` is writable

### Events not tracking
- Check the OverSeek dashboard -> Settings -> Plugin Health
- Verify your Secret Key matches in both OverSeek and WordPress
- Failed purchase events retry through the `overseek_retry_tracking_events` WP-Cron hook, in batches of at most five. Checkout never drains this backlog; the current purchase still uses its existing two-second acknowledgement timeout.
- Ensure WP-Cron is running. If `DISABLE_WP_CRON` is enabled, configure a system scheduler to service WordPress cron regularly (ideally every minute). The existing retry queue is capped at 50 events with a one-hour transient lifetime, so it is not durable storage for prolonged outages.

### Live chat not appearing
- Ensure "Enable Live Chat" is turned on in WooCommerce -> OverSeek
- Clear any page caches
- Check for JavaScript errors in browser console

## Delivery estimates

Delivery estimates require account/product configuration, verified inventory inputs,
explicit shipping-method mappings and readiness-checked activation in OverSeek.
Classic delivery presentation requires WooCommerce 9.7+; Blocks requires 9.9+.
Reviewed quote-cache versions are 9.7–9.9, 10.0–10.9 and 11.0–11.1.
Separate Blocks pickup-location presentation is blocked. Finished BOM delivery
estimates and custom inventory stores are excluded. Unknown/unmapped rates remain blank.
Native validation used WordPress 7.1.1, WooCommerce 11.1.1, WBS/WBSNG 6.18.0,
PHP 8.4.23 and MySQL 8.4.8; this does not certify every theme/provider/version.
Plugin updates invalidate activation fingerprints: recheck readiness before reactivation.
See the repository's `docs/delivery-release-runbook.md` for the controlled launch sequence.

### Upgrading to 2.23.1

Update OverSeek with all pending earlier migrations and
`20260923140000_delivery_input_diagnostics` applied before starting the updated
server, and generate its Prisma client. Then update the companion plugin to 2.23.1.
In delivery sync attention, use **Retry** for the specific blocked inputs after
resolving their reported cause. Previously synced inputs are left untouched;
expired inbound inputs are rebuilt from current sources with a new revision.
The update does not force-activate delivery estimates. If delivery estimates were
already active, the changed plugin-version fingerprint requires readiness
revalidation before reactivation. See `docs/companion-2.23.1-release.md` for the
candidate validation gate and upgrade sequence.

## Changelog

### 2.25.2 - 2026-10-01

- Identify the rejected field or processing stage in delivery activation errors, without returning submitted values.
- Add regression coverage for production activation with null epoch/cursor and field-specific rejection diagnostics.

### 2.25.1 - 2026-09-30

- Delivery activation no longer requires recognised cart/checkout pages or Blocks pickup presentation. Existing delivery plugins can remain active.

### 2.25.0 - 2026-09-28
- **Fixed:** Page/product views from full-page caches, with visit-time attribution and shared browser/CAPI event IDs.
- **Fixed:** Visitor matching data is no longer embedded in shared catalogue HTML.
- **Fixed:** Chat config freshness recovery and visit-time business-hours checks (deploy the matching OverSeek server update).
- **Added:** Coalesced page-cache purging for storefront changes, delivery activation and plugin updates, plus a custom CDN purge hook.
- **Updates:** Version-change detection refreshes configuration through WordPress's transient API without clearing order deduplication, retry queues or the global object cache.

### 2.23.1 - 2026-09-23
- **Fixed:** Shared stock-owner variants support distinct supplier leads through `variantSupplierLeads`.
- **Improved:** Typed delivery input rejection reasons support targeted diagnostics and retry.
- **Activation:** Does not force-activate delivery estimates; plugin-version changes require readiness revalidation.

### 2.23.0 - 2026-09-22
- **Added:** Configurable delivery estimates, product block/shortcode, classic and Blocks rate presentation, and saved checkout promises.
- **Added:** Guarded inventory receipts, proof-backed inputs, explicit cutover/activation/disable and audited recovery.
- **Packaging:** Runtime-only distribution with MIT license; native fixtures and developer tooling excluded.

### 2.15.0 - 2026-04-29
- **Added:** `[overseek_preference_center]` shortcode for embedding the customer email preference center on any WordPress page.
- **Added:** `OverSeek Preference Center` Gutenberg block for the same storefront preference experience in the block editor.
- **Improved:** The preference-center renderer is now shared across standalone token links, shortcode embeds, and block embeds.

### 2.14.0 - 2026-04-29
- **Added:** Customer-facing email preference center on the WooCommerce store domain, powered by the plugin and linked from OverSeek unsubscribe tokens.
- **Added:** Token-based preference lookup and update support so the plugin can manage `marketing only` vs `all email` opt-outs without sending customers back to the app domain.
- **Improved:** Existing unsubscribe links now redirect into the WooCommerce-hosted preference center when the connected store URL is available.

### 2.13.0 - 2026-04-29
- **Added:** End-to-end abandoned-cart recovery support with signed recovery links that rebuild WooCommerce carts before checkout.
- **Added:** Recovery attribution context is now attached to restored carts and orders so recovered purchases can be credited back to the originating automation.
- **Improved:** Earlier checkout email capture for both classic and Blocks checkout, including Woo Store API request capture for better abandoned-cart enrollment quality.
- **Improved:** Cart restore flow now handles partial or failed restores more gracefully and shows clear checkout notices when items are unavailable.

### 2.12.1 - 2026-04-27
- **Improved:** Fingerprint bot defense moved from fail-open to fail-soft, adding contextual risk scoring for missing tokens and suspicious user agents.
- **Added:** Checkout velocity scoring (IP, visitor, and billing email windows) to detect short-burst automated checkout attempts.
- **Improved:** Fingerprint interaction heuristics now include trusted pointer and keyboard signal checks to reduce scripted bypasses.
- **Improved:** Browser and server tracking now share event IDs for add-to-cart, checkout-start, purchase, and product-view events to improve cross-channel deduplication accuracy.
- **Fixed:** Visitor ID fallback now uses `_os_vid` consistently in pixel tracking.

### 2.12.0 - 2026-04-14
- **Security:** Browser fingerprint bot detection at checkout. A lightweight JS collector gathers behavioral signals (interaction timing, pointer events, visibility, webdriver flag) and scores them to block automated checkout attempts. Real customers are never affected (fail-open on missing tokens, conservative thresholds).
- **Added:** `OverSeek_Fingerprint` class - nonce-based challenge-response, weighted scoring, WooCommerce Blocks support via `X-OS-FP` header, suspicious order flagging via `_os_fp_suspicious` order meta.
- **Improved:** FraudService now incorporates fingerprint bot score as an additional fraud factor.

### 2.11.0 - 2026-04-14
- **Security:** Crawler Guard now blocks known bots on the WooCommerce Store API checkout endpoint (`/wc/store/v1/checkout`), preventing bot-placed fake orders. Previously all REST API requests bypassed the guard.
- **Improved:** New accounts are automatically seeded with block rules for harmful bots (security scanners) and HTTP clients (cURL, Puppeteer, Selenium, etc.) so the Bot Shield works out of the box without manual rule configuration.

### 2.4.2 - 2026-03-06
- **Fixed:** Real visitor User-Agent is now sent via the HTTP `User-Agent` header in `wp_remote_post`, preventing WordPress's default UA from being parsed for device/browser/OS detection
- **Added:** Filter out crawler bots with `/wp-admin/` or `/wp-login.php` referrers - events are silently dropped before queuing
- **Improved:** Better compatibility with ua-parser-js v2 browser naming conventions (Mobile Chrome, Mobile Safari, etc.)

### 2.4.1
- Server-side tracking reliability improvements
- Blocking request mode for reliable event delivery at shutdown
- WooCommerce Blocks checkout support (Store API)
- Ad platform click ID tracking (gclid, fbclid, msclkid, etc.)

## License

MIT - Same as the main OverSeek project.

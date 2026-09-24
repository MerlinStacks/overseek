# OverSeek WooCommerce Plugin

A WordPress plugin that connects your WooCommerce store to your self-hosted OverSeek server.

Current version: **2.24.0**.

### Simple delivery estimate setup

In Overseek, open **Delivery estimates → Dispatch → How should estimates work?** and choose **Simple: production + shipping times**. Save, then use **Preview & enable** to activate once your saved timings have published. New configurations start with this option; existing configurations keep incoming-stock behaviour until you switch.

Simple mode uses saved product production times, variant overrides, calendars and shipping mappings for items available now. It does not require inventory cutover or supplier/receipt proofs. Unsynced catalogue entries do not block other synced products. Backordered or insufficient-stock items show no date in this mode.

Switching modes preserves product/variant data, supplier timing, purchase orders, closures, shipping identities and styling. **Advanced: include incoming stock** retains the existing inventory preparation and receipt workflow. An inventory upgrade already in progress must finish or be recovered before activation; switching estimate modes does not abandon inventory work or unfreeze receiving.

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
| **Enable Server Tracking** | Sends pageview/cart events server-side (ad-blocker proof) |
| **Email Relay** | Allows OverSeek to send emails via your WordPress SMTP |

## What the Plugin Does

### Server-Side Tracking
Tracks pageviews, add-to-cart events, and purchases directly from your server. Unlike JavaScript-based tracking, this works even when customers use ad blockers.

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
The plugin is tested with popular caching solutions including LiteSpeed Cache, WP Super Cache, and W3 Total Cache. It automatically:
- Excludes OverSeek tracking cookies from cache key generation
- Prevents caching of cart and checkout pages
- Sets `no-cache` headers on tracking endpoints

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

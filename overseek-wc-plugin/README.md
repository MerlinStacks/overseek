# OverSeek WooCommerce Plugin

A WordPress plugin that connects your WooCommerce store to your self-hosted OverSeek server.

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

### Live Chat Widget
Embeds a chat bubble on your storefront that connects customers to your unified OverSeek inbox.

### Email Relay
Enables OverSeek to send marketing emails and notifications through your WordPress server's configured SMTP provider (useful if your OverSeek server doesn't have outbound email).

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

### Live chat not appearing
- Ensure "Enable Live Chat" is turned on in WooCommerce -> OverSeek
- Clear any page caches
- Check for JavaScript errors in browser console

## Development

For local development, configure the plugin to point to your local OverSeek server:

```
API URL: http://localhost:3000
```

## Changelog

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

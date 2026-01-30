# OverSeek WooCommerce Plugin

A WordPress plugin that connects your WooCommerce store to your self-hosted OverSeek server.

> **Important:** This plugin is **not standalone** — it connects your WooCommerce store to your self-hosted OverSeek server. You must set up the server first.

## Requirements

- WordPress 6.0+
- WooCommerce 8.0+
- PHP 8.1+
- A running OverSeek server (see main [README](../README.md))

## Installation

1. **Copy the plugin** — Upload the `overseek-wc-plugin` folder to `/wp-content/plugins/`
2. **Activate** — Go to WordPress Admin → Plugins → Activate "OverSeek WooCommerce Integration"
3. **Configure** — Navigate to WooCommerce → OverSeek and paste your configuration JSON from the OverSeek dashboard

## Configuration

After activating, go to **WooCommerce → OverSeek** in your WordPress admin.

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
- Check that permalinks are configured (Settings → Permalinks → Save)
- Verify your `.htaccess` is writable

### Events not tracking
- Check the OverSeek dashboard → Settings → Plugin Health
- Verify your Secret Key matches in both OverSeek and WordPress

### Live chat not appearing
- Ensure "Enable Live Chat" is turned on in WooCommerce → OverSeek
- Clear any page caches
- Check for JavaScript errors in browser console

## Development

For local development, configure the plugin to point to your local OverSeek server:

```
API URL: http://localhost:3000
```

## License

MIT — Same as the main OverSeek project.

# Companion 2.25.16 — cart/checkout asset recovery

Prepared on 2026-11-05 after a live cart/checkout incident following installation of 2.25.15. This is targeted recovery, not a confirmed explanation of the original URL corruption.

## Evidence and scope

- A read-only fetch of the public checkout reproduced 14 WooCommerce script URLs with the OverSeek plugin URL followed by the server's absolute WooCommerce filesystem path. WooCommerce styles used the correct plugin URL.
- The canonical WooCommerce `assets/client/blocks/wc-settings.js` URL returned HTTP 200 with `application/javascript`; the problem is the generated URL, not a missing JavaScript artifact or a MIME configuration change.
- Missing Woo Blocks dependencies explain the downstream Stripe/PayPal/global `wc` errors. No checkout was submitted and no live settings, caches, orders or payments were modified during investigation.
- The code review did not identify a URL rewrite in the 2.25.15 tracking changes. The original producer of the malformed URLs remains unconfirmed; cache recovery alone does not establish causation.

## Recovery

- Register recovery regardless of whether tracking is enabled.
- Inspect only WooCommerce's two Blocks script-data transient caches. If a source has this precise malformed prefix, delete that transient through WordPress's API and return a cache miss so WooCommerce regenerates its script data.
- As a last-stage safety net, repair only `wc-` script handles whose URLs match the OverSeek URL plus the current absolute WooCommerce path, followed by a safe `assets/client/` JavaScript/CSS path. Resolve the replacement using `WC_PLUGIN_FILE`; preserve query strings. Healthy URLs, external/CDN assets and unrelated plugins remain unchanged.
- Retain the 2.25.15 background operational delivery/purchase isolation fixes.

## Artifact and validation

- ZIP: `server/uploads/plugins/overseek-wc-plugin.zip`.
- Version **2.25.16**, **228 runtime files**, **1,133,142 bytes**.
- ZIP SHA-256: `5c96b1f5e7e0e8f773aabd8349d2e643c90bb45f331052d85cbc5b650e9e585a`.
- Manifest SHA-256: `fec88294429be61e565a38cc20a38fe8fedb2360a11bf976129f20099f0d62c4`.
- Packaged PHP lint and exact ZIP content/CRC checks pass; verified publication copied the candidate bytes to the download path and updated matching client/server pins.
- New dependency-free asset tests pass for malformed checkout/admin sources, healthy/CDN URLs, safe-path restrictions, unrelated handles, query preservation and both transient cache variants.
- All 21 tracking regressions, purchase-link and cache-lifecycle checks pass.
- Added native WordPress CI checks for real WooCommerce asset registration, transient invalidation and final script output. These require disposable WordPress/MySQL and have not been run locally.

## Store recovery

1. If checkout is unusable, temporarily deactivate OverSeek and purge page/CDN HTML while preparing recovery. The cached WooCommerce asset URLs can survive plugin deactivation.
2. With WP-CLI, explicitly clear only the derived Woo Blocks script caches when needed:

   ```sh
   wp transient delete woocommerce_blocks_asset_api_script_data
   wp transient delete woocommerce_blocks_asset_api_script_data_ssl
   ```

3. Install 2.25.16 in place (do not uninstall/delete), activate it, and purge storefront/CDN HTML and asset-optimization caches. Hard-refresh cart and checkout.
4. Verify Woo script URLs contain no filesystem paths, the scripts return JavaScript successfully, and payment methods render. Confirm on staging with a test order before assuming the checkout flow is fully restored.

No live install or post-install verification was performed here. Hosted compatibility/upgrade CI and store-side verification remain outstanding. If malformed URLs recur, inspect the cached script data, `plugins_url` filters, path constants/symlink mappings and asset optimizer behaviour rather than assuming this recovery identifies the originating bug.

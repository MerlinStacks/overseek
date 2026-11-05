<?php
/** Recover WooCommerce assets cached with an embedded local filesystem path. @package OverSeek */
declare(strict_types=1);
defined('ABSPATH') || exit;

final class OverSeek_WooCommerce_Assets
{
    public static function register(): void
    {
        // Woo Blocks persists script URLs independently of the storefront page cache.
        foreach (['woocommerce_blocks_asset_api_script_data', 'woocommerce_blocks_asset_api_script_data_ssl'] as $key) {
            add_filter('transient_' . $key, [self::class, 'recover_script_cache'], 10, 2);
        }
        add_filter('script_loader_src', [self::class, 'recover_script_src'], PHP_INT_MAX, 2);
    }

    /** Return the relative Woo asset only for the precise OverSeek/filesystem URL corruption. */
    private static function malformed_asset_suffix(string $src): ?string
    {
        if (!defined('WC_ABSPATH') || !defined('WC_PLUGIN_FILE')) {
            return null;
        }
        $prefix = rtrim(OVERSEEK_WC_PLUGIN_URL, '/') . '/' . ltrim(wp_normalize_path(WC_ABSPATH), '/');
        $prefix = trailingslashit($prefix);
        if (!str_starts_with($src, $prefix)) {
            return null;
        }
        $relative = substr($src, strlen($prefix));
        // Do not touch arbitrary plugins, remote assets, traversal paths or non-asset URLs.
        return preg_match('~\Aassets/client/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_.-]+\.(?:js|css)(?:[?#].*)?\z~D', $relative)
            ? $relative : null;
    }

    public static function recover_script_cache($value, string $key)
    {
        $cache = is_string($value) ? json_decode($value, true) : null;
        if (!is_array($cache) || !isset($cache['script_data']) || !is_array($cache['script_data'])) {
            return $value;
        }
        foreach ($cache['script_data'] as $script) {
            if (is_array($script) && isset($script['src']) && is_string($script['src'])
                && self::malformed_asset_suffix($script['src']) !== null) {
                // Use the transient API so persistent Redis/Memcached copies are removed too.
                delete_transient($key);
                return false;
            }
        }
        return $value;
    }

    public static function recover_script_src(string $src, string $handle): string
    {
        if (!str_starts_with($handle, 'wc-')) {
            return $src;
        }
        $relative = self::malformed_asset_suffix($src);
        if ($relative === null) {
            return $src;
        }
        // Derive the URL from WooCommerce's own entry point, not OverSeek's directory.
        $base = plugin_dir_url(WC_PLUGIN_FILE);
        return self::malformed_asset_suffix($base . $relative) === null ? $base . $relative : $src;
    }
}

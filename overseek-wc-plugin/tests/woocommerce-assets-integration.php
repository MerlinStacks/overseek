<?php
/** Disposable native WP/Woo validation: real asset API, transients and script output. */
declare(strict_types=1);
if (getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS') !== '1' || !defined('ABSPATH')) {
    throw new RuntimeException('Requires disposable WordPress CI.');
}
$check = static function (bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
};
$api = \Automattic\WooCommerce\Blocks\Package::container()->get(\Automattic\WooCommerce\Blocks\Assets\Api::class);
foreach (['assets/client/blocks/wc-settings.js', 'assets/client/blocks/blocks-checkout.js', 'assets/client/blocks/wc-blocks-data.js', 'assets/client/admin/sanitize/index.js'] as $asset) {
    $data = $api->get_script_data($asset);
    $check($data['src'] === plugins_url($asset, WC_PLUGIN_FILE), 'Native Woo asset URL corrupted: ' . $asset);
    $check(!str_contains($data['src'], wp_normalize_path(WC_ABSPATH)), 'Filesystem path leaked into native Woo asset URL');
}
$bad = OVERSEEK_WC_PLUGIN_URL . ltrim(wp_normalize_path(WC_ABSPATH), '/');
$asset = 'assets/client/blocks/wc-settings.js';
foreach (['woocommerce_blocks_asset_api_script_data', 'woocommerce_blocks_asset_api_script_data_ssl'] as $key) {
    $previous = get_transient($key);
    try {
        set_transient($key, wp_json_encode(['script_data' => [$asset => ['src' => $bad . $asset]]]), HOUR_IN_SECONDS);
        $check(get_transient($key) === false, 'Poisoned Woo cache was not invalidated through native transient API');
    } finally {
        if ($previous === false) delete_transient($key);
        else set_transient($key, $previous, HOUR_IN_SECONDS);
    }
}
wp_register_script('wc-overseek-asset-probe', $bad . $asset, [], null, true);
try {
    ob_start();
    wp_scripts()->do_item('wc-overseek-asset-probe');
    $html = (string) ob_get_clean();
    $check(str_contains($html, plugins_url($asset, WC_PLUGIN_FILE)), 'Native script output did not recover the Woo URL');
    $check(!str_contains($html, wp_normalize_path(WC_ABSPATH)), 'Native script output leaked a local filesystem path');
} finally {
    wp_deregister_script('wc-overseek-asset-probe');
}
echo "Native WooCommerce asset registration, poisoned-cache recovery and script output passed.\n";

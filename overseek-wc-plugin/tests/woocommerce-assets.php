<?php
/** Dependency-free regression for the cart/checkout filesystem-path asset incident. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('OVERSEEK_WC_PLUGIN_URL', 'https://store.test/wp-content/plugins/overseek-wc-plugin/');
define('WC_ABSPATH', '/home/store/public_html/wp-content/plugins/woocommerce/');
define('WC_PLUGIN_FILE', WC_ABSPATH . 'woocommerce.php');
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
function wp_normalize_path($path) { return str_replace('\\', '/', $path); }
function trailingslashit($path) { return rtrim($path, '/') . '/'; }
function plugin_dir_url($file) {
    check($file === WC_PLUGIN_FILE, 'URL must be derived from WooCommerce entry point');
    return 'https://cdn.store.test/custom-plugins/woocommerce/';
}
function add_filter($hook, $callback, $priority = 10, $args = 1) { $GLOBALS['hooks'][$hook] = [$callback, $priority, $args]; }
function delete_transient($key) { $GLOBALS['deleted'][] = $key; }
require __DIR__ . '/../includes/class-overseek-woocommerce-assets.php';
OverSeek_WooCommerce_Assets::register();
$bad = OVERSEEK_WC_PLUGIN_URL . ltrim(WC_ABSPATH, '/');
foreach (['assets/client/blocks/wc-settings.js', 'assets/client/blocks/blocks-checkout.js', 'assets/client/blocks/wc-blocks-data.js', 'assets/client/admin/sanitize/index.js'] as $asset) {
    $src = $bad . $asset . '?ver=abc&test=1';
    check(OverSeek_WooCommerce_Assets::recover_script_src($src, 'wc-settings') === 'https://cdn.store.test/custom-plugins/woocommerce/' . $asset . '?ver=abc&test=1', 'Malformed asset was not repaired with query preserved');
}
foreach ([
    'https://store.test/wp-content/plugins/woocommerce/assets/client/blocks/wc-settings.js',
    'https://cdn.test/woocommerce/assets/client/blocks/wc-settings.js',
    OVERSEEK_WC_PLUGIN_URL . 'assets/js/storefront-views.js',
    $bad . '../private.js', $bad . 'assets/client/../private.js',
    'https://other.test/' . ltrim(WC_ABSPATH, '/') . 'assets/client/blocks/wc-settings.js',
] as $src) {
    check(OverSeek_WooCommerce_Assets::recover_script_src($src, 'wc-settings') === $src, 'Valid or out-of-scope URL changed');
}
check(OverSeek_WooCommerce_Assets::recover_script_src($bad . 'assets/client/blocks/wc-settings.js', 'another-plugin') === $bad . 'assets/client/blocks/wc-settings.js', 'Unrelated handle changed');
foreach (['woocommerce_blocks_asset_api_script_data', 'woocommerce_blocks_asset_api_script_data_ssl'] as $key) {
    $GLOBALS['deleted'] = [];
    $valid = json_encode(['script_data' => ['settings' => ['src' => 'https://cdn.test/wc-settings.js']]]);
    check(OverSeek_WooCommerce_Assets::recover_script_cache($valid, $key) === $valid, 'Healthy cache changed');
    foreach ([false, '', '{invalid', json_encode(['script_data' => 'invalid'])] as $value) {
        check(OverSeek_WooCommerce_Assets::recover_script_cache($value, $key) === $value, 'Unrelated malformed cache changed');
    }
    check($GLOBALS['deleted'] === [], 'Healthy cache deleted');
    $poisoned = json_encode(['script_data' => ['settings' => ['src' => $bad . 'assets/client/blocks/wc-settings.js']]]);
    check(OverSeek_WooCommerce_Assets::recover_script_cache($poisoned, $key) === false, 'Poisoned cache must be a miss');
    check($GLOBALS['deleted'] === [$key], 'Only the affected WooCommerce transient should be deleted');
    check(isset($GLOBALS['hooks']['transient_' . $key]), 'Cache recovery filter missing');
}
check($GLOBALS['hooks']['script_loader_src'][1] === PHP_INT_MAX, 'Last-stage script safety check missing');
echo "WooCommerce cart/checkout asset URL and poisoned-cache regressions passed.\n";

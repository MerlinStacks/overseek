<?php
/** Isolated page-cache/upgrade contracts; no WordPress or remote services required. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('OVERSEEK_WC_VERSION', '2.25.0');
define('OVERSEEK_WC_PLUGIN_FILE', '/plugins/overseek-wc-plugin/overseek-integration.php');
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
$options = $transients = $cron = $actions = $purges = [];
$requests = 0;
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function update_option($key, $value, ...$args) {
    $old = get_option($key, null); $GLOBALS['options'][$key] = $value;
    if ($old !== $value) { do_action(null === $old ? 'added_option' : 'updated_option', $key, ... (null === $old ? [$value] : [$old, $value])); }
}
function delete_option($key) { unset($GLOBALS['options'][$key]); do_action('deleted_option', $key); }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function delete_transient($key) { unset($GLOBALS['transients'][$key]); }
function set_transient($key, $value, $ttl) { $GLOBALS['transients'][$key] = $value; }
function add_action($hook, $callback, $priority = 10, $args = 1) { $GLOBALS['actions'][$hook][] = [$callback, $args]; }
function do_action($hook, ...$args) { foreach ($GLOBALS['actions'][$hook] ?? [] as [$callback, $count]) { $callback(...array_slice($args, 0, $count)); } }
function wp_next_scheduled($hook, $args = []) { return $GLOBALS['cron'][$hook . serialize($args)] ?? false; }
function wp_schedule_single_event($time, $hook, $args = []) { $GLOBALS['cron'][$hook . serialize($args)] = $time; }
function plugin_basename($file) { return 'overseek-wc-plugin/' . basename($file); }
function rocket_clean_domain() { $GLOBALS['purges'][] = 'rocket'; }
function w3tc_flush_posts() { $GLOBALS['purges'][] = 'w3tc'; }
function wp_cache_clear_cache() { $GLOBALS['purges'][] = 'supercache'; }
function wp_cache_flush() { throw new RuntimeException('Global object cache must never be flushed'); }
function is_user_logged_in() { return $GLOBALS['private_page'] === 'logged-in'; }
function is_cart() { return $GLOBALS['private_page'] === 'cart'; }
function is_checkout() { return $GLOBALS['private_page'] === 'checkout'; }
function is_account_page() { return $GLOBALS['private_page'] === 'account'; }
function nocache_headers() { $GLOBALS['no_cache'] = true; }
function wp_remote_get($url, $args) { ++$GLOBALS['requests']; return $GLOBALS['response'] ?? []; }
function is_wp_error($response) { return false; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function wp_json_encode($value) { return json_encode($value); }
function esc_html($value) { return $value; }
function esc_url($value) { return $value; }
function esc_attr($value) { return $value; }
class OverSeek_HTTP_Utils { public static function decode_json_response($response) { return $response['data'] ?? null; } }
require __DIR__ . '/../includes/class-overseek-crypto-utils.php';
require __DIR__ . '/../includes/class-overseek-cache.php';
require __DIR__ . '/../includes/class-overseek-frontend.php';
require __DIR__ . '/../includes/class-overseek-pixel-config-provider.php';
function check($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }
OverSeek_Cache::register();
add_action('litespeed_purge', function ($tag) { check($tag === '*', 'LiteSpeed invalidates shared page tags'); $GLOBALS['purges'][] = 'litespeed'; });
add_action('litespeed_purge_all', function () { throw new RuntimeException('LiteSpeed purge_all would flush object/opcode caches'); });
add_action('overseek_purge_page_cache', function ($reasons) { $GLOBALS['reasons'] = $reasons; });
$options = ['overseek_account_id' => 'account-a', 'overseek_api_url' => 'https://overseek.test',
    'overseek_enable_tracking' => true, 'overseek_enable_chat' => true,
    'overseek_storefront_chat_config' => ['businessHours' => ['enabled' => true, 'days' => []]],
    'overseek_storefront_pixel_config' => ['meta' => ['pixelId' => '123']]];
$local = $options['overseek_storefront_pixel_config'];
$hash = OverSeek_Crypto_Utils::hash_key_fragment('account-a', 32);
$transients = ['overseek_pixels_' . $hash => ['old'], 'overseek_pixels_stale_' . $hash => ['old'],
    'overseek_chat_config_' . md5('account-a') => ['old'], '_overseek_failed_events' => ['purchase'], 'unrelated' => 'keep'];
do_action('init');
check(get_option('overseek_cache_version') === OVERSEEK_WC_VERSION, 'First new-code request records version');
check($options['overseek_storefront_pixel_config'] === $local, 'Upgrade retains last known configuration');
check($transients === ['_overseek_failed_events' => ['purchase'], 'unrelated' => 'keep'], 'Only account config transients removed (persistent-cache API)');
check(count($cron) === 2 && $requests === 0, 'Upgrade refreshes asynchronously');
do_action('shutdown');
check(count($purges) === 4, 'All four page-cache integrations run');
do_action('init'); do_action('shutdown');
check(count($purges) === 4, 'Normal requests do not repeatedly purge');
do_action('upgrader_process_complete', null, ['type' => 'plugin', 'action' => 'update', 'plugins' => ['other/plugin.php']]);
do_action('shutdown');
check(count($purges) === 4, 'Unrelated plugin updates do not trigger our page purge');
do_action('upgrader_process_complete', null, ['type' => 'plugin', 'action' => 'update', 'plugins' => ['overseek-wc-plugin/overseek-integration.php']]);
check(get_option('overseek_cache_upgrade_pending') === true, 'Bulk upgrade marks pending, even for same-version reinstall');
do_action('shutdown'); do_action('init'); do_action('shutdown');
check(count($purges) === 12 && !get_option('overseek_cache_upgrade_pending'), 'Old-code purge followed by new-code cleanup');
update_option('overseek_storefront_pixel_config', ['meta' => ['pixelId' => '456']]);
update_option('overseek_enable_chat', false);
update_option('overseek_storefront_pixel_config_updated_at', time());
do_action('shutdown');
check(count($purges) === 16 && count($GLOBALS['reasons']) === 2, 'Multiple changed settings coalesce, timestamps do not purge');
update_option('overseek_storefront_pixel_config', ['meta' => ['pixelId' => '456']]); do_action('shutdown');
check(count($purges) === 16, 'Unchanged refreshed payload does not purge');
do_action('upgrader_process_complete', (object) ['result' => ['destination_name' => 'overseek-wc-plugin']], ['type' => 'plugin', 'action' => 'install']);
check(get_option('overseek_cache_upgrade_pending') === true, 'Upload-and-replace install marks same-version packages for cleanup');
do_action('init'); do_action('shutdown');

$options['overseek_enable_chat'] = true;
$cron = [];
$frontend = new OverSeek_Frontend();
ob_start(); $frontend->print_scripts(); $html = ob_get_clean();
check(str_contains($html, '/api/chat/widget.js') && count($cron) === 1 && $requests === 0, 'Closed-hours cached HTML still contains widget reference and refreshes stale local config without HTTP');
$response = ['data' => ['businessHours' => ['enabled' => false]]];
$frontend->handle_background_refresh('account-a');
check(get_option('overseek_storefront_chat_config_updated_at') > 0 && $requests === 1, 'Successful chat refresh records freshness');
$frontend->handle_background_refresh('old-account');
check($requests === 1, 'Delayed refresh for disconnected account ignored');
$cron = [];
ob_start(); $frontend->print_scripts(); ob_end_clean();
check($cron === [], 'Fresh local chat config schedules nothing');
$options['overseek_storefront_chat_config_updated_at'] = 0;
$response = []; $before = get_option('overseek_storefront_chat_config');
$frontend->handle_background_refresh('account-a');
check(get_option('overseek_storefront_chat_config') === $before && get_option('overseek_storefront_chat_config_updated_at') === 0, 'Failed refresh retains stale config and does not mark fresh');
update_option('overseek_account_id', 'account-b');
check(get_option('overseek_storefront_pixel_config') === false && get_option('overseek_storefront_chat_config') === false, 'Relinking does not reuse another account local configuration');
$private_page = 'catalogue'; $no_cache = false;
OverSeek_Cache::protect_private_pages();
check(!$no_cache && !defined('DONOTCACHEPAGE'), 'Public catalogue pages stay cacheable');
foreach (['cart', 'checkout', 'account', 'logged-in'] as $private_page) {
    $no_cache = false;
    OverSeek_Cache::protect_private_pages();
    check($no_cache && DONOTCACHEPAGE, 'Private pages send early cache directives: ' . $private_page);
}
echo "Cache lifecycle and configuration refresh checks passed.\n";

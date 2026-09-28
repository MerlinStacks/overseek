<?php
/** Exercise the public collector with real tracking, attribution and payload builders. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('OVERSEEK_WC_VERSION', '2.25.0');
define('DAY_IN_SECONDS', 86400);
define('HOUR_IN_SECONDS', 3600);
$options = ['overseek_enable_tracking' => true, 'overseek_account_id' => 'store-a', 'overseek_api_url' => 'https://overseek.test'];
$actions = []; $product_page = true; $ajax = false; $consent = true; $search = false;
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function apply_filters($hook, $value) { return $value; }
function add_action($hook, $callback, ...$args) { $GLOBALS['actions'][$hook][] = $callback; }
function add_filter(...$args) {}
function get_transient($key) { return false; }
function is_admin() { return false; }
function wp_doing_ajax() { return $GLOBALS['ajax']; }
function wp_doing_cron() { return false; }
function is_product() { return $GLOBALS['product_page']; }
function is_cart() { return false; }
function is_checkout() { return false; }
function is_account_page() { return false; }
function is_feed() { return false; }
function is_preview() { return false; }
function is_front_page() { return !$GLOBALS['product_page']; }
function is_search() { return $GLOBALS['search']; }
function get_search_query() { return 'engraved gifts'; }
function is_404() { return false; }
function is_product_category() { return false; }
function is_user_logged_in() { return false; }
function get_queried_object_id() { return 42; }
function home_url($path = '') { return 'https://store.test' . $path; }
function wp_parse_url($url, $component = -1) { return parse_url($url, $component); }
function add_query_arg($args) { return $_SERVER['REQUEST_URI']; }
function wp_salt($scheme) { return 'fixture-site-salt'; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function wp_enqueue_script(...$args) { $GLOBALS['asset'] = $args; }
function wp_add_inline_script($handle, $js, $position) { $GLOBALS['inline'] = $js; }
function plugins_url($path, $file) { return 'https://store.test/plugins/' . $path; }
function wp_unslash($value) { return is_array($value) ? array_map('wp_unslash', $value) : stripslashes($value); }
function esc_url_raw($value) { return $value; }
function sanitize_text_field($value) { return strip_tags($value); }
function untrailingslashit($value) { return rtrim($value, '/'); }
function absint($value) { return abs((int) $value); }
function is_ssl() { return true; }
function wp_rand($min, $max) { return random_int($min, $max); }
function wp_get_document_title() { return 'Wrong AJAX title'; }
function wp_get_current_user() { return (object) ['ID' => 0]; }
function wp_has_consent($category) { return $GLOBALS['consent']; }
function get_the_terms($id, $taxonomy) { return []; }
function is_wp_error($value) { return false; }
function wp_list_pluck($rows, $key) { return array_column($rows, $key); }
function nocache_headers() { $GLOBALS['no_cache'] = true; }
class Json_Response extends RuntimeException { public function __construct(public $data, public $status) { parent::__construct('response'); } }
function wp_send_json($data, $status = 200) { throw new Json_Response($data, $status); }
class WC_AJAX { public static function get_endpoint($name) { return '/?wc-ajax=' . $name; } }
class WC_Product {
    public function get_id() { return 42; }
    public function get_name() { return 'Example product'; }
    public function get_sku() { return 'SKU-42'; }
    public function get_status() { return 'publish'; }
    public function get_price() { return '12.00'; }
    public function get_regular_price() { return '12.00'; }
    public function get_sale_price() { return ''; }
    public function is_in_stock() { return true; }
    public function get_type() { return 'simple'; }
}
function wc_get_product($id) { return 42 === $id ? new WC_Product() : false; }
class OverSeek_HTTP_Utils { public static function get_client_ip() { return '192.0.2.1'; } }
class OverSeek_Pixel_Config_Provider { public static function get_config(...$args) { return []; } }
foreach (['tracking-guard-utils', 'tracking-request-utils', 'tracking-attribution-utils', 'tracking-payload-utils', 'tracking-event-builder', 'pixel-matching-utils', 'tracking-transport', 'server-tracking', 'browser-views'] as $file) {
    require_once __DIR__ . '/../includes/class-overseek-' . $file . '.php';
}
function check($value, $message) { if (!$value) { throw new RuntimeException($message); } }
function events($tracker) { return (new ReflectionProperty($tracker, 'event_queue'))->getValue($tracker); }
function collect($collector, $input, $overrides = []) {
    $_POST = array_map('addslashes', $input);
    $_GET = ['wc-ajax' => 'overseek_view'];
    $_SERVER = array_merge(['REQUEST_METHOD' => 'POST', 'HTTP_ORIGIN' => 'https://store.test', 'HTTP_REFERER' => 'https://store.test/product/',
        'REQUEST_URI' => '/?wc-ajax=overseek_view', 'HTTP_USER_AGENT' => 'Mozilla/5.0 Chrome/130'], $overrides);
    $GLOBALS['ajax'] = true;
    try { $collector->collect(); } catch (Json_Response $response) { return $response; }
    throw new RuntimeException('Missing response');
}
$_SERVER = ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/product/', 'HTTP_USER_AGENT' => 'Mozilla/5.0 Chrome/130'];
$_GET = $_POST = $_COOKIE = [];
$tracker = new OverSeek_Server_Tracking();
check(!isset($actions['woocommerce_after_single_product']), 'No server product hook to double count cache misses');
check(!in_array([$tracker, 'track_pageview'], $actions['template_redirect'] ?? [], true), 'No server pageview hook to double count cache misses');
$tracker->init_visitor_cookie();
check($_COOKIE === [], 'Public HTML response does not initialize visitor cookies');
$collector = new OverSeek_Browser_Views($tracker);
$collector->enqueue(); $first = $inline;
$_COOKIE = ['_os_vid' => 'different-shopper', 'email' => 'private@example.test'];
$collector->enqueue();
check($first === $inline && !str_contains($inline, 'different-shopper') && !str_contains($inline, 'private@example.test'), 'Shared HTML contains no visitor identity or per-visit ID');
$config = json_decode(substr($inline, strlen('window.overseekViews='), -1), true);
check($asset[3] === OVERSEEK_WC_VERSION, 'Collector asset is release-versioned');
$input = ['context' => $config['context'], 'signature' => $config['signature'], 'url' => 'https://store.test/product/?utm_source=google&fbclid=click-a',
    'referrer' => 'https://www.google.com/search?q=shop', 'title' => 'Actual product title', 'eventId' => 'os_view_unique_browser_event_a'];
$_COOKIE = [];
$response = collect($collector, $input);
check($response->status === 200 && $no_cache, 'Collector accepts signed public context and disables caching');
$event = events($tracker)[0];
check($event['type'] === 'product_view' && $event['payload']['eventId'] === $input['eventId'], 'Browser and CAPI share the visit event ID');
check($event['pageTitle'] === $input['title'] && $event['url'] === $input['url'], 'Page context does not become AJAX endpoint metadata');
check($event['utmSource'] === 'google' && $event['clickId'] === 'click-a' && $event['referrerType'] === 'organic', 'Actual visit URL and document referrer drive attribution');
check($event['visitorId'] === $_COOKIE['_os_vid'] && !isset($_COOKIE['_os_pv_eid']), 'Visitor cookie issued on private response without stale dedup cookies');
check($_GET === ['wc-ajax' => 'overseek_view'] && $_SERVER['HTTP_REFERER'] === 'https://store.test/product/', 'Temporary attribution request context restored');
$cookie = $_COOKIE['_os_vid'];
$next = new OverSeek_Server_Tracking();
collect(new OverSeek_Browser_Views($next), array_merge($input, ['eventId' => 'os_view_unique_browser_event_b']));
check(events($next)[0]['visitorId'] === $cookie, 'Cached subsequent visits retain the same visitor');

foreach ([['signature' => 'bad'], ['url' => 'https://attacker.test/product/'], ['url' => 'https://store.test/other/'], ['eventId' => 'invalid'], ['context' => '{"type":"purchase"}']] as $bad) {
    check(collect($collector, array_merge($input, $bad))->status === 400, 'Tampered or malformed public event rejected');
}
check(collect($collector, $input, ['HTTP_ORIGIN' => 'https://attacker.test'])->status === 403, 'Cross-origin rejected');
check(collect($collector, $input, ['REQUEST_METHOD' => 'GET'])->status === 400, 'GET never creates events');
check(collect($collector, $input, ['CONTENT_LENGTH' => 20000])->status === 400, 'Oversized body rejected');
$count = count(events($tracker));
$options['overseek_require_consent'] = true; $consent = false; $_COOKIE = [];
check(collect($collector, $input)->data['tracked'] === false && $_COOKIE === [], 'Current denied consent blocks both identity and event');
$consent = true;
check(collect($collector, $input, ['HTTP_USER_AGENT' => 'Googlebot'])->data['tracked'] === false, 'Known bots filtered on collector');
$options['overseek_enable_tracking'] = false;
check(collect($collector, $input)->data['tracked'] === false && count(events($tracker)) === $count, 'Disabled tracking respected even for old cached HTML');
$options['overseek_account_id'] = 'different-account';
check(collect($collector, $input)->status === 400, 'Cached metadata cannot cross account changes');
$options['overseek_account_id'] = 'store-a'; $options['overseek_enable_tracking'] = true;
foreach ([false, true] as $search) {
    $product_page = false; $ajax = false; $_SERVER['REQUEST_URI'] = '/';
    $page_tracker = new OverSeek_Server_Tracking(); $page_collector = new OverSeek_Browser_Views($page_tracker);
    $page_collector->enqueue();
    $config = json_decode(substr($inline, strlen('window.overseekViews='), -1), true);
    $page_input = array_merge($input, ['context' => $config['context'], 'signature' => $config['signature'], 'url' => 'https://store.test/?utm_source=google']);
    collect($page_collector, $page_input);
    check(array_column(events($page_tracker), 'type') === ($search ? ['pageview', 'search'] : ['pageview']), 'Cached ordinary and search pages collect the right events');
    if ($search) { check(events($page_tracker)[1]['payload']['eventId'] === $input['eventId'], 'Search CAPI uses browser dedup ID'); }
    $options['overseek_track_pageviews'] = false;
    check(collect($page_collector, $page_input)->data['tracked'] === false, 'Pageview toggle takes effect on cached pages');
    $options['overseek_track_pageviews'] = true;
}
echo "Browser view collection, cache identity and attribution checks passed.\n";

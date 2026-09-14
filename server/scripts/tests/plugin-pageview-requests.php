<?php
/**
 * Isolated request-classification and hook regression tests (no WordPress required).
 * Run: php server/scripts/tests/plugin-pageview-requests.php
 */
declare(strict_types=1);
define('ABSPATH', __DIR__);

function is_admin(): bool { return $GLOBALS['admin'] ?? false; }
function wp_doing_ajax(): bool { return $GLOBALS['ajax'] ?? false; }
function wp_doing_cron(): bool { return $GLOBALS['cron'] ?? false; }
function is_product(): bool { return false; }
function is_cart(): bool { return false; }
function is_checkout(): bool { return false; }
function is_wc_endpoint_url($endpoint): bool { return false; }
function is_404(): bool { return false; }
function is_front_page(): bool { return true; }
function is_product_category(): bool { return false; }
function is_search(): bool { return false; }
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function apply_filters($hook, $value) { return $value; }
function wp_get_document_title(): string { return 'Home'; }
function sanitize_text_field($value): string { return (string) $value; }
function get_the_terms(...$args) { return false; }

class OverSeek_Tracking_Request_Utils
{
    public static function resolve_visitor_ip(): string { return '192.0.2.1'; }
    public static function get_referrer_data(): array { return ['referrer' => '', 'referrerDomain' => '', 'referrerType' => 'direct']; }
    public static function get_sanitized_current_url(): string { return 'https://store.example/'; }
    public static function get_logged_in_user_data(): array { return []; }
}
class OverSeek_Tracking_Attribution_Utils
{
    public static function get_utm_parameters(): array { return []; }
    public static function get_click_data($params): array { return []; }
    public static function get_landing_referrer(): string { return ''; }
}
class OverSeek_Pixel_Config_Provider
{
    public static function get_config(...$args): array { return []; }
}
class OverSeek_Tracking_Event_Builder
{
    public static function build_product_view_payload($product, ...$args): array { return ['productId' => $product->get_id()]; }
}
class Pageview_Test_Product
{
    public function get_id(): int { return 123; }
}

require_once __DIR__ . '/../../../overseek-wc-plugin/includes/class-overseek-tracking-guard-utils.php';
require_once __DIR__ . '/../../../overseek-wc-plugin/includes/class-overseek-server-tracking.php';

function check(bool $condition, string $message): void
{
    if (!$condition) { throw new RuntimeException($message); }
}
function request(array $headers = [], array $query = []): void
{
    $_SERVER = array_merge(['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/', 'HTTP_USER_AGENT' => 'Mozilla/5.0 Chrome/130'], $headers);
    $_GET = $query;
    $_POST = [];
    $_COOKIE = [];
    $GLOBALS['options'] = [];
    $GLOBALS['admin'] = $GLOBALS['ajax'] = $GLOBALS['cron'] = false;
}
function tracker(): OverSeek_Server_Tracking
{
    $reflection = new ReflectionClass(OverSeek_Server_Tracking::class);
    $tracker = $reflection->newInstanceWithoutConstructor();
    foreach (['visitor_id' => 'visitor-1', 'api_url' => 'https://overseek.example', 'account_id' => 'store-1'] as $key => $value) {
        $reflection->getProperty($key)->setValue($tracker, $value);
    }
    return $tracker;
}
function events(OverSeek_Server_Tracking $tracker): array
{
    return (new ReflectionProperty($tracker, 'event_queue'))->getValue($tracker);
}

$cases = [
    'normal document navigation' => [true, ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document', 'HTTP_ACCEPT' => 'text/html']],
    'reload without user activation' => [true, ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document']],
    'legacy browser without fetch metadata' => [true, []],
    'legacy HTML request' => [true, ['HTTP_ACCEPT' => 'text/html,application/xhtml+xml']],
    'wildcard accept without other signals' => [true, ['HTTP_ACCEPT' => '*/*']],
    'real POST form navigation' => [true, ['REQUEST_METHOD' => 'POST', 'HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document']],
    'iframe document' => [true, ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'iframe']],
    'root fetch request' => [false, ['HTTP_SEC_FETCH_MODE' => 'cors', 'HTTP_SEC_FETCH_DEST' => 'empty']],
    'same-origin background request' => [false, ['HTTP_SEC_FETCH_MODE' => 'same-origin']],
    'empty fetch destination' => [false, ['HTTP_SEC_FETCH_DEST' => 'empty']],
    'legacy jQuery AJAX request' => [false, ['HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest']],
    'root background POST' => [false, ['REQUEST_METHOD' => 'POST']],
    'HEAD probe' => [false, ['REQUEST_METHOD' => 'HEAD']],
    'OPTIONS probe' => [false, ['REQUEST_METHOD' => 'OPTIONS']],
    'JSON request' => [false, ['HTTP_ACCEPT' => 'application/json']],
    'image request to root' => [false, ['HTTP_SEC_FETCH_DEST' => 'image']],
    'prefetch with navigation headers' => [false, ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document', 'HTTP_SEC_PURPOSE' => 'prefetch;prerender']],
    'legacy prefetch' => [false, ['HTTP_PURPOSE' => 'prefetch']],
    'legacy prerender' => [false, ['HTTP_X_PURPOSE' => 'prerender']],
    'Firefox prefetch' => [false, ['HTTP_X_MOZ' => 'prefetch']],
    'late WooCommerce AJAX flag' => [false, [], ['wc-ajax' => 'get_refreshed_fragments']],
    'normal campaign and action parameters' => [true, [], ['utm_source' => 'google', 'action' => 'browse']],
];

$count = 0;
foreach ($cases as $name => $case) {
    [$expected, $headers] = $case;
    request($headers, $case[2] ?? []);
    check(OverSeek_Tracking_Guard_Utils::is_document_view_request() === $expected, $name);
    $tracker = tracker();
    $tracker->track_pageview();
    check(count(events($tracker)) === ($expected ? 1 : 0), 'Pageview hook: ' . $name);
    $GLOBALS['product'] = new Pageview_Test_Product();
    $tracker->track_product_view();
    check(count(events($tracker)) === ($expected ? 2 : 0), 'Product hook: ' . $name);
    fwrite(STDOUT, "PASS: {$name}\n");
    $count++;
}

request();
$tracker = tracker();
$tracker->track_pageview();
$tracker->track_pageview();
$tracker->track_product_view();
$tracker->track_product_view();
check(array_column(events($tracker), 'type') === ['pageview', 'product_view'], 'Duplicate hooks must queue each view only once');
$second_request = tracker();
$second_request->track_pageview();
$second_request->track_product_view();
check(count(events($second_request)) === 2, 'New requests must still count genuine reloads/return visits');
fwrite(STDOUT, "PASS: per-request deduplication preserves subsequent navigations\n");
$count++;

foreach (['admin', 'ajax', 'cron'] as $context) {
    request();
    $GLOBALS[$context] = true;
    check(!OverSeek_Tracking_Guard_Utils::is_document_view_request(), 'Excluded WordPress context: ' . $context);
    $count++;
}
request();
$GLOBALS['options']['overseek_require_consent'] = true;
$tracker = tracker();
$tracker->track_pageview();
$tracker->track_product_view();
check(events($tracker) === [], 'Consent checks must remain effective');
$count++;

// Constants cannot be reset, so exercise the REST exclusion last.
request();
define('REST_REQUEST', true);
check(!OverSeek_Tracking_Guard_Utils::is_document_view_request(), 'REST request must be excluded');
$count++;
fwrite(STDOUT, "{$count} pageview regression checks passed.\n");

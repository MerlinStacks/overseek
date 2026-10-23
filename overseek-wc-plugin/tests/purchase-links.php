<?php
/** Purchase links must describe the customer page, never the processing request. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('DAY_IN_SECONDS', 86400);

function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? ($key === 'overseek_require_consent' ? ($GLOBALS['require_consent'] ?? false) : $default); }
function add_action($hook, $callback, $priority = 10, $args = 1) { $GLOBALS['actions'][$hook][] = $callback; }
function add_filter(...$args) {}
function wp_schedule_single_event($at, $hook, $args) { $GLOBALS['scheduled'][] = [$at, $hook, $args]; return true; }
function apply_filters($hook, $value) { return $hook === 'overseek_browser_views' ? false : $value; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function wp_get_document_title() { return 'Checkout'; }
function sanitize_text_field($value) { return strip_tags($value); }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? false; }
function wp_json_encode($value) { return json_encode($value); }
function is_admin() { return false; }
function wp_doing_ajax() { return false; }
function wp_doing_cron() { return false; }
function WC() { return $GLOBALS['woocommerce'] ?? null; }

class Activity_Session {
    private array $data = [];
    public function get($key, $default = null) { return $this->data[$key] ?? $default; }
    public function set($key, $value) { $this->data[$key] = $value; }
    public function __unset($key) { unset($this->data[$key]); }
}
require_once __DIR__ . '/../includes/class-overseek-tracking-guard-utils.php';
class OverSeek_Tracking_Request_Utils {
    public static function get_sanitized_current_url() { return 'https://store.test' . $_SERVER['REQUEST_URI']; }
    public static function resolve_visitor_ip() { return $GLOBALS['request_ip'] ?? '192.0.2.1'; }
    public static function get_referrer_data() { return ['referrer' => '', 'referrerDomain' => '', 'referrerType' => 'direct']; }
    public static function get_logged_in_user_data() { return []; }
}
class OverSeek_Tracking_Attribution_Utils {
    public static function get_utm_parameters() { return []; }
    public static function get_click_data($params) { return $GLOBALS['click_data'] ?? []; }
    public static function get_landing_referrer() { return ''; }
}
class OverSeek_Pixel_Config_Provider {
    public static function get_config(...$args) { return []; }
}
class OverSeek_Tracking_Event_Builder {
    public static function ensure_order_event_id($order) { return 'purchase-' . $order->get_id(); }
    public static function build_purchase_payload($order, $id, $event_id, $config, $browser = true) {
        $payload = ['orderId' => $id, 'eventId' => $event_id, 'total' => $order->total, 'currency' => 'AUD'];
        return $browser ? OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload) : $payload;
    }
    public static function build_cart_view_payload(...$args) { return []; }
    public static function build_checkout_view_payload(...$args) { return []; }
}
class OverSeek_Tracking_Payload_Utils {
    public static function attach_platform_cookies($payload) { return $payload + array_intersect_key($_COOKIE, array_flip(['fbc', 'fbp', 'gaSessionIds'])); }
}
class OverSeek_Pixel_Matching_Utils {
    public static function get_external_id() { return 'original-shopper'; }
}
class OverSeek_Tracking_Transport {
    public const RETRY_HOOK = 'retry-test';
    public static bool $acknowledge = true;
    public static function schedule_failed_events_retry() {}
    public static array $sent = [];
    public static function flush_events($url, $events) {
        self::$sent = array_merge(self::$sent, $events);
        return array_fill_keys(array_column(array_column($events, 'payload'), 'eventId'), self::$acknowledge);
    }
}
class Purchase_Order {
    private array $meta = [];
    public int $total = 25;
    public function __construct(private int $id, private string $url, public string $status = 'processing') {}
    public function get_id() { return $this->id; }
    public function is_paid() { return in_array($this->status, ['processing', 'completed'], true); }
    public function get_checkout_order_received_url() { return $this->url; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function save_meta_data() {}
    public function get_date_paid() { return new class { public function date($format) { return '2026-10-23T01:02:03+00:00'; } }; }
    public function save() {}
}
require_once __DIR__ . '/../includes/class-overseek-server-tracking.php';
function check($value, $message) { if (!$value) { throw new RuntimeException($message); } }

$tracker = new OverSeek_Server_Tracking();
(new ReflectionProperty($tracker, 'visitor_id'))->setValue($tracker, 'visitor-fixture');
$_SERVER = [];
$urls = [
    'https://store.test/checkout/order-received/101/?key=wc_order_classic',
    'https://store.test/custom-checkout/thanks/102/?key=wc_order_blocks',
    'https://store.test/?page_id=9&order-received=103&key=wc_order_plain',
];
foreach ($urls as $index => $url) {
    $id = 101 + $index;
    $order = $orders[$id] = new Purchase_Order($id, $url);
    $_SERVER['REQUEST_URI'] = $index === 0 ? '/checkout/order-received/101/?key=wc_order_classic' : '/wp-json/wc/store/v1/checkout?_locale=site';
    if ($index === 0) {
        $tracker->track_purchase($id);
    } else {
        $tracker->track_purchase_blocks($order);
    }
    $event = OverSeek_Tracking_Transport::$sent[$index];
    check($event['url'] === $url, 'Purchase uses the complete WooCommerce confirmation URL');
    check($event['type'] === 'purchase' && $event['payload']['orderId'] === $id, 'Purchase identity is preserved');
    check($order->get_meta('_overseek_tracked') === true, 'Acknowledged purchase marked tracked');
    $tracker->track_purchase($id);
    check(count(OverSeek_Tracking_Transport::$sent) === $index + 1, 'Thank-you page does not duplicate Blocks purchase');
}
$tracker->track_purchase(0);
$tracker->track_purchase(999);
$tracker->track_purchase_blocks(null);
check(count(OverSeek_Tracking_Transport::$sent) === 3, 'Invalid orders do not emit purchases');
echo "Classic and Blocks purchase confirmation links passed.\n";

// Failed and unfinished checkouts must not become purchases just by visiting
// order-received or reaching the pre-payment Store API hook.
foreach (['failed', 'pending', 'on-hold', 'cancelled', 'refunded', 'checkout-draft'] as $index => $status) {
    $id = 200 + $index;
    $order = $orders[$id] = new Purchase_Order($id, $urls[0], $status);
    $before = count(OverSeek_Tracking_Transport::$sent);
    $tracker->track_purchase($id);
    $tracker->track_purchase_blocks($order);
    check(count(OverSeek_Tracking_Transport::$sent) === $before, $status . ' order does not emit purchases');
    check(!$order->get_meta('_overseek_tracked'), $status . ' order remains eligible for a later successful payment');
    $order->status = $index % 2 === 0 ? 'processing' : 'completed';
    $tracker->track_purchase($id);
    $tracker->track_purchase_blocks($order);
    check(count(OverSeek_Tracking_Transport::$sent) === $before + 1, 'Successful payment after ' . $status . ' emits one purchase');
}
echo "Only paid orders emit purchases; successful retries remain tracked once.\n";

$woocommerce = (object) ['session' => new Activity_Session(), 'cart' => null];
function activity_tracker() {
    $tracker = new OverSeek_Server_Tracking();
    (new ReflectionProperty($tracker, 'visitor_id'))->setValue($tracker, 'visitor-fixture');
    return $tracker;
}
function queue_checkout($payload) {
    $tracker = activity_tracker();
    (new ReflectionMethod($tracker, 'queue_event'))->invoke($tracker, 'checkout_start', $payload);
    return (new ReflectionProperty($tracker, 'event_queue'))->getValue($tracker);
}
$payload = ['email' => 'shopper@example.test', 'items' => [['id' => 42, 'quantity' => 1]], 'total' => 25, 'currency' => 'AUD'];
check(count(queue_checkout($payload + ['eventId' => 'blocks-1', 'source' => 'store_api_checkout'])) === 1, 'Initial checkout recorded');
check(queue_checkout($payload + ['eventId' => 'ajax-2', 'source' => 'checkout_email_capture']) === [], 'Email AJAX duplicate suppressed across requests');
check(queue_checkout($payload + ['eventId' => 'classic-3']) === [], 'Classic submission duplicate suppressed across requests');
check(count(queue_checkout(array_replace($payload, ['email' => 'corrected@example.test']))) === 1, 'Corrected email still recorded');
check(count(queue_checkout(array_replace($payload, ['total' => 30]))) === 1, 'Changed cart still recorded');
$previous = $woocommerce->session->get('overseek_checkout_start');
$previous['at'] = time() - 1801;
$woocommerce->session->set('overseek_checkout_start', $previous);
check(count(queue_checkout(array_replace($payload, ['total' => 30]))) === 1, 'Later checkout attempt still recorded');
$orders[104] = new Purchase_Order(104, $urls[0]);
activity_tracker()->track_purchase_blocks($orders[104]);
check($woocommerce->session->get('overseek_checkout_start') === null, 'Purchase resets checkout duplicate guard');
check(count(queue_checkout($payload)) === 1, 'New checkout after purchase recorded');
$woocommerce->session = null;
check(count(queue_checkout($payload)) === 1, 'Missing Woo session does not disable tracking');

foreach (['track_cart_view', 'track_checkout_view'] as $method) {
    foreach ([
        ['REQUEST_METHOD' => 'GET', 'HTTP_SEC_FETCH_MODE' => 'cors', 'HTTP_SEC_FETCH_DEST' => 'empty'],
        ['REQUEST_METHOD' => 'POST'],
        ['REQUEST_METHOD' => 'GET', 'HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest'],
    ] as $request) {
        $_SERVER = $request;
        $tracker = activity_tracker();
        $tracker->$method();
        check((new ReflectionProperty($tracker, 'event_queue'))->getValue($tracker) === [], 'Background request is not a page view');
    }
    foreach ([[], ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document']] as $request) {
        $_SERVER = $request + ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/checkout/'];
        $tracker = activity_tracker();
        $tracker->$method();
        $tracker->$method();
        check(count((new ReflectionProperty($tracker, 'event_queue'))->getValue($tracker)) === 1, 'Classic and Blocks document views recorded once per request');
    }
}
echo "Checkout activity deduplication and document-only cart/checkout views passed.\n";

// A separate payment callback must work with no browser revisit or shopper cookies.
foreach (['classic', 'blocks'] as $index => $checkout) {
    $_SERVER = ['REQUEST_URI' => '/checkout/', 'HTTP_USER_AGENT' => 'Mozilla/5.0 Shopper'];
    $_COOKIE = ['fbc' => 'fb.original', 'fbp' => 'browser.original', 'gaSessionIds' => ['STREAM' => '123']];
    $request_ip = '192.0.2.1';
    $click_data = ['id' => 'original-google-click', 'platform' => 'google', 'param' => 'wbraid'];
    $tracker = activity_tracker();
    (new ReflectionProperty($tracker, 'account_id'))->setValue($tracker, 'account-original');
    $id = 400 + $index;
    $order = $orders[$id] = new Purchase_Order($id, $urls[0], 'pending');
    $before = count(OverSeek_Tracking_Transport::$sent);
    if ($checkout === 'classic') { $tracker->capture_purchase_context($order); }
    else { $tracker->track_purchase_blocks($order); }
    check(count(OverSeek_Tracking_Transport::$sent) === $before, 'Unpaid checkout only persists context');
    $captured = $order->get_meta('_overseek_purchase_context');
    check($captured['visitorId'] === 'visitor-fixture' && $captured['consentState'] === 'granted', 'Original visitor and consent saved');
    check(!isset($captured['payload']['total']), 'No stale pending-order revenue stored');
    $order->status = 'processing';
    $order->total = 80;
    $_COOKIE = ['fbc' => 'gateway-cookie', 'gaSessionIds' => ['OTHER' => '999']];
    $_SERVER = ['REQUEST_URI' => '/gateway/callback', 'HTTP_USER_AGENT' => 'GatewayBot/1.0'];
    $request_ip = '198.51.100.99';
    $click_data = ['id' => 'foreign-click', 'platform' => 'google', 'param' => 'gclid'];
    $callback = activity_tracker();
    (new ReflectionProperty($callback, 'account_id'))->setValue($callback, 'account-original');
    $callback->track_paid_purchase($id);
    $event = OverSeek_Tracking_Transport::$sent[$before];
    check($event['visitorId'] === 'visitor-fixture' && $event['userAgent'] === 'Mozilla/5.0 Shopper', 'Callback reuses shopper identity');
    check($event['visitorIp'] === '192.0.2.1', 'Callback never borrows gateway IP');
    check($event['clickId'] === 'original-google-click' && $event['clickIdType'] === 'wbraid', 'Original Google click and type survive payment callback');
    check($event['payload']['fbc'] === 'fb.original' && $event['payload']['gaSessionIds'] === ['STREAM' => '123'], 'Callback never borrows gateway cookies');
    check($event['payload']['total'] === 80 && $event['payload']['eventId'] === 'purchase-' . $id, 'Current paid value and stable event ID');
    check($event['occurredAt'] === '2026-10-23T01:02:03+00:00', 'Purchase time is payment time');
    check($order->get_meta('_overseek_purchase_context') === '', 'Acknowledged context removed');
    $callback->track_paid_purchase($id); // payment_complete followed by status change
    $callback->track_purchase($id); // later thank-you visit
    check(count(OverSeek_Tracking_Transport::$sent) === $before + 1, 'Payment/status/thank-you hooks do not duplicate acknowledged purchase');
}

foreach (['missing', 'denied', 'expired', 'other-account', 'unpaid'] as $index => $case) {
    $id = 500 + $index;
    $order = $orders[$id] = new Purchase_Order($id, $urls[0], $case === 'unpaid' ? 'pending' : 'completed');
    $context = $captured;
    if ($case === 'denied') { $context['consentState'] = 'denied'; }
    if ($case === 'expired') { $context['capturedAt'] = time() - 8 * DAY_IN_SECONDS; }
    if ($case === 'other-account') { $context['accountId'] = 'different-account'; }
    if ($case !== 'missing') { $order->update_meta_data('_overseek_purchase_context', $context); }
    $before = count(OverSeek_Tracking_Transport::$sent);
    $callback->track_paid_purchase($id);
    check(count(OverSeek_Tracking_Transport::$sent) === $before, $case . ' cannot create a background purchase');
}
$_SERVER = ['HTTP_USER_AGENT' => 'Mozilla/5.0 Shopper'];
$require_consent = true;
$order = $orders[600] = new Purchase_Order(600, $urls[0], 'pending');
$order->update_meta_data('_overseek_purchase_context', $captured);
$tracker->capture_purchase_context($order);
check($order->get_meta('_overseek_purchase_context') === '', 'Observed browser consent denial removes saved context');
$require_consent = false;
$context = $captured;
$context['capturedAt'] = time() - 8 * DAY_IN_SECONDS;
$order->update_meta_data('_overseek_purchase_context', $context);
$tracker->expire_purchase_context(600, $captured['capturedAt']);
check(is_array($order->get_meta('_overseek_purchase_context')), 'Old cleanup cannot delete newer context');
$tracker->expire_purchase_context(600, $context['capturedAt']);
check($order->get_meta('_overseek_purchase_context') === '', 'Abandoned context expires');
echo "Delayed classic/Blocks payments preserve attribution, consent, payment time and deduplication.\n";

$options = ['overseek_api_url' => 'https://overseek.test', 'overseek_account_id' => 'account-original'];
$hook_tracker = new OverSeek_Server_Tracking();
(new ReflectionProperty($hook_tracker, 'visitor_id'))->setValue($hook_tracker, 'original-visitor');
foreach (['woocommerce_checkout_order_created', 'woocommerce_store_api_checkout_order_processed', 'woocommerce_payment_complete', 'woocommerce_order_status_changed', 'overseek_expire_purchase_context'] as $hook) {
    check(count($actions[$hook] ?? []) === 1, $hook . ' is registered');
}
$order = $orders[700] = new Purchase_Order(700, $urls[0], 'pending');
$actions['woocommerce_checkout_order_created'][0]($order);
$before = count(OverSeek_Tracking_Transport::$sent);
$actions['woocommerce_order_status_changed'][0](700);
check(count(OverSeek_Tracking_Transport::$sent) === $before, 'Pending status hook does not emit');
$order->status = 'processing';
OverSeek_Tracking_Transport::$acknowledge = false;
$actions['woocommerce_payment_complete'][0](700);
check(!$order->get_meta('_overseek_tracked') && is_array($order->get_meta('_overseek_purchase_context')), 'Failed acknowledgement retains context for retry');
$first = OverSeek_Tracking_Transport::$sent[$before];
OverSeek_Tracking_Transport::$acknowledge = true;
$actions['woocommerce_order_status_changed'][0](700);
$second = OverSeek_Tracking_Transport::$sent[$before + 1];
check($first === $second, 'Payment/status retry preserves the complete event and original occurrence time');
check($order->get_meta('_overseek_tracked'), 'Later acknowledgement marks purchase tracked');
echo "Real hook registration and failed-acknowledgement replay passed.\n";

<?php
/** Purchase links must describe the customer page, never the processing request. */
declare(strict_types=1);
define('ABSPATH', __DIR__);

function get_option($key, $default = false) { return $default; }
function apply_filters($hook, $value) { return $value; }
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
    public static function resolve_visitor_ip() { return '192.0.2.1'; }
    public static function get_referrer_data() { return ['referrer' => '', 'referrerDomain' => '', 'referrerType' => 'direct']; }
    public static function get_logged_in_user_data() { return []; }
}
class OverSeek_Tracking_Attribution_Utils {
    public static function get_utm_parameters() { return []; }
    public static function get_click_data($params) { return []; }
    public static function get_landing_referrer() { return ''; }
}
class OverSeek_Pixel_Config_Provider {
    public static function get_config(...$args) { return []; }
}
class OverSeek_Tracking_Event_Builder {
    public static function ensure_order_event_id($order) { return 'purchase-' . $order->get_id(); }
    public static function build_purchase_payload($order, $id, $event_id, $config) { return ['orderId' => $id, 'eventId' => $event_id]; }
    public static function build_cart_view_payload(...$args) { return []; }
    public static function build_checkout_view_payload(...$args) { return []; }
}
class OverSeek_Tracking_Transport {
    public static array $sent = [];
    public static function flush_events($url, $events) {
        self::$sent = array_merge(self::$sent, $events);
        return array_fill_keys(array_column(array_column($events, 'payload'), 'eventId'), true);
    }
}
class Purchase_Order {
    private array $meta = [];
    public function __construct(private int $id, private string $url, public string $status = 'processing') {}
    public function get_id() { return $this->id; }
    public function is_paid() { return in_array($this->status, ['processing', 'completed'], true); }
    public function get_checkout_order_received_url() { return $this->url; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
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

<?php
/** Purchase pixels require a paid order, not merely an order-received URL. */
declare(strict_types=1);
define('ABSPATH', __DIR__);

function absint($value) { return abs((int) $value); }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? false; }
function sanitize_text_field($value) { return strip_tags($value); }
function wp_unslash($value) { return $value; }
function wp_json_encode($value) { return json_encode($value); }
function get_current_user_id() { return 0; }

class Pixel_Purchase_Order {
    public string $status = 'failed';
    public function is_paid() { return in_array($this->status, ['processing', 'completed'], true); }
    public function get_order_key() { return 'wc_test'; }
    public function get_total() { return '40.90'; }
    public function get_currency() { return 'AUD'; }
    public function get_meta($key) { return 'purchase-test'; }
    public function get_items() { return []; }
}

require_once __DIR__ . '/../includes/class-overseek-pixel-ecommerce-events.php';
function check($value, $message) { if (!$value) { throw new RuntimeException($message); } }

$wp = (object) ['query_vars' => ['order-received' => 101]];
$_GET['key'] = 'wc_test';
$order = $orders[101] = new Pixel_Purchase_Order();
$config = ['ga4' => ['measurementId' => 'G-TEST']];
foreach (['failed', 'pending', 'on-hold', 'cancelled', 'refunded', 'checkout-draft'] as $status) {
    $order->status = $status;
    check(OverSeek_Pixel_Ecommerce_Events::build_purchase_events($config) === '', $status . ' must not emit purchase pixels');
}
foreach (['processing', 'completed'] as $status) {
    $order->status = $status;
    $js = OverSeek_Pixel_Ecommerce_Events::build_purchase_events($config);
    check(strpos($js, "gtag('event','purchase',") !== false, $status . ' must emit purchase pixels');
    check(strpos($js, '40.9') !== false, 'Paid purchase retains order value');
}
$_GET['key'] = 'wrong-key';
check(OverSeek_Pixel_Ecommerce_Events::build_purchase_events($config) === '', 'Paid order still requires permission');
echo "Purchase pixels require paid orders and retain order access checks.\n";

<?php
/** Standalone admin option observation/discovery; no lifecycle dependencies. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
$admin = false; $transients = []; $assertions = 0;
function check($expected, $actual, string $message): void { ++$GLOBALS['assertions']; if ($expected !== $actual) throw new RuntimeException($message); }
function current_user_can($cap): bool { return $GLOBALS['admin'] && $cap === 'manage_woocommerce'; }
function get_option($key, $default = false) { return $key === 'overseek_account_id' ? 'test-account' : $default; }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient($key, $value, $ttl): void { check(86400, $ttl, '24h expiry'); $GLOBALS['transients'][$key] = $value; }
function sanitize_text_field($value) { return strip_tags($value); }
function wp_timezone_string(): string { return 'Australia/Sydney'; }
class WP_REST_Response {
    public array $headers = [];
    public function __construct(public array $data, public int $status = 200) {}
    public function header($name, $value): void { $this->headers[$name] = $value; }
}
class WP_Error { public function __construct(public string $code, public string $message, public array $data) {} }
class WC_Shipping_Rate {
    public function __construct(private string $id, private string $method, private int $instance, private string $label) {}
    public function get_id() { return $this->id; }
    public function get_method_id() { return $this->method; }
    public function get_instance_id() { return $this->instance; }
    public function get_label() { return $this->label; }
}
class WC_Shipping_Zones { public static function get_zones() { return [['zone_id' => 1]]; } }
class WC_Shipping_Zone {
    public function __construct(private int $id) {}
    public function get_id() { return $this->id; }
    public function get_zone_name() { return 'Test zone'; }
    public function get_shipping_methods($enabled) { return $this->id ? [new GlobalWbs(7)] : []; }
}
class GlobalWbs {
    public string $id = 'wbs'; public string $enabled = 'yes';
    public function __construct(public int $instance_id = 0) {}
    public function get_instance_id() { return $this->instance_id ?: -1; }
    public function get_title() { return 'WBS'; }
    public function calculate_shipping() { throw new RuntimeException('Discovery must not calculate rates'); }
}
class GlobalWbsng extends GlobalWbs { public string $id = 'wbsng'; }
class_alias(GlobalWbs::class, 'Wbs\\ShippingMethod');
class_alias(GlobalWbsng::class, 'Aikinomi\\Wbsng\\ShippingMethod');
require __DIR__ . '/../includes/class-overseek-delivery-discovery-api.php';
$rates = [new WC_Shipping_Rate('wbs:hash_standard', 'wbs', 0, 'Standard'), new WC_Shipping_Rate('wbsng:opaque/express?x=1', 'wbsng', 0, str_repeat('🚚', 101))];
$before = serialize($rates);
check($rates, OverSeek_Delivery_Discovery_API::capture_admin_rates($rates), 'normal customer rates unchanged');
check([], $transients, 'ordinary shopper triggers no capture');
$admin = true;
check($rates, OverSeek_Delivery_Discovery_API::capture_admin_rates($rates), 'admin rates unchanged');
check($before, serialize($rates), 'no provider mutation');
$data = (new OverSeek_Delivery_Discovery_API())->get_shipping_methods();
check(200, $data->status, 'discovery success');
check('private, no-store', $data->headers['Cache-Control'], 'private observation response');
check([0, 0, 7], array_column($data->data['methods'], 'instanceId'), 'global minus one normalized from vendor property only');
check(['weight_based', 'weight_based', 'weight_based'], array_column($data->data['methods'], 'provider'), 'both providers classified');
check('wbs:hash_standard', $data->data['methods'][0]['observedRates'][0]['rateId'], 'actual legacy ID exposed');
check(str_repeat('🚚', 100), $data->data['methods'][1]['observedRates'][0]['title'], 'unicode bounded without broken bytes');
check([], $data->data['methods'][2]['observedRates'], 'different instance cannot inherit observations');
check(['rateId', 'title', 'capturedAt'], array_keys($data->data['methods'][0]['observedRates'][0]), 'only allowlisted fields');
$saved = $transients;
OverSeek_Delivery_Discovery_API::capture_admin_rates(array_fill(0, 101, $rates[0]));
check($saved, $transients, 'overbound rates skipped');
fwrite(STDOUT, "Option discovery: {$assertions} assertions passed.\n");

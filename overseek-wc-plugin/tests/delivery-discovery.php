<?php
/**
 * Dependency-free discovery regression tests.
 * Run: php overseek-wc-plugin/tests/delivery-discovery.php
 * @package OverSeek
 */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('OVERSEEK_WC_VERSION', 'test-version');
set_error_handler(static function (int $severity, string $message, string $file, int $line): void {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
$GLOBALS['caps'] = [];
$GLOBALS['linked'] = 'account-123';
$GLOBALS['routes'] = [];
function current_user_can(string $cap): bool { return in_array($cap, $GLOBALS['caps'], true); }
function rest_authorization_required_code(): int { return $GLOBALS['caps'] ? 403 : 401; }
function get_option(string $key, $default = false) { return $key === 'overseek_account_id' ? $GLOBALS['linked'] : $default; }
function get_transient(string $key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient(string $key, $value, int $ttl) { $GLOBALS['transients'][$key] = $value; same($ttl, 86400); }
function sanitize_text_field(string $value): string { return strip_tags($value); }
function wp_timezone_string(): string { return 'Australia/Sydney'; }
function register_rest_route(string $namespace, string $route, array $args): void { $GLOBALS['routes'][$namespace . $route] = $args; }
class WP_REST_Request {
    public function __construct(private array $query = [], private array $headers = []) {}
    public function get_query_params(): array { return $this->query; }
    public function get_header(string $key): ?string { return $this->headers[strtolower($key)] ?? null; }
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
    public function header(string $name, string $value): void { same($name, 'Cache-Control'); same($value, 'private, no-store'); }
}
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data) {}
}
function same($actual, $expected): void {
    if ($actual !== $expected) { throw new RuntimeException('Expected ' . json_encode($expected) . ', got ' . json_encode($actual)); }
}
function error_is($result, string $code, int $status): void {
    same($result instanceof WP_Error, true);
    same($result->code, $code);
    same($result->data['status'], $status);
}
require_once __DIR__ . '/../includes/class-overseek-api.php';
require_once __DIR__ . '/../includes/class-overseek-main.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-discovery-api.php';
$api = new OverSeek_Delivery_Discovery_API();
$api->register_routes();
same(count($GLOBALS['routes']), 2);
foreach ($GLOBALS['routes'] as $route) {
    same($route['methods'], 'GET');
    same(is_callable($route['callback']), true);
    $permission = $route['permission_callback'];
    error_is($permission(new WP_REST_Request(['accountId' => 'account-123'])), 'overseek_delivery_forbidden', 401);
    $GLOBALS['caps'] = ['read'];
    error_is($permission(new WP_REST_Request(['accountId' => 'account-123'])), 'overseek_delivery_forbidden', 403);
    foreach (['manage_woocommerce', 'manage_options'] as $cap) {
        $GLOBALS['caps'] = [$cap];
        same($permission(new WP_REST_Request(['accountId' => 'account-123'])), true);
        same($permission(new WP_REST_Request([], ['x-overseek-account-id' => 'account-123'])), true);
        same($permission(new WP_REST_Request([], ['accountid' => 'account-123'])), true);
        same($permission(new WP_REST_Request(['account_id' => 'account-123'])), true);
        error_is($permission(new WP_REST_Request()), 'overseek_delivery_account_required', 400);
        foreach (['', ' account-123', ['account-123'], 123, null, "account-123\n", str_repeat('a', 192)] as $bad) {
            error_is($permission(new WP_REST_Request(['accountId' => $bad])), 'overseek_delivery_account_invalid', 400);
        }
        error_is($permission(new WP_REST_Request([], ['x-overseek-account-id' => ''])), 'overseek_delivery_account_invalid', 400);
        error_is($permission(new WP_REST_Request(['accountId' => 'other'])), 'overseek_delivery_account_mismatch', 403);
        error_is($permission(new WP_REST_Request(['accountId' => 'other'], ['x-overseek-account-id' => 'account-123'])), 'overseek_delivery_account_mismatch', 403);
        error_is($permission(new WP_REST_Request(['accountId' => 'account-123', 'account_id' => 'other'])), 'overseek_delivery_account_mismatch', 403);
        $GLOBALS['linked'] = '';
        error_is($permission(new WP_REST_Request(['accountId' => 'account-123'])), 'overseek_delivery_account_unlinked', 403);
        $GLOBALS['linked'] = 'account-123';
    }
    $GLOBALS['caps'] = [];
}
same($api->get_capabilities()->data, [
    'schemaVersion' => 1,
    'capabilities' => ['shippingMethods' => true, 'calculationEngine' => true, 'configurationSync' => true, 'inboundInputs' => true, 'guardedReceipts' => true, 'receiptFinalization' => true, 'inboundReceiptSafety' => true, 'storefront' => true],
    'pluginVersion' => 'test-version',
]);
error_is($api->get_shipping_methods(), 'overseek_delivery_woocommerce_unavailable', 503);

// Conditional declarations ensure the missing-Woo test above runs before stubs exist.
if (!class_exists('WC_Shipping_Zones')) {
    class WC_Shipping_Zones {
        public static function get_zones(): array { return [['zone_id' => 8], ['zone_id' => 19]]; }
    }
    class WC_Shipping_Zone {
        public function __construct(private int $id) {}
        public function get_id(): int { return $this->id; }
        public function get_zone_name(): string { return $this->id === 0 ? 'Rest of the world' : 'Zone ' . $this->id; }
        public function get_shipping_methods(bool $enabled_only = false): array {
            same($enabled_only, false);
            if (!empty($GLOBALS['vendor_failure'])) { throw new RuntimeException('SECRET vendor credentials'); }
            return $GLOBALS['methods'][$this->id];
        }
    }
}
class Discovery_Method {
    public array $settings = ['cost' => 99, 'api_key' => 'SECRET', 'rules' => ['private']];
    public function __construct(public string $id, private int $instance_id, public string $enabled = 'yes') {}
    public function get_instance_id(): int { return $this->instance_id; }
    public function get_title(): string { return 'Same title'; }
    public function calculate_shipping(): void { throw new RuntimeException('Rate calculation must not run'); }
    public function get_option(string $key) { throw new RuntimeException('Method options must not be read'); }
}
class WC_Shipping_Flat_Rate extends Discovery_Method {}
class Vendor_Weight_Based extends Discovery_Method {}
class Wbs_Shipping_Method extends Discovery_Method {}
$GLOBALS['methods'] = [
    0 => [new WC_Shipping_Flat_Rate('flat_rate', 2, 'no')],
    8 => [new WC_Shipping_Flat_Rate('flat_rate', 41), new Vendor_Weight_Based('vendor', 42)],
    19 => [new Discovery_Method('custom', 61), new Wbs_Shipping_Method('wbs', 62), new Discovery_Method('weight_based_shipping', 63)],
];
$response = $api->get_shipping_methods();
same($response->status, 200);
same(array_keys($response->data), ['schemaVersion', 'timezone', 'methods', 'warnings']);
same($response->data['schemaVersion'], 1);
same($response->data['timezone'], 'Australia/Sydney');
$methods = $response->data['methods'];
same(count($methods), 6);
same(array_column($methods, 'instanceId'), [2, 41, 42, 61, 62, 63]);
same(array_column($methods, 'zoneId'), [0, 8, 8, 19, 19, 19]);
same(array_column($methods, 'provider'), ['woocommerce', 'woocommerce', 'weight_based', 'unknown', 'weight_based', 'weight_based']);
same(array_column($methods, 'requiresRateVerification'), [false, false, true, true, true, true]);
same($methods[0], [
    'methodId' => 'flat_rate', 'instanceId' => 2, 'zoneId' => 0, 'zoneName' => 'Rest of the world',
    'title' => 'Same title', 'enabled' => false, 'provider' => 'woocommerce',
    'rateIdentityScope' => 'method_instance', 'requiresRateVerification' => false,
    'observedRates' => [],
]);
foreach ($methods as $method) { same(array_keys($method), array_keys($methods[0])); }
same(count($response->data['warnings']), 4);
same(str_contains(json_encode($response->data), 'SECRET'), false);
same(str_contains(json_encode($response->data), 'cost'), false);
$GLOBALS['vendor_failure'] = true;
error_is($api->get_shipping_methods(), 'overseek_delivery_discovery_failed', 503);
same(str_contains(json_encode($api->get_shipping_methods()), 'SECRET'), false);
$GLOBALS['vendor_failure'] = false;
$GLOBALS['methods'] = [0 => [], 8 => [], 19 => []];
same($api->get_shipping_methods()->data['methods'], []);

// Existing Woo auth routing covers both endpoints, including plain permalinks.
$main = (new ReflectionClass(OverSeek_Main::class))->newInstanceWithoutConstructor();
class WP { public array $query_vars = []; }
$GLOBALS['wp'] = new WP();
foreach (['capabilities', 'shipping-methods'] as $path) {
    $GLOBALS['wp']->query_vars['rest_route'] = '/overseek/v1/delivery-estimates/' . $path;
    same($main->include_overseek_routes_in_wc_rest_authentication(false), true);
}
echo "Delivery discovery: all checks passed.\n";

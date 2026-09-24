<?php
/**
 * Dependency-free storage protocol regression harness.
 * Run: php overseek-wc-plugin/tests/delivery-inputs.php
 * SQL stubs verify predicates and modeled interleavings, NOT real DB concurrency.
 * @package OverSeek
 */
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/stubs/');
define('ARRAY_A', 'ARRAY_A');
define('OVERSEEK_WC_VERSION', 'test');
set_error_handler(static function (int $severity, string $message, string $file, int $line): void {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
$GLOBALS['linked'] = 'account-A';
$GLOBALS['caps'] = ['manage_woocommerce'];
$GLOBALS['routes'] = [];
$checks = 0;
function same($actual, $expected): void {
    $GLOBALS['checks']++;
    if ($actual !== $expected) { throw new RuntimeException('Expected ' . json_encode($expected) . ', got ' . json_encode($actual)); }
}
function status($value, int $status): void {
    same($value instanceof WP_Error, true);
    if (in_array($value->code, ['overseek_delivery_input_invalid', 'overseek_delivery_input_too_large'], true)) {
        same(array_keys($value->data), ['status', 'reason']);
        same(in_array($value->data['reason'], ['schema_invalid', 'inbound_expired', 'inbound_generated_in_future', 'inbound_ttl_invalid', 'product_missing', 'product_type_unsupported', 'variation_missing', 'variation_parent_mismatch', 'stock_owner_mismatch', 'owner_pool_batches_mismatch', 'production_range_invalid', 'supplier_lead_invalid', 'payload_limits_exceeded'], true), true);
        same($value->message, $value->code === 'overseek_delivery_input_too_large' ? 'Delivery input exceeds the size limit.' : 'Invalid delivery input.');
        same($value->data['status'], $status);
    } else { same($value->data, ['status' => $status]); }
    same(str_contains(json_encode($value), 'SECRET'), false);
}
function current_user_can(string $cap): bool { return in_array($cap, $GLOBALS['caps'], true); }
function rest_authorization_required_code(): int { return $GLOBALS['caps'] ? 403 : 401; }
function get_option(string $key, $default = false) {
    same($key, 'overseek_account_id');
    return $GLOBALS['linked'];
}
function register_rest_route(string $namespace, string $path, array $args): void { $GLOBALS['routes'][$namespace . $path] = $args; }
function update_option(...$args): void { throw new RuntimeException('Global option write'); }
function add_option(...$args): void { throw new RuntimeException('Global option write'); }
function update_post_meta(...$args): void { throw new RuntimeException('Product meta write'); }
function wp_remote_post(...$args): void { throw new RuntimeException('Remote call'); }
function wp_remote_get(...$args): void { throw new RuntimeException('Remote call'); }
function wp_remote_request(...$args): void { throw new RuntimeException('Remote call'); }
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data) {}
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
}
class WP_REST_Request {
    public function __construct(private string $body = '', private array $headers = ['x-overseek-account-id' => 'account-A'], private array $query = []) {}
    public function get_body(): string { return $this->body; }
    public function get_header(string $key): ?string { return $this->headers[strtolower($key)] ?? null; }
    public function get_query_params(): array { return $this->query; }
}
class WC_Product {
    public function __construct(private int $id, private string $type = 'simple', private string $status = 'publish') {}
    public function get_id(): int { return $this->id; }
    public function is_type($type): bool { return in_array($this->type, (array) $type, true); }
    public function get_status(): string { return $this->status; }
    public function get_stock_managed_by_id(): int { return $this->id; }
    public function save(): void { throw new RuntimeException('Woo save'); }
    public function set_stock_quantity($value): void { throw new RuntimeException('Stock write'); }
}
class WC_Product_Variation extends WC_Product {
    public function __construct(int $id, private int $parent) { parent::__construct($id, 'variation'); }
    public function get_parent_id(): int { return $this->parent; }
}
$GLOBALS['products'] = [10 => new WC_Product(10, 'variable'), 11 => new WC_Product_Variation(11, 10), 12 => new WC_Product_Variation(12, 20), 20 => new WC_Product(20), 21 => new WC_Product(21, 'custom'), 22 => new WC_Product(22, 'simple', 'trash')];
function wc_get_product(int $id) { $GLOBALS['product_lookups'][] = $id; return $GLOBALS['products'][$id] ?? false; }

/** Fail on unknown SQL, ensuring every data operation is scoped and bounded. */
class Input_DB {
    public string $prefix = 'wp_';
    public bool $installed = false;
    public int $installs = 0;
    public array $rows = [];
    public array $queries = [];
    public $before_insert = null;
    public $before_update = null;
    public string $fail = '';
    public string $engine = 'InnoDB';
    private array $prepared = [];
    private ?array $snapshot = null;
    private bool $suppressed = false;
    public function suppress_errors(bool $value): bool { $old = $this->suppressed; $this->suppressed = $value; return $old; }
    public function esc_like(string $value): string { return addcslashes($value, '_%\\'); }
    public function get_charset_collate(): string { return 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'; }
    public function prepare(string $sql, ...$args): string {
        $id = 'prepared-' . count($this->prepared);
        $this->prepared[$id] = [$sql, $args];
        return $id;
    }
    private function unpack(string $id): array {
        [$sql, $args] = $this->prepared[$id] ?? [$id, []];
        $this->queries[] = $sql;
        return [$sql, $args];
    }
    public function get_var(string $id) {
        [$sql, $args] = $this->unpack($id);
        if (str_starts_with($sql, 'SHOW TABLES LIKE')) { return $this->installed ? 'wp_overseek_delivery_inputs' : null; }
        same($sql, 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s');
        same($args, ['wp_overseek_delivery_inputs']);
        return $this->engine;
    }
    public function get_row(string $id, string $output) {
        [$sql, $args] = $this->unpack($id);
        same($output, ARRAY_A);
        same((bool) preg_match('/^SELECT revision, (payload_hash|payload) FROM wp_overseek_delivery_inputs WHERE account_id = %s AND scope = %s AND entity_id = %d( FOR UPDATE)?$/', $sql), true);
        if (str_ends_with($sql, 'FOR UPDATE')) { same($this->snapshot !== null, true); }
        return $this->rows[implode('|', $args)] ?? null;
    }
    public function query(string $id) {
        [$sql, $args] = $this->unpack($id);
        if ($this->fail !== '' && str_starts_with($sql, $this->fail)) { return false; }
        if ($sql === 'START TRANSACTION') { same($this->snapshot, null); $this->snapshot = $this->rows; return 0; }
        if ($sql === 'COMMIT') { same($this->snapshot !== null, true); $this->snapshot = null; return 0; }
        if ($sql === 'ROLLBACK') { $this->rows = $this->snapshot; $this->snapshot = null; return 0; }
        same($this->snapshot !== null, true);
        if (str_starts_with($sql, 'INSERT INTO')) {
            same($sql, "INSERT INTO wp_overseek_delivery_inputs (account_id, scope, entity_id, revision, payload_hash, payload) VALUES (%s, %s, %d, 0, '', '') ON DUPLICATE KEY UPDATE entity_id = entity_id");
            if ($this->before_insert) {
                ($this->before_insert)($this);
                $this->before_insert = null;
                // Model a competitor committed before this transaction acquires its key lock.
                $this->snapshot = $this->rows;
            }
            $key = implode('|', $args);
            $this->rows[$key] ??= ['revision' => 0, 'payload_hash' => '', 'payload' => ''];
            return 1;
        }
        same($sql, 'UPDATE wp_overseek_delivery_inputs SET payload = %s, payload_hash = %s, revision = %d WHERE account_id = %s AND scope = %s AND entity_id = %d AND revision < %d');
        [$payload, $hash, $revision, $account, $scope, $entity, $guard] = $args;
        same($guard, $revision);
        $key = "$account|$scope|$entity";
        if ($this->before_update) { ($this->before_update)($this, $key); $this->before_update = null; }
        if ($this->rows[$key]['revision'] >= $guard) { return 0; }
        $this->rows[$key] = ['revision' => $revision, 'payload_hash' => $hash, 'payload' => $payload];
        return 1;
    }
}
$GLOBALS['wpdb'] = new Input_DB();
require_once __DIR__ . '/../includes/class-overseek-api.php';
require_once __DIR__ . '/../includes/class-overseek-main.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-discovery-api.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-input-validation.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-input-storage.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-input-api.php';
$api = new OverSeek_Delivery_Input_API();
$storage = new OverSeek_Delivery_Input_Storage();
$api->register_routes();
same(count($GLOBALS['routes']), 1);
$route = $GLOBALS['routes']['overseek/v1/delivery-estimates/inputs'];
same($route['methods'], 'POST');
same(is_callable($route['callback']), true);
same(is_callable($route['permission_callback']), true);
same($route['permission_callback'](new WP_REST_Request()), true);
$GLOBALS['caps'] = ['manage_options'];
same($route['permission_callback'](new WP_REST_Request()), true);
$GLOBALS['caps'] = ['manage_woocommerce'];
same($storage->read_settings(), null);
same($storage->read_product(10), null);
same($GLOBALS['wpdb']->installs, 0);
same($GLOBALS['wpdb']->installed, false);

$settings = [
    'cutoffTime' => '14:00', 'timezone' => 'Australia/Sydney', 'fallbackSupplierLeadTimeDays' => 30,
    'productionWeekdays' => [1, 2, 3, 4, 5], 'transitWeekdays' => [1, 2, 3, 4, 5],
    'closures' => [['date' => '2028-02-29', 'scope' => 'both', 'label' => 'Holiday']],
    'shippingMethods' => [['methodId' => 'flat_rate', 'instanceId' => 1, 'zoneId' => 0, 'zoneName' => '', 'title' => 'Standard', 'enabled' => true, 'minTransitDays' => 0, 'maxTransitDays' => 3650, 'fulfilmentType' => 'delivery']],
    'defaultMethod' => ['methodId' => 'flat_rate', 'instanceId' => 1],
    'branding' => ['textColor' => '#ff0011', 'accentColor' => null, 'backgroundColor' => null, 'fontSize' => 14, 'spacing' => 'compact', 'showIcon' => false],
];
$input = ['schemaVersion' => 1, 'scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'payload' => ['enabled' => true, 'settings' => $settings]];
$validator = new OverSeek_Delivery_Input_Validation();
$legacy_payload = $validator->validate(json_encode($input))['payload'];
foreach (['production', 'inventory'] as $mode) {
    $with_mode = $input; $with_mode['payload']['settings']['estimateMode'] = $mode;
    $validated = $validator->validate(json_encode($with_mode))['payload'];
    same($validated->settings->estimateMode, $mode);
    unset($validated->settings->estimateMode);
    same(json_encode($validated), json_encode($legacy_payload));
}
function send(array $value, array $headers = ['x-overseek-account-id' => 'account-A'], array $query = []) {
    return $GLOBALS['api']->ingest(new WP_REST_Request(json_encode($value, JSON_THROW_ON_ERROR), $headers, $query));
}
function invalid(array $value): void {
    $before = $GLOBALS['wpdb']->rows;
    $queries = count($GLOBALS['wpdb']->queries);
    status(send($value), 400);
    same($GLOBALS['wpdb']->rows, $before);
    same(count($GLOBALS['wpdb']->queries), $queries);
}

// Permission checks precede parsing, installation and writes, including direct callbacks.
$GLOBALS['caps'] = [];
status(send($input), 401);
$GLOBALS['caps'] = ['read'];
status(send($input), 403);
$GLOBALS['caps'] = ['manage_woocommerce'];
status(send($input, [], ['accountId' => 'account-A']), 400);
status(send($input, ['accountid' => 'account-A']), 400);
status(send($input, ['x-overseek-account-id' => '']), 400);
status(send($input, ['x-overseek-account-id' => 'account-B']), 403);
status(send($input, ['x-overseek-account-id' => 'account-A'], ['account_id' => 'account-B']), 403);
$GLOBALS['linked'] = '';
status(send($input), 403);
$GLOBALS['linked'] = 'account-A';
same($GLOBALS['wpdb']->installs, 0);
$oversized = $api->ingest(new WP_REST_Request(str_repeat(' ', 512 * 1024 + 1)));
status($oversized, 413);
same($oversized->code, 'overseek_delivery_input_too_large');
same($oversized->data['reason'], 'payload_limits_exceeded');
foreach (['{', '[]', '{}', 'null', '{"schemaVersion":1,"payload":NaN}'] as $json) { status($api->ingest(new WP_REST_Request($json)), 400); }

foreach ([['schemaVersion', 2], ['scope', 'inbound'], ['entityId', 1], ['revision', 0], ['revision', -1], ['revision', 1.2], ['revision', '1'], ['revision', true], ['revision', 9007199254740992], ['extra', 'SECRET']] as [$key, $value]) {
    $bad = $input; $bad[$key] = $value; invalid($bad);
}
foreach (array_keys($input) as $key) { $bad = $input; unset($bad[$key]); invalid($bad); }
$bad = $input; $bad['payload']['enabled'] = 1; invalid($bad);
$bad = $input; $bad['payload']['settings'] = []; invalid($bad);
foreach (array_keys($settings) as $key) { $bad = $input; unset($bad['payload']['settings'][$key]); invalid($bad); }
foreach ([
    ['cutoffTime', '24:00'], ['cutoffTime', '14:60'], ['cutoffTime', '1:00'],
    ['estimateMode', 'unknown'], ['estimateMode', null], ['estimateMode', true],
    ['timezone', '+10:00'], ['timezone', 'Invalid/Zone'], ['timezone', ''], ['timezone', 'Factory'],
    ['fallbackSupplierLeadTimeDays', 3651], ['fallbackSupplierLeadTimeDays', null],
    ['productionWeekdays', []], ['productionWeekdays', [1, 1]], ['transitWeekdays', [7]], ['transitWeekdays', ['1']],
    ['closures', (object) []], ['closures', array_fill(0, 3661, ['date' => '2026-01-01', 'scope' => 'work'])],
    ['closures', [['date' => '2026-02-29', 'scope' => 'work']]], ['closures', [['date' => '2026-04-31', 'scope' => 'work']]],
    ['closures', [['date' => '2026-1-01', 'scope' => 'work']]], ['closures', [['date' => '2026-01-01', 'scope' => 'all']]],
    ['closures', [['date' => '2026-01-01', 'scope' => 'work', 'label' => str_repeat('a', 101)]]],
    ['closures', [['date' => '2026-01-01', 'scope' => 'work', 'extra' => true]]],
    ['shippingMethods', array_fill(0, 501, $settings['shippingMethods'][0])],
    ['shippingMethods', [$settings['shippingMethods'][0], $settings['shippingMethods'][0]]],
    ['defaultMethod', ['methodId' => 'flat_rate', 'instanceId' => 9]], ['defaultMethod', ['methodId' => 'flat_rate', 'instanceId' => 1, 'title' => 'Extra']],
    ['unknown', 'SECRET'],
] as [$key, $value]) { $bad = $input; $bad['payload']['settings'][$key] = $value; invalid($bad); }
foreach ([['methodId', 'flat:rate'], ['methodId', ''], ['instanceId', -1], ['instanceId', 2147483648], ['zoneId', 2147483648], ['title', ''], ['title', str_repeat('😀', 101)], ['zoneName', str_repeat('a', 201)], ['enabled', 1], ['enabled', false], ['minTransitDays', 3651], ['maxTransitDays', -1], ['fulfilmentType', 'shipping'], ['provider', 'SECRET']] as [$key, $value]) {
    $bad = $input; $bad['payload']['settings']['shippingMethods'][0][$key] = $value; invalid($bad);
}
foreach ([['textColor', '#fff'], ['accentColor', 'red'], ['backgroundColor', '#12345Z'], ['fontSize', 11], ['fontSize', 21], ['spacing', 'large'], ['showIcon', 1], ['extra', 'SECRET']] as [$key, $value]) {
    $bad = $input; $bad['payload']['settings']['branding'][$key] = $value; invalid($bad);
}
same($GLOBALS['wpdb']->installs, 0);

// Exact ack, canonical object key ordering, integer spelling and persisted false enablement.
$ack = send($input);
same($ack->status, 200);
same($ack->data, ['schemaVersion' => 1, 'scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'storedRevision' => 1, 'applied' => true, 'storefrontActivated' => false]);
same($GLOBALS['wpdb']->installs, 1);
$replay = $input;
$replay['payload'] = array_reverse($replay['payload'], true);
$replay['payload']['settings'] = array_reverse($settings, true);
same(send($replay)->data['applied'], false);
$float_json = str_replace('"fallbackSupplierLeadTimeDays":30', '"fallbackSupplierLeadTimeDays":30.0', json_encode($input));
same($api->ingest(new WP_REST_Request($float_json))->data['applied'], false);
$float_json = str_replace('"schemaVersion":1', '"schemaVersion":1.0', json_encode($input));
same($api->ingest(new WP_REST_Request($float_json))->data['applied'], false);
$padded = str_pad(json_encode($input), 512 * 1024, ' ');
same($api->ingest(new WP_REST_Request($padded))->data['applied'], false);
$changed = $input; $changed['payload']['enabled'] = false;
status(send($changed), 409);
$changed['revision'] = 3;
same(send($changed)->data['applied'], true);
status(send($input), 409);
same($storage->read_settings()['payload']['enabled'], false);
same($storage->read_settings()['revision'], 3);
same($GLOBALS['wpdb']->installs, 1);

// Maximum legal collections and bounds are accepted; disabled defaults are not.
$max = $input; $max['revision'] = 4;
$max['payload']['settings']['closures'] = array_fill(0, 3660, ['date' => '0000-01-01', 'scope' => 'transit']);
$max['payload']['settings']['productionWeekdays'] = [0, 1, 2, 3, 4, 5, 6];
$max['payload']['settings']['shippingMethods'] = [];
for ($i = 0; $i < 500; $i++) {
    $method = $settings['shippingMethods'][0]; $method['instanceId'] = $i;
    $max['payload']['settings']['shippingMethods'][] = $method;
}
same(send($max)->data['applied'], true);

$product = ['schemaVersion' => 1, 'scope' => 'product', 'entityId' => 10, 'revision' => 1, 'payload' => ['wooId' => 10, 'productionMinDays' => null, 'productionMaxDays' => null, 'variations' => [['wooId' => 11, 'productionMinDays' => 0, 'productionMaxDays' => 3650]]]];
foreach ([999, 11, 21, 22] as $id) { $bad = $product; $bad['entityId'] = $id; $bad['payload']['wooId'] = $id; $bad['payload']['variations'] = []; $bad['payload']['productionMinDays'] = 0; $bad['payload']['productionMaxDays'] = 0; invalid($bad); }
// Real validator + authenticated API + revision storage: deletion clears require no lookup.
$GLOBALS['products'][23] = new WC_Product(23);
foreach ([999, 22, 23] as $id) {
    $clear = ['schemaVersion' => 1, 'scope' => 'product', 'entityId' => $id, 'revision' => 1,
        'payload' => ['wooId' => $id, 'productionMinDays' => null, 'productionMaxDays' => null, 'variations' => []]];
    $GLOBALS['product_lookups'] = [];
    status(send($clear, ['x-overseek-account-id' => 'account-B']), 403);
    $GLOBALS['caps'] = []; status(send($clear), 401); $GLOBALS['caps'] = ['manage_woocommerce'];
    same(send($clear)->data['storedRevision'], 1);
    same(send($clear)->data['applied'], false);
    same($GLOBALS['product_lookups'], []);
    $clear['revision'] = 2; same(send($clear)->data['applied'], true);
    $clear['revision'] = 1; status(send($clear), 409);
    $clear['payload']['variations'] = [['wooId' => 11, 'productionMinDays' => null, 'productionMaxDays' => null]];
    invalid($clear);
}
foreach ([12, 999, 20] as $id) { $bad = $product; $bad['payload']['variations'][0]['wooId'] = $id; invalid($bad); }
$bad = $product; $bad['payload']['wooId'] = 20; invalid($bad);
$bad = $product; $bad['entityId'] = 20; $bad['payload']['wooId'] = 20; invalid($bad);
$bad = $product; $bad['payload']['variations'][] = $bad['payload']['variations'][0]; invalid($bad);
$bad = $product; $bad['payload']['variations'] = array_fill(0, 1001, $product['payload']['variations'][0]); invalid($bad);
foreach ([[null, 1], [1, null], [2, 1], [-1, 0], [0, 3651], ['0', 1]] as [$min, $max_days]) {
    $bad = $product; $bad['payload']['productionMinDays'] = $min; $bad['payload']['productionMaxDays'] = $max_days; invalid($bad);
    $bad = $product; $bad['payload']['variations'][0]['productionMinDays'] = $min; $bad['payload']['variations'][0]['productionMaxDays'] = $max_days; invalid($bad);
}
$bad = $product; unset($bad['payload']['variations']); invalid($bad);
$bad = $product; $bad['payload']['stock_quantity'] = 100; invalid($bad);
same(send($product)->data['applied'], true);
same(count($storage->read_product(10)['payload']['variations']), 1);
$clear = $product; $clear['revision'] = 2; $clear['payload']['variations'] = [];
same(send($clear)->data['applied'], true);
same($storage->read_product(10)['payload']['variations'], []);
same($storage->read_product(11), null);
same($storage->read_product(20), null);
$large_product = $product; $large_product['revision'] = 3; $large_product['payload']['variations'] = [];
for ($i = 100; $i < 1100; $i++) {
    $GLOBALS['products'][$i] = new WC_Product_Variation($i, 10);
    $large_product['payload']['variations'][] = ['wooId' => $i, 'productionMinDays' => null, 'productionMaxDays' => null];
}
same(send($large_product)->data['applied'], true);
same(count($storage->read_product(10)['payload']['variations']), 1000);

// Relinking scopes both reads and revision history, including case-sensitive IDs.
$GLOBALS['linked'] = 'account-B';
same($storage->read_settings(), null);
same($storage->read_product(10), null);
status(send($input), 403);
same(send($input, ['x-overseek-account-id' => 'account-B'])->data['applied'], true);
same($storage->read_settings()['revision'], 1);
$GLOBALS['linked'] = 'account-b';
same($storage->read_settings(), null);
$GLOBALS['linked'] = '';
same($storage->read_settings(), null);
$GLOBALS['linked'] = 'account-A';
same($storage->read_settings()['revision'], 4);
same($storage->read_product(10)['revision'], 3);

// Modeled lock acquisition order: another writer wins before our insert locks the key.
$db = $GLOBALS['wpdb'];
$key = 'account-A|settings|0';
$db->before_insert = static function (Input_DB $db) use ($key): void { $db->rows[$key]['revision'] = 10; };
$racing = $input; $racing['revision'] = 9;
status(send($racing), 409);
same($db->rows[$key]['revision'], 10);
$racing = $max; $racing['revision'] = 10;
same(send($racing)->data['applied'], false);
$racing['payload']['enabled'] = false;
status(send($racing), 409);
$racing['revision'] = 11;
same(send($racing)->data['applied'], true);
same($db->rows[$key]['revision'], 11);
// Defensive CAS failure never acknowledges an update (real InnoDB prevents this interleave).
$db->before_update = static function (Input_DB $db, string $key): void { $db->rows[$key]['revision'] = 99; };
$racing['revision'] = 12;
status(send($racing), 503);
same($db->rows[$key]['revision'], 11);
foreach (['START TRANSACTION', 'INSERT INTO', 'UPDATE', 'COMMIT'] as $failure) {
    $before = $db->rows; $db->fail = $failure;
    status(send($racing), 503);
    same($db->rows, $before);
    $db->fail = '';
}
$db->engine = 'MyISAM'; status(send($racing), 503); $db->engine = 'InnoDB';
$safe = $racing; $safe['revision'] = 9007199254740991;
same(send($safe)->data['storedRevision'], 9007199254740991);
same(send($safe)->data['applied'], false);
same($db->installs, 1);
// A first-write failure rolls back the uncommitted sentinel too.
$new_product = $product; $new_product['entityId'] = 20; $new_product['payload']['wooId'] = 20; $new_product['payload']['variations'] = [];
$db->fail = 'UPDATE'; status(send($new_product), 503); $db->fail = '';
same($storage->read_product(20), null);
same(array_key_exists('account-A|product|20', $db->rows), false);
same(send($new_product)->data['applied'], true);
// Simulate relinking after permission/validation but before storage.
$validated = (new OverSeek_Delivery_Input_Validation())->validate(json_encode($new_product));
$GLOBALS['linked'] = 'account-B';
status($storage->store('account-A', $validated), 403);
$GLOBALS['linked'] = 'account-A';

// Existing auth routing also covers this POST path (including plain permalinks).
class WP { public array $query_vars = ['rest_route' => '/overseek/v1/delivery-estimates/inputs']; }
$GLOBALS['wp'] = new WP();
$main = (new ReflectionClass(OverSeek_Main::class))->newInstanceWithoutConstructor();
same($main->include_overseek_routes_in_wc_rest_authentication(false), true);
$caps = (new OverSeek_Delivery_Discovery_API())->get_capabilities()->data['capabilities'];
same($caps['configurationSync'], true); same($caps['storefront'], true);
same($caps['inboundInputs'], true); same($caps['inboundReceiptSafety'], true);

// Statically guard APIs that could otherwise throw inside a caught validation error.
foreach (['validation', 'storage', 'api'] as $suffix) {
    $source = file_get_contents(__DIR__ . '/../includes/class-overseek-delivery-input-' . $suffix . '.php');
    same((bool) preg_match('/\b(update_option|add_option|update_post_meta|wp_remote_\w+|wc_update_product_stock|wp_enqueue_\w+|add_action|add_filter)\s*\(/', $source), false);
    same((bool) preg_match('/->(save|set_stock_\w+)\s*\(/', $source), false);
}
echo "Delivery inputs: {$checks} checks passed. Real MySQL concurrency is not exercised by this stub harness.\n";

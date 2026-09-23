<?php
/**
 * Dependency-free guarded receipt lifecycle and SQL protocol regression harness.
 * Run: php overseek-wc-plugin/tests/delivery-receipts.php
 * Models durable journal transitions, not real MySQL or third-party Woo hooks.
 * @package OverSeek
 */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('ARRAY_A', 'ARRAY_A');
set_error_handler(static function (int $severity, string $message, string $file, int $line): void {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
$checks = 0;
function same($actual, $expected): void {
    $GLOBALS['checks']++;
    if ($actual !== $expected) { throw new RuntimeException('Expected ' . json_encode($expected) . ', got ' . json_encode($actual)); }
}
function error_is($result, string $code, int $status): void {
    same($result instanceof WP_Error, true);
    same($result->code, $code);
    same($result->data, ['status' => $status]);
    same(str_contains(json_encode($result), 'SECRET'), false);
}
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data) {}
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
}
class WP_REST_Request {
    public function __construct(private string $body = '', private array $headers = ['x-overseek-account-id' => 'account-A'], private array $query = []) {}
    public function get_body(): string { return $this->body; }
    public function get_method(): string { return 'POST'; }
    public function get_json_params(): array { return json_decode($this->body, true); }
    public function get_header(string $key): ?string { return $this->headers[strtolower($key)] ?? null; }
    public function get_query_params(): array { return $this->query; }
}
$GLOBALS['linked'] = 'account-A';
$GLOBALS['caps'] = ['manage_woocommerce'];
$GLOBALS['routes'] = [];
function current_user_can(string $cap): bool { return in_array($cap, $GLOBALS['caps'], true); }
function get_current_user_id(): int { return 45; }
function rest_authorization_required_code(): int { return $GLOBALS['caps'] ? 403 : 401; }
function get_option(string $key, $default = false) { return $key === 'overseek_account_id' ? $GLOBALS['linked'] : ($GLOBALS['receipt_test_options'][$key] ?? $default); }
function register_rest_route(string $namespace, string $path, array $args): void { $GLOBALS['routes'][$namespace . $path] = $args; }
function update_option(...$args): void { throw new LogicException('Option write forbidden'); }
function update_post_meta(...$args): void { throw new LogicException('Direct stock meta write forbidden'); }
function wp_json_encode($value): string { return json_encode($value); }
function wp_salt($scheme): string { return 'isolated-test-signing-key'; }

// Model filter priorities, including other callbacks before/after the observer.
$GLOBALS['filters'] = [];
function add_filter(string $hook, $callback, int $priority = 10, int $arguments = 1): bool {
    $GLOBALS['filters'][$hook][$priority][] = [$callback, $arguments];
    ksort($GLOBALS['filters'][$hook]);
    return true;
}
function remove_filter(string $hook, $callback, int $priority = 10): bool {
    foreach ($GLOBALS['filters'][$hook][$priority] ?? [] as $index => [$stored]) {
        if ($stored === $callback) { unset($GLOBALS['filters'][$hook][$priority][$index]); }
    }
    if (empty($GLOBALS['filters'][$hook][$priority])) { unset($GLOBALS['filters'][$hook][$priority]); }
    if (empty($GLOBALS['filters'][$hook])) { unset($GLOBALS['filters'][$hook]); }
    return true;
}
function has_filter(string $hook, $callback) {
    foreach ($GLOBALS['filters'][$hook] ?? [] as $priority => $callbacks) {
        foreach ($callbacks as [$stored]) { if ($stored === $callback) { return $priority; } }
    }
    return false;
}
function apply_filters(string $hook, $value, ...$args) {
    foreach ($GLOBALS['filters'][$hook] ?? [] as $callbacks) {
        foreach ($callbacks as [$callback, $count]) { $value = $callback(...array_slice([$value, ...$args], 0, $count)); }
    }
    return $value;
}
class WC_Data_Store {
    public function __construct(private $store) {}
    public static function load(string $type): self {
        same($type, 'product');
        return new self(apply_filters('woocommerce_product_data_store', $GLOBALS['stock_store']));
    }
    public function get_current_class_name() { return $this->store; }
}

class WC_Product {
    public $quantity = 0;
    public $manage = true;
    public bool $managing = true;
    public ?int $owner = null;
    public ?string $store = null;
    public function __construct(public int $id, public string $type = 'simple', public int $parent = 0) {}
    public function get_id(): int { return $this->id; }
    public function get_type(): string { return $this->type; }
    public function get_parent_id(): int { return $this->parent; }
    public function get_manage_stock(string $context) { same($context, 'edit'); return $this->manage; }
    public function managing_stock(): bool { return $this->managing; }
    public function get_stock_quantity(string $context) { same($context, 'edit'); return $this->quantity; }
    public function get_data_store() { return new WC_Data_Store($this->store ?? ($this->type === 'variation' ? 'WC_Product_Variation_Data_Store_CPT' : ($this->type === 'variable' ? 'WC_Product_Variable_Data_Store_CPT' : 'WC_Product_Data_Store_CPT'))); }
}
// The base stub deliberately lacks an ownership method, modeling unsupported native versions.
class Receipt_Product extends WC_Product {
    public function get_stock_managed_by_id(): int { return $this->owner ?? $this->id; }
}
class WC_Product_Variation extends Receipt_Product {}
$GLOBALS['products'] = [];
$GLOBALS['lookups'] = 0;
function wc_get_product(int $id) { $GLOBALS['lookups']++; return $GLOBALS['products'][$id] ?? false; }
$GLOBALS['calls'] = [];
$GLOBALS['hook'] = null;
function wc_update_product_stock($product, $amount, $method) {
    $db = $GLOBALS['wpdb'];
    same($db->in_transaction(), false);
    same(count($db->locks), 2);
    same(is_int($amount) && $amount > 0, true);
    same(in_array($method, ['increase', 'decrease'], true), true);
    $guard = $db->guards[$GLOBALS['linked'] . '|' . $product->id];
    $events = $db->journal[$GLOBALS['linked'] . '|' . $guard['operation_id']];
    same(max(array_keys($events)), 2); // applying already durably committed.
    $GLOBALS['calls'][] = [$product->id, $amount, $method];
    WC_Data_Store::load('product');
    $before = $product->quantity;
    $product->quantity += $method === 'increase' ? $amount : -$amount;
    $trace = $GLOBALS['native_trace'];
    $db->native_stock[$product->id] ??= (int) $before;
    $sql = $db->prepare("UPDATE {$db->postmeta} SET meta_value = meta_value %+f WHERE post_id = %d AND meta_key='_stock'", $method === 'increase' ? $amount : -$amount, $product->id);
    if ($trace !== 'no-announcement') {
        $sql = apply_filters('woocommerce_update_product_stock_query', $sql, $trace === 'wrong-owner' ? 999 : $product->id, $product->quantity, $trace === 'wrong-method' ? 'set' : $method);
    }
    if ($trace === 'duplicate-announcement') { $sql = apply_filters('woocommerce_update_product_stock_query', $sql, $product->id, $product->quantity, $method); }
    if ($trace === 'custom-query') { $sql = 'UPDATE custom_stock SET quantity = 3'; }
    if ($trace === 'late-filter') {
        add_filter('query', static fn ($query) => str_starts_with($query, 'UPDATE wp_postmeta') ? $query . ' /* altered after observer */' : $query, PHP_INT_MAX);
    }
    if ($trace === 'hook-throw-before-query') { throw new RuntimeException('SECRET hook error before stock SQL'); }
    if ($trace !== 'no-query') {
        $db->query($sql); // CPT ignores false here and still returns the computed numeric quantity.
        if ($trace === 'duplicate-write') { $db->query($sql); }
        if ($trace === 'extra-owner-write') { $db->query(str_replace('post_id = 20', 'post_id = 999', $sql)); }
    }
    if ($trace !== 'last-query' && $trace !== 'failure-last-query') {
        $db->get_var('SELECT receipt_native_lookup');
        $db->get_var('SELECT receipt_native_lookup'); // masks stock errors and affected-row counts.
        same($db->last_error, '');
        same($db->rows_affected, 0);
    }
    if ($GLOBALS['hook']) { return ($GLOBALS['hook'])($product); }
    return $product->quantity;
}

// Keep the standalone harness usable without the mysqli extension or a live connection.
if (!class_exists('mysqli')) {
    class mysqli {}
    class mysqli_sql_exception extends RuntimeException {
        protected string $sqlstate = '00000';
        public function getSqlState(): string { return $this->sqlstate; }
    }
}
function receipt_probe_error(int $code = 1305): mysqli_sql_exception {
    $error = new mysqli_sql_exception('Probe SQL failure', $code);
    (new ReflectionProperty(mysqli_sql_exception::class, 'sqlstate'))->setValue($error, '42000');
    return $error;
}
class Receipt_Mysqli extends mysqli {
    public function __construct(private wpdb $db) {}
    public function query(string $query, int $result_mode = 0): mysqli_result|bool {
        $this->db->native_queries[] = $query;
        if ($this->db->probe_failure) { throw receipt_probe_error(9999); }
        if (str_starts_with($query, 'SAVEPOINT `os_receipt_probe_')) { return true; }
        same(str_starts_with($query, 'RELEASE SAVEPOINT `os_receipt_probe_'), true);
        if ($this->db->caller_transaction || $this->db->in_transaction()) { return true; }
        throw receipt_probe_error();
    }
}

/** Unknown SQL fails loudly. Native writes are simulated only outside journal transactions. */
class wpdb {
    public string $prefix = 'wp_';
    public string $postmeta = 'wp_postmeta';
    public string $last_query = '';
    public string $last_error = '';
    public int $rows_affected = 0;
    public int $num_queries = 0;
    public array $native_stock = [];
    public string $engine = 'InnoDB';
    public array $journal = [];
    public array $guards = [];
    public array $locks = [];
    public array $queries = [];
    public int $installs = 0;
    public bool $suppressed = false;
    public ?int $fail_phase = null;
    public bool $fail_commit = false;
    public bool $fail_read = false;
    public bool $lose_locks = false;
    public bool $autocommit = true;
    public bool $caller_transaction = false;
    public bool $probe_failure = false;
    public array $native_queries = [];
    public array $tables = [];
    public $dbh;
    public ?string $busy = null;
    public $on_lock = null;
    private array $prepared = [];
    private ?array $snapshot = null;
    public array $resolutions = [];
    public array $inputs = [];
    public function esc_like(string $value): string { return $value; }
    public function __construct() { $this->dbh = new Receipt_Mysqli($this); }
    public function in_transaction(): bool { return null !== $this->snapshot; }
    public function suppress_errors(bool $value): bool { $old = $this->suppressed; $this->suppressed = $value; return $old; }
    public function prepare(string $sql, ...$args): string {
        if (str_starts_with($sql, 'UPDATE wp_postmeta SET meta_value = meta_value %+f')) { return sprintf($sql, ...$args); }
        $key = 'prepared-' . count($this->prepared);
        $this->prepared[$key] = [$sql, $args];
        return $key;
    }
    private function unpack(string $id): array {
        [$sql, $args] = $this->prepared[$id] ?? [$id, []];
        $sql = apply_filters('query', $sql); // BEFORE wpdb::flush, exactly as in WordPress.
        $this->last_error = '';
        $this->rows_affected = 0;
        $this->last_query = $sql;
        $this->num_queries++;
        $this->queries[] = $sql;
        return [$sql, $args];
    }
    public function get_var(string $id) {
        [$sql, $args] = $this->unpack($id);
        if ($sql === 'SELECT receipt_native_lookup') { return '3'; }
        if ($sql === 'SELECT @@SESSION.autocommit') { return $this->autocommit ? '1' : '0'; }
        if (str_starts_with($sql, 'SHOW TABLES LIKE')) return isset($this->tables[$args[0]]) ? $args[0] : null;
        if (str_starts_with($sql, 'SELECT ENGINE')) {
            if ($args[0] === 'wp_postmeta') return $this->engine;
            same(in_array($args[0], ['wp_overseek_receipt_journal', 'wp_overseek_receipt_guards', 'wp_overseek_receipt_resolutions', 'wp_overseek_delivery_inputs'], true), true);
            return isset($this->tables[$args[0]]) ? $this->engine : null;
        }
        if ($sql === 'SELECT IS_USED_LOCK(%s)') { return isset($this->locks[$args[0]]) ? '123' : null; }
        if ($sql === 'SELECT GET_LOCK(%s, 0)') {
            if ($this->on_lock) { ($this->on_lock)(); $this->on_lock = null; }
            if ($this->busy === 'all' || ($this->busy === 'owner' && count($this->locks) === 1)) { return '0'; }
            same(strlen($args[0]) <= 64, true);
            $this->locks[$args[0]] = true;
            return '1';
        }
        if ($sql === 'SELECT IS_USED_LOCK(%s) = CONNECTION_ID()') { return isset($this->locks[$args[0]]) && !$this->lose_locks ? '1' : '0'; }
        if ($sql === 'SELECT RELEASE_LOCK(%s)') { unset($this->locks[$args[0]]); return '1'; }
        throw new LogicException('Unexpected scalar SQL: ' . $sql);
    }
    public function get_row(string $id, string $format) {
        [$sql, $args] = $this->unpack($id);
        same($format, ARRAY_A);
        if ($this->fail_read) { $this->last_error = 'SECRET SQL failed'; return null; }
        if (str_starts_with($sql, 'SELECT revision, payload FROM wp_overseek_delivery_inputs') || str_starts_with($sql, 'SELECT revision, payload_hash FROM wp_overseek_delivery_inputs')) return $this->inputs[implode('|', $args)] ?? null;
        if (str_starts_with($sql, 'SELECT audit FROM wp_overseek_receipt_resolutions')) { return isset($this->resolutions[implode('|', $args)]) ? ['audit' => $this->resolutions[implode('|', $args)]] : null; }
        if ($sql === 'SELECT operation, phase, quantity FROM wp_overseek_receipt_journal WHERE account_id = %s AND operation_id = %s ORDER BY phase DESC LIMIT 1') {
            $rows = $this->journal[implode('|', $args)] ?? [];
            return $rows ? $rows[max(array_keys($rows))] : null;
        }
        same($sql, 'SELECT operation_id, sequence, guard_active FROM wp_overseek_receipt_guards WHERE account_id = %s AND owner_id = %d');
        return $this->guards[implode('|', $args)] ?? null;
    }
    public function query(string $id) {
        [$sql, $args] = $this->unpack($id);
        if (str_starts_with($sql, 'UPDATE wp_postmeta') || str_starts_with($sql, 'UPDATE custom_stock')) {
            same($this->in_transaction(), false);
            $trace = $GLOBALS['native_trace'];
            if (in_array($trace, ['silent-failure', 'failure-last-query'], true)) { $this->last_error = 'SECRET stock UPDATE failed'; return false; }
            $this->rows_affected = $trace === 'zero-rows' ? 0 : ($trace === 'two-rows' ? 2 : 1);
            if ($trace === 'hidden-query') { $this->num_queries++; }
            if (preg_match("/\\AUPDATE wp_postmeta SET meta_value = meta_value ([+-][0-9]+\\.[0-9]+) WHERE post_id = ([0-9]+) AND meta_key='_stock'\\z/", $sql, $match) && $this->rows_affected === 1) {
                $owner = (int) $match[2];
                $this->native_stock[$owner] = ($this->native_stock[$owner] ?? 0) + (int) $match[1];
            }
            return $this->rows_affected;
        }
        if (str_starts_with($sql, 'CREATE TABLE IF NOT EXISTS wp_overseek_receipt_')) {
            same(str_ends_with($sql, 'ENGINE=InnoDB'), true);
            same(str_contains($sql, 'ascii_bin'), true);
            $this->installs++;
            preg_match('/CREATE TABLE IF NOT EXISTS (\w+)/', $sql, $match);
            $this->tables[$match[1]] = true;
            return 0;
        }
        if ($sql === 'START TRANSACTION') {
            same($this->snapshot, null);
            $this->snapshot = [$this->journal, $this->guards, $this->resolutions, $this->inputs];
            return 0;
        }
        if ($sql === 'COMMIT') {
            same($this->in_transaction(), true);
            if ($this->fail_commit) { return false; }
            $this->snapshot = null;
            return 0;
        }
        if ($sql === 'ROLLBACK') {
            same($this->in_transaction(), true);
            [$this->journal, $this->guards, $this->resolutions, $this->inputs] = $this->snapshot;
            $this->snapshot = null;
            return 0;
        }
        same($this->in_transaction(), true);
        if (str_starts_with($sql, 'INSERT INTO wp_overseek_delivery_inputs')) { $this->inputs[implode('|', $args)] ??= ['revision' => 0, 'payload_hash' => '', 'payload' => '']; return 1; }
        if (str_starts_with($sql, 'UPDATE wp_overseek_delivery_inputs SET payload')) {
            [$json, $hash, $revision, $account, $scope, $entity] = $args;
            $this->inputs["$account|$scope|$entity"] = ['revision' => $revision, 'payload_hash' => $hash, 'payload' => $json]; return 1;
        }
        if (str_starts_with($sql, 'INSERT INTO wp_overseek_receipt_resolutions')) { $this->resolutions[$args[0] . '|' . $args[1]] = $args[2]; return 1; }
        if (str_starts_with($sql, 'INSERT IGNORE INTO wp_overseek_receipt_guards')) { $this->guards[$args[0] . '|' . $args[1]] ??= ['operation_id' => $args[2], 'sequence' => 0, 'guard_active' => 1]; return 1; }
        if (str_starts_with($sql, 'UPDATE wp_overseek_receipt_guards SET guard_active = 0')) { $this->guards[$args[0] . '|' . $args[1]]['guard_active'] = 0; return 1; }
        if (str_starts_with($sql, 'INSERT INTO wp_overseek_receipt_journal')) {
            [$account, $operation, $owner, $sequence, $phase, $payload] = $args;
            same($sql, 'INSERT INTO wp_overseek_receipt_journal (account_id, operation_id, owner_id, sequence, phase, operation, quantity) VALUES (%s, %s, %d, %d, %d, %s, ' . (count($args) === 7 ? '%d' : 'NULL') . ')');
            if ($phase === $this->fail_phase) { return false; }
            $key = "$account|$operation";
            same(isset($this->journal[$key][$phase]), false);
            foreach ($this->journal[$key] ?? [] as $row) { same($row['operation'], $payload); }
            $decoded = json_decode($payload, true);
            same([$decoded['operationId'], $decoded['stockOwnerWooId'], $decoded['sequence']], [$operation, $owner, $sequence]);
            $this->journal[$key][$phase] = ['operation' => $payload, 'phase' => $phase, 'quantity' => $args[6] ?? null];
            return 1;
        }
        same($sql, 'INSERT INTO wp_overseek_receipt_guards (account_id, owner_id, operation_id, sequence, guard_active) VALUES (%s, %d, %s, %d, 1) ON DUPLICATE KEY UPDATE operation_id = VALUES(operation_id), sequence = VALUES(sequence), guard_active = 1');
        [$account, $owner, $operation, $sequence] = $args;
        $this->guards["$account|$owner"] = ['operation_id' => $operation, 'sequence' => $sequence, 'guard_active' => 1];
        return 1;
    }
    public function get_results(string $id, string $format): array {
        [$sql, $args] = $this->unpack($id);
        if (str_starts_with($sql, 'SELECT meta_id, meta_value FROM wp_postmeta')) return [['meta_id' => '1', 'meta_value' => (string) ($this->native_stock[$args[0]] ?? 0)]];
        throw new LogicException('Unexpected results SQL: ' . $sql);
    }
}
require_once __DIR__ . '/../includes/class-overseek-api.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-discovery-api.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-input-api.php';
require_once __DIR__ . '/../includes/class-overseek-receipt-validation.php';
require_once __DIR__ . '/../includes/class-overseek-receipt-storage.php';
require_once __DIR__ . '/../includes/class-overseek-receipt-write-observer.php';
require_once __DIR__ . '/../includes/class-overseek-receipt-api.php';
$GLOBALS['wpdb'] = new wpdb();
$api = new OverSeek_Receipt_API();
$api->register_routes();
same(count($GLOBALS['routes']), 2);
same($GLOBALS['wpdb']->installs, 0);
foreach ($GLOBALS['routes'] as $route) {
    same($route['methods'], 'POST');
    same(is_callable($route['callback']), true);
    same(is_callable($route['permission_callback']), true);
}
function op(string $id = 'receipt-1', int $sequence = 1, int $delta = 3, int $owner = 20): array {
    return ['operationId' => $id, 'sequence' => $sequence, 'productWooId' => $owner, 'variationWooId' => null, 'stockOwnerWooId' => $owner, 'delta' => $delta];
}
function send(array $op, string $action = 'prepare', array $headers = ['x-overseek-account-id' => 'account-A'], array $query = []) {
    $result = $GLOBALS['api']->$action(new WP_REST_Request(json_encode(['schemaVersion' => 1, 'operation' => $op], JSON_THROW_ON_ERROR), $headers, $query));
    same($GLOBALS['wpdb']->in_transaction(), false);
    same($GLOBALS['wpdb']->locks, []);
    same($GLOBALS['wpdb']->suppressed, false);
    foreach ($GLOBALS['filters'] as $callbacks) {
        foreach ($callbacks as $entries) {
            foreach ($entries as [$callback]) {
                same(is_array($callback) && $callback[0] instanceof OverSeek_Receipt_Write_Observer, false);
            }
        }
    }
    return $result;
}
function ack($result, array $op, string $state, ?int $quantity = null): void {
    same($result instanceof WP_REST_Response, true);
    same($result->status, 200);
    same($result->data, ['schemaVersion' => 1, 'operationId' => $op['operationId'], 'sequence' => $op['sequence'], 'stockOwnerWooId' => $op['stockOwnerWooId'], 'state' => $state, 'stockQuantity' => $quantity, 'guardActive' => true, 'receiptSafety' => 'unverified']);
}
function reset_receipts(): void {
    $GLOBALS['wpdb'] = new wpdb();
    $GLOBALS['linked'] = 'account-A';
    $GLOBALS['caps'] = ['manage_woocommerce'];
    $GLOBALS['products'] = [20 => new Receipt_Product(20), 10 => new WC_Product(10, 'variable'), 11 => new WC_Product_Variation(11, 'variation', 10)];
    $GLOBALS['calls'] = [];
    $GLOBALS['hook'] = null;
    $GLOBALS['filters'] = [];
    $GLOBALS['stock_store'] = 'WC_Product_Data_Store_CPT';
    $GLOBALS['native_trace'] = 'healthy';
}

// Both endpoints require management permission, linked account and the mandatory header.
reset_receipts();
foreach (['prepare', 'apply'] as $action) {
    $GLOBALS['caps'] = [];
    error_is(send(op(), $action), 'overseek_delivery_forbidden', 401);
    $GLOBALS['caps'] = ['read'];
    error_is(send(op(), $action), 'overseek_delivery_forbidden', 403);
    $GLOBALS['caps'] = ['manage_woocommerce'];
    error_is(send(op(), $action, []), 'overseek_delivery_account_required', 400);
    error_is(send(op(), $action, [], ['accountId' => 'account-A']), 'overseek_delivery_account_required', 400);
    error_is(send(op(), $action, ['x-overseek-account-id' => 'account-B']), 'overseek_delivery_account_mismatch', 403);
    error_is(send(op(), $action, ['x-overseek-account-id' => 'account-A'], ['accountId' => 'account-B']), 'overseek_delivery_account_mismatch', 403);
    $GLOBALS['linked'] = '';
    error_is(send(op(), $action), 'overseek_delivery_account_unlinked', 403);
    $GLOBALS['linked'] = 'account-A';
}
same($GLOBALS['wpdb']->queries, []);

// Exact schema, field types, bounds, explicit null and identity relationships.
$bad_ops = [];
foreach (['operationId' => ['', 'bad space', str_repeat('x', 129), 1], 'sequence' => [0, -1, 1.5, '1', true, 9007199254740992], 'productWooId' => [0, '20'], 'variationWooId' => [0, 20], 'stockOwnerWooId' => [0, 21], 'delta' => [0, 1000001, -1000001, 1.5, '3', false]] as $key => $values) {
    foreach ($values as $value) { $bad_ops[] = array_replace(op(), [$key => $value]); }
}
foreach (array_keys(op()) as $key) { $bad = op(); unset($bad[$key]); $bad_ops[] = $bad; }
$bad_ops[] = op() + ['extra' => true];
foreach ($bad_ops as $bad) { error_is(send($bad), 'overseek_receipt_invalid', 400); }
foreach (['null', '[]', '{}', '{', '{"schemaVersion":2,"operation":{}}', json_encode(['schemaVersion' => 1, 'operation' => op(), 'extra' => 0])] as $body) {
    error_is($api->prepare(new WP_REST_Request($body)), 'overseek_receipt_invalid', 400);
}
$valid_body = json_encode(['schemaVersion' => 1, 'operation' => op()]);
foreach ([str_replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1', $valid_body), str_replace('"delta":3', '"delta":3,"delta":4', $valid_body), str_replace('"delta":3', '"delta":3,"delt\\u0061":3', $valid_body), str_replace('"sequence":1', '"sequence":1.0', $valid_body)] as $body) {
    error_is($api->prepare(new WP_REST_Request($body)), 'overseek_receipt_invalid', 400);
}
foreach (['prepare', 'apply'] as $action) {
    error_is($api->$action(new WP_REST_Request(str_repeat(' ', 16385))), 'overseek_receipt_too_large', 413);
}
same($GLOBALS['wpdb']->installs, 0);

// Simple lifecycle, + / - deltas, zero quantities and historical ACKs after newer operations.
$first = op();
error_is(send($first, 'apply'), 'overseek_receipt_not_prepared', 409);
error_is(send(op('gap', 2)), 'overseek_receipt_sequence_conflict', 409);
ack(send($first), $first, 'prepared');
same($GLOBALS['calls'], []);
same($GLOBALS['products'][20]->quantity, 0);
$journal = $GLOBALS['wpdb']->journal;
$guard = $GLOBALS['wpdb']->guards;
ack(send($first), $first, 'prepared');
same($GLOBALS['wpdb']->journal, $journal);
same($GLOBALS['wpdb']->guards, $guard);
error_is(send(op('new-before-apply', 2)), 'overseek_receipt_sequence_conflict', 409);
foreach (['prepare', 'apply'] as $action) {
    error_is(send(op('receipt-1', 1, 4), $action), 'overseek_receipt_identity_conflict', 409);
    error_is(send(op('receipt-1', 1, 3, 10), $action), 'overseek_receipt_identity_conflict', 409);
}
ack(send($first, 'apply'), $first, 'applied', 3);
ack(send($first, 'apply'), $first, 'applied', 3);
same($GLOBALS['calls'], [[20, 3, 'increase']]);
$second = op('reversal-2', 2, -3);
ack(send($second), $second, 'prepared');
ack(send($second, 'apply'), $second, 'applied', 0);
same($GLOBALS['calls'], [[20, 3, 'increase'], [20, 3, 'decrease']]);
error_is(send(op('stale', 1)), 'overseek_receipt_sequence_conflict', 409);
error_is(send(op('gap', 4)), 'overseek_receipt_sequence_conflict', 409);
$journal = $GLOBALS['wpdb']->journal;
$guard = $GLOBALS['wpdb']->guards;
$lookups = $GLOBALS['lookups'];
unset($GLOBALS['products'][20]);
ack(send($first), $first, 'applied', 3);
ack(send($first, 'apply'), $first, 'applied', 3);
ack(send($second, 'apply'), $second, 'applied', 0);
same($GLOBALS['lookups'], $lookups);
same($GLOBALS['wpdb']->journal, $journal);
same($GLOBALS['wpdb']->guards, $guard);
same(count($GLOBALS['calls']), 2);

// Independent variations accepted; shared-parent ownership and wrong parents rejected.
reset_receipts();
$variation = array_replace(op('variation-1', 1, 5, 11), ['productWooId' => 10, 'variationWooId' => 11]);
$GLOBALS['products'][11]->manage = 'parent';
$GLOBALS['products'][11]->owner = 10;
error_is(send($variation), 'overseek_receipt_stock_identity_conflict', 409);
$GLOBALS['products'][11]->manage = true;
error_is(send($variation), 'overseek_receipt_stock_identity_conflict', 409);
$GLOBALS['products'][11]->owner = 11;
$GLOBALS['products'][11]->parent = 20;
error_is(send($variation), 'overseek_receipt_stock_identity_conflict', 409);
$GLOBALS['products'][11]->parent = 10;
$GLOBALS['products'][10]->type = 'simple';
error_is(send($variation), 'overseek_receipt_stock_identity_conflict', 409);
$GLOBALS['products'][10]->type = 'variable';
ack(send($variation), $variation, 'prepared');
ack(send($variation, 'apply'), $variation, 'applied', 5);
same($GLOBALS['calls'], [[11, 5, 'increase']]);
same($GLOBALS['products'][10]->quantity, 0);

// Actual stock state is independently revalidated immediately before apply.
foreach ([['type', 'custom'], ['parent', 10], ['manage', false], ['manage', 'parent'], ['owner', 10], ['managing', false], ['quantity', null], ['quantity', false], ['quantity', ''], ['quantity', 0.5], ['quantity', '1.5'], ['quantity', INF], ['quantity', 9007199254740991]] as [$property, $value]) {
    reset_receipts();
    ack(send($first), $first, 'prepared');
    $GLOBALS['products'][20]->$property = $value;
    error_is(send($first, 'apply'), 'overseek_receipt_stock_identity_conflict', 409);
    same($GLOBALS['calls'], []);
    same(array_keys($GLOBALS['wpdb']->journal['account-A|receipt-1']), [1]);
}
reset_receipts();
$GLOBALS['products'][20] = new stdClass(); // Missing native stock methods cannot pass.
error_is(send($first), 'overseek_receipt_stock_identity_conflict', 409);
same($GLOBALS['calls'], []);
$GLOBALS['products'][20] = new WC_Product(20); // Woo instance alone is insufficient without stock-owner method.
error_is(send($first), 'overseek_receipt_stock_identity_conflict', 409);
same($GLOBALS['calls'], []);
foreach ([0, '0', 0.0, '0.00', -2] as $quantity) {
    reset_receipts();
    $GLOBALS['products'][20]->quantity = $quantity;
    ack(send($first), $first, 'prepared');
    ack(send($first, 'apply'), $first, 'applied', (int) $quantity + 3);
}

// Native exceptions (after mutation), invalid return values and failed final capture park forever.
foreach (['throw', false, null, '', true, 1.5, '1.5', INF, 'capture', 'uncertain-capture', 'final-commit'] as $outcome) {
    reset_receipts();
    ack(send($first), $first, 'prepared');
    $GLOBALS['hook'] = static function ($product) use ($outcome) {
        if ($outcome === 'throw') { throw new RuntimeException('SECRET hook failure after changing stock'); }
        if ($outcome === 'capture') { $GLOBALS['wpdb']->fail_phase = 4; return $product->quantity; }
        if ($outcome === 'uncertain-capture') { $GLOBALS['wpdb']->fail_phase = 3; throw new RuntimeException('SECRET native hook'); }
        if ($outcome === 'final-commit') { $GLOBALS['wpdb']->fail_commit = true; return $product->quantity; }
        return $outcome;
    };
    ack(send($first, 'apply'), $first, 'uncertain');
    same($GLOBALS['products'][20]->quantity, 3);
    $GLOBALS['wpdb']->fail_phase = null;
    $GLOBALS['wpdb']->fail_commit = false;
    $GLOBALS['hook'] = null;
    ack(send($first, 'apply'), $first, 'uncertain');
    ack(send($first), $first, 'uncertain');
    error_is(send($second), 'overseek_receipt_sequence_conflict', 409);
    same(count($GLOBALS['calls']), 1);
    same($GLOBALS['wpdb']->guards['account-A|20']['guard_active'], 1);
}
// A native zero result is valid, not false; numeric Woo return strings are valid integers.
foreach ([0, '0', 0.0, '3', '3.0'] as $result) {
    reset_receipts();
    ack(send($first), $first, 'prepared');
    $GLOBALS['hook'] = static fn () => $result;
    ack(send($first, 'apply'), $first, 'applied', (int) $result);
    ack(send($first, 'apply'), $first, 'applied', (int) $result);
    same(count($GLOBALS['calls']), 1);
}

// Simulate process death after the applying commit, before any hook result capture.
reset_receipts();
ack(send($first), $first, 'prepared');
$storage = new OverSeek_Receipt_Storage();
same($storage->lock('account-A', $first), true);
$storage->transition('account-A', $first, 2);
$storage->close();
$GLOBALS['wpdb']->fail_phase = 3;
ack(send($first, 'apply'), $first, 'uncertain');
ack(send($first), $first, 'uncertain');
same(array_keys($GLOBALS['wpdb']->journal['account-A|receipt-1']), [1, 2]);
$GLOBALS['wpdb']->fail_phase = null;
ack(send($first, 'apply'), $first, 'uncertain');
error_is(send($second), 'overseek_receipt_sequence_conflict', 409);
same($GLOBALS['calls'], []);

// Failed prepare/uncertainty-barrier writes roll back, release locks and never invoke Woo.
foreach ([1, 2] as $phase) {
    reset_receipts();
    if ($phase === 2) { ack(send($first), $first, 'prepared'); }
    $before = [$GLOBALS['wpdb']->journal, $GLOBALS['wpdb']->guards];
    $GLOBALS['wpdb']->fail_phase = $phase;
    error_is(send($first, $phase === 1 ? 'prepare' : 'apply'), 'overseek_receipt_storage_failed', 503);
    same([$GLOBALS['wpdb']->journal, $GLOBALS['wpdb']->guards], $before);
    same($GLOBALS['calls'], []);
}
reset_receipts();
$GLOBALS['wpdb']->fail_commit = true;
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['wpdb']->journal, []);
same($GLOBALS['wpdb']->guards, []);
reset_receipts();
ack(send($first), $first, 'prepared');
$GLOBALS['wpdb']->fail_commit = true;
error_is(send($first, 'apply'), 'overseek_receipt_storage_failed', 503);
same(array_keys($GLOBALS['wpdb']->journal['account-A|receipt-1']), [1]);
same($GLOBALS['calls'], []);
reset_receipts();
$GLOBALS['wpdb']->fail_read = true;
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['wpdb']->journal, []);
reset_receipts();
$GLOBALS['wpdb']->engine = 'MyISAM';
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['wpdb']->journal, []);
reset_receipts();
$GLOBALS['wpdb']->lose_locks = true;
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['calls'], []);
reset_receipts();
$GLOBALS['wpdb']->autocommit = false;
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['wpdb']->installs, 0);
same($GLOBALS['calls'], []);

// Nonblocking operation/owner lock failures use the backend's special transient code.
foreach (['all', 'owner'] as $busy) {
    reset_receipts();
    $GLOBALS['wpdb']->busy = $busy;
    error_is(send($first), 'overseek_receipt_busy', 409);
    error_is(send($first, 'apply'), 'overseek_receipt_busy', 409);
    same($GLOBALS['wpdb']->installs, 0);
    same($GLOBALS['calls'], []);
}
// Reentrant hooks must not acquire a recursive lock or release the outer request's locks.
reset_receipts();
ack(send($first), $first, 'prepared');
$GLOBALS['hook'] = static function ($product) use ($first, $second) {
    foreach ([$first, $second, array_replace($first, ['stockOwnerWooId' => 11, 'productWooId' => 10, 'variationWooId' => 11])] as $op) {
        $locks = $GLOBALS['wpdb']->locks;
        error_is($GLOBALS['api']->prepare(new WP_REST_Request(json_encode(['schemaVersion' => 1, 'operation' => $op]))), 'overseek_receipt_busy', 409);
        same($GLOBALS['wpdb']->locks, $locks);
    }
    return $product->quantity;
};
ack(send($first, 'apply'), $first, 'applied', 3);
same(count($GLOBALS['calls']), 1);

// Account relinking isolates journal identity/sequence and rechecks permissions under locks.
reset_receipts();
$GLOBALS['wpdb']->on_lock = static function () { $GLOBALS['linked'] = 'account-B'; };
error_is(send($first), 'overseek_delivery_account_mismatch', 403);
same($GLOBALS['wpdb']->installs, 0);
reset_receipts();
ack(send($first), $first, 'prepared');
ack(send($first, 'apply'), $first, 'applied', 3);
$account_a_journal = $GLOBALS['wpdb']->journal['account-A|receipt-1'];
$GLOBALS['linked'] = 'account-B';
error_is(send($first, 'apply'), 'overseek_delivery_account_mismatch', 403);
$headers = ['x-overseek-account-id' => 'account-B'];
error_is(send($first, 'apply', $headers), 'overseek_receipt_not_prepared', 409);
ack(send($first, 'prepare', $headers), $first, 'prepared');
ack(send($first, 'apply', $headers), $first, 'applied', 6);
same($GLOBALS['wpdb']->journal['account-A|receipt-1'], $account_a_journal);
same(count($GLOBALS['wpdb']->guards), 2);
$GLOBALS['linked'] = 'account-A';
ack(send($first, 'apply'), $first, 'applied', 3);
same(count($GLOBALS['calls']), 2);

// Guard corruption cannot be bypassed by a valid prepared operation.
reset_receipts();
ack(send($first), $first, 'prepared');
$GLOBALS['wpdb']->guards['account-A|20']['guard_active'] = 0;
error_is(send($first, 'apply'), 'overseek_receipt_guard_conflict', 409);
same($GLOBALS['calls'], []);

// Exactly 16 KiB is accepted (including whitespace); key order does not change identity.
reset_receipts();
$body = json_encode(['operation' => array_reverse($first, true), 'schemaVersion' => 1]);
$body .= str_repeat(' ', 16384 - strlen($body));
ack($api->prepare(new WP_REST_Request($body)), $first, 'prepared');
ack(send($first, 'apply'), $first, 'applied', 3);
// Native CPT may silently fail its UPDATE, then compute/return 3 and clear errors via lookup SQL.
foreach (['healthy', 'last-query', 'silent-failure', 'failure-last-query', 'zero-rows', 'two-rows', 'no-query', 'no-announcement', 'custom-query', 'late-filter', 'wrong-owner', 'wrong-method', 'duplicate-write', 'duplicate-announcement', 'extra-owner-write', 'hidden-query', 'hook-throw-before-query'] as $trace) {
    reset_receipts();
    ack(send($first), $first, 'prepared');
    same($GLOBALS['filters'], []); // Prepare never installs observers.
    $GLOBALS['native_trace'] = $trace;
    $healthy = in_array($trace, ['healthy', 'last-query'], true);
    ack(send($first, 'apply'), $first, $healthy ? 'applied' : 'uncertain', $healthy ? 3 : null);
    if ($trace === 'silent-failure') {
        same($GLOBALS['products'][20]->quantity, 3); // Computed Woo object/result is not proof.
        same($GLOBALS['wpdb']->native_stock[20], 0);
        same($GLOBALS['wpdb']->last_error, ''); // Subsequent lookup/journal SQL erased the error.
    }
    if ($healthy) { same($GLOBALS['wpdb']->native_stock[20], 3); }
    $GLOBALS['native_trace'] = 'healthy';
    ack(send($first, 'apply'), $first, $healthy ? 'applied' : 'uncertain', $healthy ? 3 : null);
    ack(send($first), $first, $healthy ? 'applied' : 'uncertain', $healthy ? 3 : null);
    if (!$healthy) {
        same(array_keys($GLOBALS['wpdb']->journal['account-A|receipt-1']), [1, 2, 3]);
        error_is(send($second), 'overseek_receipt_sequence_conflict', 409);
    }
    same(count($GLOBALS['calls']), 1);
}

// Native/query filters altering the issued delta, owner, SQL or throwing must never ACK applied.
foreach (['native-delta', 'query-delta', 'query-owner', 'native-comment', 'query-throw', 'query-recursion'] as $mode) {
    reset_receipts();
    ack(send($first), $first, 'prepared');
    $callback = static function ($sql) use ($mode) {
        if (!str_starts_with($sql, 'UPDATE wp_postmeta')) { return $sql; }
        if ($mode === 'query-throw') { throw new RuntimeException('SECRET query filter failure'); }
        if ($mode === 'query-recursion') { $GLOBALS['wpdb']->get_var('SELECT receipt_native_lookup'); return $sql; }
        if ($mode === 'query-owner') { return str_replace('post_id = 20', 'post_id = 999', $sql); }
        if ($mode === 'native-comment') { return $sql . ' /* altered */'; }
        return str_replace('+3.000000', '+4.000000', $sql);
    };
    $hook = str_starts_with($mode, 'native-') ? 'woocommerce_update_product_stock_query' : 'query';
    add_filter($hook, $callback);
    $filters = $GLOBALS['filters'];
    ack(send($first, 'apply'), $first, 'uncertain');
    same($GLOBALS['filters'], $filters); // Remove ONLY our temporary observer on every exit path.
    remove_filter($hook, $callback);
    ack(send($first, 'apply'), $first, 'uncertain');
    same(count($GLOBALS['calls']), 1);
}

// If another callback removes observation, an otherwise healthy numeric result is insufficient.
reset_receipts();
ack(send($first), $first, 'prepared');
$GLOBALS['hook'] = static function ($product) {
    foreach ($GLOBALS['filters']['query'] ?? [] as $priority => $callbacks) {
        foreach ($callbacks as [$callback]) { remove_filter('query', $callback, $priority); }
    }
    return $product->quantity;
};
ack(send($first, 'apply'), $first, 'uncertain');
same($GLOBALS['filters'], []);
ack(send($first, 'apply'), $first, 'uncertain');
same(count($GLOBALS['calls']), 1);

// Detect custom global stock stores, product/variation stores and DB drop-ins before applying.
class Receipt_Custom_DB extends wpdb {}
foreach (['stock', 'product', 'variation', 'database'] as $custom) {
    reset_receipts();
    $operation = $custom === 'variation' ? $variation : $first;
    ack(send($operation), $operation, 'prepared');
    if ($custom === 'stock') { $GLOBALS['stock_store'] = 'Custom_Stock_Store'; }
    if ($custom === 'product') { $GLOBALS['products'][20]->store = 'Custom_Product_Store'; }
    if ($custom === 'variation') { $GLOBALS['products'][11]->store = 'Custom_Variation_Store'; }
    if ($custom === 'database') {
        $replacement = new Receipt_Custom_DB();
        $replacement->journal = $GLOBALS['wpdb']->journal;
        $replacement->guards = $GLOBALS['wpdb']->guards;
        $GLOBALS['wpdb'] = $replacement;
    }
    error_is(send($operation, 'apply'), $custom === 'database' ? 'overseek_receipt_storage_failed' : 'overseek_receipt_unsupported_stock_store', $custom === 'database' ? 503 : 409);
    same(array_keys($GLOBALS['wpdb']->journal['account-A|' . $operation['operationId']]), [1]);
    same($GLOBALS['calls'], []);
    same($GLOBALS['filters'], []);
}
reset_receipts();
$GLOBALS['stock_store'] = 'Custom_Stock_Store';
error_is(send($first), 'overseek_receipt_unsupported_stock_store', 409);
same($GLOBALS['wpdb']->journal, []);
same($GLOBALS['calls'], []);

// A datastore filter that changes only during the native call is still observed and parked.
reset_receipts();
ack(send($first), $first, 'prepared');
add_filter('woocommerce_product_data_store', static function ($store) {
    return count($GLOBALS['calls']) > 0 ? 'Custom_Stock_Store' : $store;
});
ack(send($first, 'apply'), $first, 'uncertain');
ack(send($first, 'apply'), $first, 'uncertain');
same(count($GLOBALS['calls']), 1);
// Both autocommit settings with an active caller transaction fail before DDL or stock.
foreach ([true, false] as $autocommit) {
    foreach (['prepare', 'apply'] as $action) {
        reset_receipts();
        if ($action === 'apply') { ack(send($first), $first, 'prepared'); }
        $GLOBALS['wpdb']->autocommit = $autocommit;
        $GLOBALS['wpdb']->caller_transaction = true;
        $before = [$GLOBALS['wpdb']->installs, $GLOBALS['wpdb']->journal, $GLOBALS['wpdb']->guards];
        $GLOBALS['wpdb']->queries = [];
        error_is(send($first, $action), 'overseek_receipt_storage_failed', 503);
        same([$GLOBALS['wpdb']->installs, $GLOBALS['wpdb']->journal, $GLOBALS['wpdb']->guards], $before);
        same($GLOBALS['wpdb']->caller_transaction, true);
        same(array_intersect($GLOBALS['wpdb']->queries, ['COMMIT', 'ROLLBACK', 'START TRANSACTION']), []);
        same($GLOBALS['calls'], []);
    }
}
foreach (['disabled-autocommit', 'unobservable', 'missing-handle'] as $mode) {
    reset_receipts();
    if ($mode === 'disabled-autocommit') { $GLOBALS['wpdb']->autocommit = false; }
    if ($mode === 'unobservable') { $GLOBALS['wpdb']->probe_failure = true; }
    if ($mode === 'missing-handle') { $GLOBALS['wpdb']->dbh = null; }
    error_is(send($first), 'overseek_receipt_storage_failed', 503);
    same($GLOBALS['wpdb']->installs, 0);
    same($GLOBALS['calls'], []);
}
reset_receipts();
$GLOBALS['wpdb']->on_lock = static function () { $GLOBALS['wpdb']->caller_transaction = true; };
error_is(send($first), 'overseek_receipt_storage_failed', 503);
same($GLOBALS['wpdb']->caller_transaction, true);
same($GLOBALS['wpdb']->installs, 0);
same($GLOBALS['calls'], []);
reset_receipts();
ack(send($first), $first, 'prepared');
same($GLOBALS['wpdb']->installs, 3);
ack(send($first), $first, 'prepared');
ack(send($first, 'apply'), $first, 'applied', 3);
ack(send($first, 'apply'), $first, 'applied', 3);
same($GLOBALS['wpdb']->installs, 3); // No repeated CREATE TABLE IF NOT EXISTS implicit commits.
fwrite(STDOUT, "Guarded receipts: {$checks} assertions passed.\n");

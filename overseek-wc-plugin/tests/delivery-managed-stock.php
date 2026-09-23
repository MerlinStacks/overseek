<?php
/** Actual managed adapter with live SQL/held/guard stubs; no cart-stock fallback. */
declare(strict_types=1);
class WC_Data_Store {
	public function __construct(private string $name = 'WC_Product_Data_Store_CPT') {}
	public static function load($type) { return new self(); }
	public function get_current_class_name() { return $this->name; }
}
require __DIR__ . '/delivery-live-adapter.php';
function wc_get_held_stock_quantity($owner, $exclude = 0) { $GLOBALS['held_excluded'] = $exclude; return $GLOBALS['held']; }
function wc_get_order($id) { return $GLOBALS['test_order'] ?? null; }
function add_filter(...$args) { throw new LogicException('Read must not add hooks'); }
function remove_filter(...$args) { throw new LogicException('Read must not remove hooks'); }
function has_filter(...$args) { return false; }
class wpdb {
	public string $prefix = 'wp_'; public string $postmeta = 'wp_postmeta'; public string $last_error = '';
	public string $last_query = ''; public int $rows_affected = 0; public int $num_queries = 0;
	public int $quantity = 0; public int $guardReads = 0; public bool $race = false;
	public bool $active = true; public bool $enabled = true; public int $settingsRevision = 1;
	public ?string $environmentFingerprint = null;
	public array $guard = ['operation_id' => 'baseline_epoch', 'sequence' => '0', 'guard_active' => '0'];
	public function suppress_errors($value) { return false; }
	public function prepare($sql, ...$args) { return str_starts_with($sql, 'SELECT revision, payload') ? $sql . ' /* scope:' . $args[1] . ' */' : $sql; }
	public function get_var($sql) { if (str_starts_with($sql, 'SELECT ENGINE')) return 'InnoDB'; throw new RuntimeException('Unexpected metadata query'); }
	public function get_row($sql, $format) {
		if (str_contains($sql, 'overseek_receipt_guards')) {
			$this->guardReads++;
			if ($this->race && $this->guardReads >= 2) $this->guard = ['operation_id' => 'new-receipt', 'sequence' => '1', 'guard_active' => '1'];
			return $this->guard;
		}
		if (str_contains($sql, 'scope:settings')) return ['revision' => (string)$this->settingsRevision, 'payload' => json_encode(['enabled' => $this->enabled, 'settings' => []])];
		return ['revision' => '1', 'payload' => json_encode(['mode' => 'guarded', 'epoch' => 'epoch', 'active' => $this->active, 'settingsRevision' => 1, 'environmentFingerprint' => $this->environmentFingerprint])];
	}
	public function get_results($sql, $format) {
		return [['meta_key' => '_stock', 'meta_value' => (string)$this->quantity], ['meta_key' => '_stock_status', 'meta_value' => 'instock'], ['meta_key' => '_manage_stock', 'meta_value' => 'yes'], ['meta_key' => '_backorders', 'meta_value' => 'yes']];
	}
}
if (!defined('ARRAY_A')) define('ARRAY_A', 'ARRAY_A');
$GLOBALS['wpdb'] = new wpdb(); $GLOBALS['held'] = 2;
[ $store, $p, $rates ] = fixture(); $p->managed = true; $p->stock = 100000; $p->backorders = true;
$proof = ['version' => 1, 'epoch' => 'epoch', 'owners' => [['stockOwnerWooId' => 10, 'sequence' => 0, 'operationId' => 'baseline_epoch']]];
$store->inbound[10]['receiptSafety'] = 'verified'; $store->inbound[10]['receiptProof'] = $proof;
$store->inbound[10]['targets'][0]['supplierLead'] = ['min' => 20, 'max' => 20];
$fresh = run_adapter($store, [line($p)], $rates);
same('available', $fresh['status'], 'verified managed input calculates: ' . json_encode($fresh));
same('2026-10-13', $fresh['readiness']['min'], 'uses live shortage and supplier lead, not stale 100000 cart units');
$snapshot = OverSeek_Delivery_Stock_Snapshot::read('linked-account', $p, $proof);
same(2, $snapshot['prior_demand'], 'held demand included once');
$GLOBALS['wpdb']->quantity = -3;
$snapshot = OverSeek_Delivery_Stock_Snapshot::read('linked-account', $p, $proof);
same(-3, $snapshot['quantity'], 'negative stock remains explicit');
same(5, $snapshot['prior_demand'], 'negative backlog plus held, engine clamps quantity once');
$GLOBALS['wpdb']->race = true; $GLOBALS['wpdb']->guardReads = 0;
unavailable('stock_snapshot_changed', run_adapter($store, [line($p)], $rates), 'receipt between guard reads fails closed');
$GLOBALS['wpdb']->race = false;
unavailable('receipt_guard_pending', run_adapter($store, [line($p)], $rates), 'newer pending guard cannot be used with old proof');
same(0, $GLOBALS['network_calls'], 'no estimate HTTP');
$GLOBALS['wpdb'] = new wpdb(); $GLOBALS['wpdb']->quantity = 0; $GLOBALS['held'] = 0;
$p->type = 'variable';
$a = new WC_Product_Variation(11, 10); $b = new WC_Product_Variation(12, 10);
foreach ([$a, $b] as $variant) { $variant->managed = 'parent'; $variant->owner = 10; $variant->backorders = true; }
$GLOBALS['catalogue'][10] = $p;
$store->products[10]['variations'] = [];
$pooled = [['dueDate' => '2026-09-23', 'quantity' => 3]];
$store->inbound[10]['targets'] = [
    ['wooId' => 10, 'stockOwnerWooId' => null, 'state' => 'unsupported', 'supplierLead' => null, 'batches' => []],
    array_merge(target(11, 10), ['batches' => $pooled, 'supplierLead' => ['min' => 20, 'max' => 20]]),
    array_merge(target(12, 10), ['batches' => $pooled, 'supplierLead' => ['min' => 20, 'max' => 20]]),
];
$shared = run_adapter($store, [line($a, 2), line($b, 2)], $rates);
same('available', $shared['status'], 'parent pointer requires no pending parent target');
same('parent', $a->managing_stock(), 'native inherited variation managing_stock shape');
same('2026-10-13', $shared['readiness']['min'], 'three pooled inbound units cannot cover four sibling units by double counting');
unavailable('invalid_quantity', run_adapter($store, [line($a, 600000), line($b, 600000)], $rates), 'verified parent demand aggregates once');
$a->owner = 11; $store->inbound[10]['targets'][1]['stockOwnerWooId'] = 11;
unavailable('invalid_stock_owner', run_adapter($store, [line($a)], $rates), 'parent marker cannot certify a variation-local owner');
$a->owner = 10; $store->inbound[10]['targets'][1]['stockOwnerWooId'] = 10;
$p->managed = false;
unavailable('invalid_stock_owner', run_adapter($store, [line($a)], $rates), 'inherited marker requires genuinely managed parent');
$p->managed = true;
$store->inbound[10]['targets'][2]['batches'][0]['quantity'] = 99;
unavailable('owner_pool_conflict', run_adapter($store, [line($a), line($b)], $rates), 'conflicting owner references rejected');
// Shared producer wire fixture: distinct per-target leads, one physical owner pool.
$wire = json_decode(file_get_contents(__DIR__ . '/../../packages/overseek-core/test-fixtures/delivery-variant-supplier-leads-v1.json'), true, 32, JSON_THROW_ON_ERROR);
$store->inbound[10] = $wire['payload'];
$GLOBALS['catalogue'][11] = $a; $GLOBALS['catalogue'][12] = $b;
$ingestion = $wire['payload'];
$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$ingestion['generatedAt'] = $now->format('Y-m-d\TH:i:s\Z');
$ingestion['expiresAt'] = $now->modify('+24 hours')->format('Y-m-d\TH:i:s\Z');
(new OverSeek_Delivery_Inbound_Validation())->validate(json_decode(json_encode($ingestion)), 10);
$full = run_adapter($store, [line($a, 2), line($b, 2)], $rates);
same(['min' => '2026-09-29', 'max' => '2026-10-05'], $full['readiness'], 'short pool uses max endpoints plus production');
same($full, run_adapter($store, [line($b, 2), line($a, 2)], $rates), 'lead aggregation is order independent');
same(['min' => '2026-09-24', 'max' => '2026-09-29'], run_adapter($store, [line($a, 4)], $rates)['readiness'], 'fast preview excludes slow sibling lead');
same(['min' => '2026-09-24', 'max' => '2026-09-25'], run_adapter($store, [line($a), line($b)], $rates)['readiness'], 'covering dated pool wins over supplier leads');
$GLOBALS['wpdb']->quantity = 1;
same($full['readiness'], run_adapter($store, [line($a, 2), line($b, 3)], $rates)['readiness'], 'one stock unit and three batch units cannot cover five by counting owner twice');
$GLOBALS['wpdb']->quantity = 0;
$store->products[10]['variations'] = [['wooId' => 11, 'productionMinDays' => 0, 'productionMaxDays' => 0], ['wooId' => 12, 'productionMinDays' => 3, 'productionMaxDays' => 5]];
same(['min' => '2026-10-01', 'max' => '2026-10-08'], run_adapter($store, [line($a, 2), line($b, 2)], $rates)['readiness'], 'variant production ranges retained and whole order ships together');
$store->products[10]['variations'] = [];
$store->inbound[10]['targets'][1]['supplierLead'] = null;
same('2026-10-22', run_adapter($store, [line($a, 4)], $rates)['readiness']['min'], 'null lead uses thirty calendar days plus production');
$null_cart = run_adapter($store, [line($a, 2), line($b, 2)], $rates);
same('2026-10-22', $null_cart['readiness']['min'], 'null contributes fallback to mixed owner maximum');
same($null_cart, run_adapter($store, [line($b, 2), line($a, 2)], $rates), 'null fallback aggregation independent of cart order');
unset($store->settings['settings']['fallbackSupplierLeadTimeDays']);
same($null_cart, run_adapter($store, [line($a, 2), line($b, 2)], $rates), 'absent configured fallback defaults to thirty');
$store->settings['settings']['fallbackSupplierLeadTimeDays'] = 0;
$store->inbound[10]['targets'][1]['batches'] = []; $store->inbound[10]['targets'][2]['batches'] = [];
same('2026-09-22', run_adapter($store, [line($a, 4)], $rates)['readiness']['min'], 'explicit zero configured fallback');
$store->settings['settings']['fallbackSupplierLeadTimeDays'] = 30;
$store->inbound[10]['targets'][1]['supplierLead'] = ['min' => 0, 'max' => 0];
same('2026-09-22', run_adapter($store, [line($a, 4)], $rates)['readiness']['min'], 'valid zero lead never replaced with fallback');
$GLOBALS['wpdb']->guard['guard_active'] = '1';
unavailable('receipt_guard_pending', run_adapter($store, [line($a), line($b)], $rates), 'different leads retain pending guard blank');
$GLOBALS['wpdb']->guard['guard_active'] = '0';
$store->inbound[10]['targets'][2]['batches'] = [['dueDate' => '2026-09-23', 'quantity' => 99]];
unavailable('owner_pool_conflict', run_adapter($store, [line($a)], $rates), 'unselected sibling batch corruption still rejects');
fwrite(STDOUT, "Verified managed-stock snapshot assertions passed.\n");

define('WC_VERSION', getenv('OVERSEEK_TEST_WOO_VERSION') ?: '9.9.0');
function get_plugins() { $GLOBALS['plugin_scans'] = ($GLOBALS['plugin_scans'] ?? 0) + 1; return $GLOBALS['test_plugins'] ?? []; }
function get_site_option($key, $default = false) { return $GLOBALS['test_site_options'][$key] ?? $default; }
function get_post_field($field, $id) { return $GLOBALS['test_pages'][$id] ?? ($id === 1 ? '[woocommerce_cart]' : '[woocommerce_checkout]'); }
function get_post_status($id) { return 'publish'; }
function has_block($name, $content) { return str_contains($content, '<!-- wp:' . $name); }
function has_shortcode($content, $name) { return str_contains($content, '[' . $name . ']'); }
require_once __DIR__ . '/../includes/class-overseek-delivery-storefront-gate.php';
$GLOBALS['wpdb'] = new wpdb();
$GLOBALS['test_options']['woocommerce_cart_page_id'] = 1;
$GLOBALS['test_options']['woocommerce_checkout_page_id'] = 2;
$GLOBALS['wpdb']->environmentFingerprint = OverSeek_Delivery_Control::fingerprint();
same(true, OverSeek_Delivery_Storefront_Gate::is_active(), 'explicit guarded current settings activates local gate');
$GLOBALS['wpdb']->active = false;
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'explicit disable suppresses local gate');
$GLOBALS['wpdb']->active = true; $GLOBALS['wpdb']->enabled = false;
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'feature off suppresses local gate');
$GLOBALS['wpdb']->enabled = true; $GLOBALS['wpdb']->settingsRevision = 2;
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'new settings require readiness-bound reactivation');
$GLOBALS['wpdb']->settingsRevision = 1;
$GLOBALS['test_options']['active_plugins'] = ['vendor/renamed-file.php'];
$GLOBALS['test_plugins'] = ['vendor/renamed-file.php' => ['Name' => 'Estimated Delivery Date', 'AuthorURI' => 'https://vendor.invalid']];
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'plugin change invalidates fingerprint without a header scan');
same(0, $GLOBALS['plugin_scans'] ?? 0, 'no frontend header scans, including repeatedly active gates');
$classic_blockers = version_compare(WC_VERSION, '9.7', '<') ? ['classic_woocommerce_9_7_required'] : [];
same(array_merge(['deactivate_old_delivery_plugin:vendor/renamed-file.php'], $classic_blockers), OverSeek_Delivery_Control::blockers(), 'authenticated readiness detects old plugin header despite renamed file');
$GLOBALS['test_options']['active_plugins'] = [];
$GLOBALS['test_options']['overseek_delivery_environment_generation'] = 'plugin-toggle-generation';
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'returning to the prior plugin set still requires revalidation');
$GLOBALS['wpdb']->environmentFingerprint = OverSeek_Delivery_Control::fingerprint();
same(true, OverSeek_Delivery_Storefront_Gate::is_active(), 'validated new fingerprint restores gate');
$GLOBALS['test_options']['active_plugins'] = ['carrier/update-manager.php'];
$GLOBALS['test_plugins'] = ['carrier/update-manager.php' => ['Name' => 'Shipping Updater', 'PluginURI' => 'https://shipping.invalid/update/delivery/date', 'AuthorURI' => 'https://vendor.invalid/estimated-delivery']];
same($classic_blockers, OverSeek_Delivery_Control::blockers(), 'unrelated URI date substrings do not block carrier plugins');
$GLOBALS['test_options']['active_plugins'] = ['pi-edd/pi-edd.php']; $GLOBALS['test_plugins'] = ['pi-edd/pi-edd.php' => ['Name' => 'Renamed vendor plugin']];
same(array_merge(['deactivate_old_delivery_plugin:pi-edd/pi-edd.php'], $classic_blockers), OverSeek_Delivery_Control::blockers(), 'known Pi basename cannot hide behind a renamed header');
$GLOBALS['test_options']['active_plugins'] = [];
$GLOBALS['test_options']['woocommerce_pickup_location_settings'] = ['enabled' => 'yes'];
same(false, OverSeek_Delivery_Storefront_Gate::is_active(), 'checkout option change invalidates fingerprint before revalidation');
same($classic_blockers, OverSeek_Delivery_Control::blockers(), 'unused Blocks pickup settings do not block an explicitly classic setup');
unset($GLOBALS['test_options']['woocommerce_pickup_location_settings']);
$GLOBALS['test_pages'] = [1 => '<!-- wp:woocommerce/cart -->', 2 => '<!-- wp:woocommerce/checkout -->'];
same(version_compare(WC_VERSION, '9.9', '<') ? ['blocks_woocommerce_9_9_required'] : [], OverSeek_Delivery_Control::blockers(), 'actual Blocks requires Woo 9.9; Woo 8 cannot claim ready');
$GLOBALS['test_options']['woocommerce_pickup_location_settings'] = ['enabled' => 'yes'];
same(array_merge(version_compare(WC_VERSION, '9.9', '<') ? ['blocks_woocommerce_9_9_required'] : [], ['blocks_pickup_requires_verified_presentation']), OverSeek_Delivery_Control::blockers(), 'actual Blocks pickup flow is blocked explicitly');
unset($GLOBALS['test_options']['woocommerce_pickup_location_settings']);
$GLOBALS['test_options']['woocommerce_checkout_page_id'] = 0;
same(['declare_classic_or_supported_blocks_checkout_pages'], OverSeek_Delivery_Control::blockers(), 'unknown checkout is not silently certified classic');
$GLOBALS['test_options']['woocommerce_checkout_page_id'] = 2; $GLOBALS['test_pages'] = [];
same($classic_blockers, OverSeek_Delivery_Control::blockers(), 'declared classic uses actual quote-reader minimum, never false-ready Woo 8');
fwrite(STDOUT, "Readiness-bound local storefront gate assertions passed.\n");
$own_cart = [line($a, 2), line($b, 2)];
$GLOBALS['test_woo'] = (object) [
    'session' => new class { public function get($key, $default = null) { return $key === 'store_api_draft_order' ? 17 : $default; } },
    'cart' => new class($own_cart) { public function __construct(private array $cart) {} public function get_cart() { return $this->cart; } public function get_cart_hash() { return 'cart-hash'; } },
];
$GLOBALS['test_order'] = new class { public function has_status($statuses) { return true; } public function get_cart_hash() { return 'cart-hash'; } };
$exclude = new ReflectionMethod(OverSeek_Delivery_Live_Adapter::class, 'held_exclusion');
same(17, $exclude->invoke(null, $own_cart), 'actual hash-matching draft excludes own held reservation');
same(0, $exclude->invoke(null, [line($a)]), 'synthetic product preview excludes no reservation');
fwrite(STDOUT, "Current-cart reservation exclusion assertions passed.\n");

function add_action($hook, $callback, $priority = 10, $argc = 1) { $GLOBALS['environment_hooks'][$hook][] = $callback; }
function wp_generate_uuid4() { return 'generation-' . ($GLOBALS['generation_counter'] = ($GLOBALS['generation_counter'] ?? 0) + 1); }
function update_option($key, $value, $autoload = false) {
    $GLOBALS['test_options'][$key] = $value;
    foreach ($GLOBALS['environment_hooks']['updated_option'] ?? [] as $callback) $callback($key);
}
function update_site_option($key, $value) {
    $GLOBALS['test_site_options'][$key] = $value;
    foreach ($GLOBALS['environment_hooks']['updated_site_option'] ?? [] as $callback) $callback($key);
}
OverSeek_Delivery_Control::register_invalidation();
$initial_fingerprint = OverSeek_Delivery_Control::fingerprint();
update_option('active_plugins', ['temporary/plugin.php']); update_option('active_plugins', []);
same(false, $initial_fingerprint === OverSeek_Delivery_Control::fingerprint(), 'real option-change hooks invalidate even a plugin roundtrip');
$initial_fingerprint = OverSeek_Delivery_Control::fingerprint();
update_site_option('active_sitewide_plugins', ['temporary/network.php' => 1]); update_site_option('active_sitewide_plugins', []);
same(false, $initial_fingerprint === OverSeek_Delivery_Control::fingerprint(), 'network-active plugin roundtrip invalidates');
$initial_fingerprint = OverSeek_Delivery_Control::fingerprint();
foreach ($GLOBALS['environment_hooks']['post_updated'] as $callback) $callback(2, (object)['post_content' => '<!-- wp:woocommerce/checkout -->', 'post_status' => 'publish'], (object)['post_content' => '[woocommerce_checkout]', 'post_status' => 'publish']);
same(false, $initial_fingerprint === OverSeek_Delivery_Control::fingerprint(), 'checkout page content change invalidates cached declaration');
$initial_fingerprint = OverSeek_Delivery_Control::fingerprint();
foreach ($GLOBALS['environment_hooks']['post_updated'] as $callback) $callback(2, (object)['post_content' => '[woocommerce_checkout]', 'post_status' => 'publish', 'post_title' => 'New title'], (object)['post_content' => '[woocommerce_checkout]', 'post_status' => 'publish', 'post_title' => 'Old title']);
same($initial_fingerprint, OverSeek_Delivery_Control::fingerprint(), 'unrelated page title edits do not invalidate activation');
$scans = $GLOBALS['plugin_scans'];
$GLOBALS['wpdb']->environmentFingerprint = OverSeek_Delivery_Control::fingerprint();
for ($i = 0; $i < 10; $i++) same(true, OverSeek_Delivery_Storefront_Gate::is_active(), 'active fingerprint gate');
same($scans, $GLOBALS['plugin_scans'], 'repeated active renders never inspect plugin headers');
fwrite(STDOUT, "Plugin/page fingerprint invalidation and scan-free hotpath assertions passed.\n");

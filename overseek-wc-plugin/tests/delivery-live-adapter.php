<?php
/** Local CLI contract harness. No WordPress/Woo bootstrap or network. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' );
set_error_handler( static function ( int $severity, string $message, string $file, int $line ): void {
	throw new ErrorException( $message, 0, $severity, $file, $line );
} );

$account = 'linked-account';
$catalogue = [];
$lookups = [];
$network_calls = 0;
function get_option( $key, $default = false ) { return 'overseek_account_id' === $key ? $GLOBALS['account'] : ( $GLOBALS['test_options'][ $key ] ?? $default ); }
function wc_get_product( $id ) {
	$GLOBALS['lookups'][ $id ] = ( $GLOBALS['lookups'][ $id ] ?? 0 ) + 1;
	return $GLOBALS['catalogue'][ $id ] ?? false;
}
function wp_remote_request( ...$args ) { ++$GLOBALS['network_calls']; throw new RuntimeException( 'Network forbidden' ); }
function wp_remote_get( ...$args ) { return wp_remote_request( ...$args ); }
function wp_remote_post( ...$args ) { return wp_remote_request( ...$args ); }
function wc_get_products( ...$args ) { throw new RuntimeException( 'Catalogue scan forbidden' ); }
function WC() { if ( isset( $GLOBALS['test_woo'] ) ) { return $GLOBALS['test_woo']; } throw new RuntimeException( 'Shipping calculation/global cart access forbidden' ); }

class WC_Product {
	public $id; public $type = 'simple'; public $parent = 0; public $owner;
	public $virtual = false; public $shipping = true; public $purchasable = true;
	public $managed = false; public $stock = 100; public $status = 'instock'; public $backorders = false;
	public function __construct( int $id ) { $this->id = $id; $this->owner = $id; }
	public function get_id() { return $this->id; }
	public function get_type() { return $this->type; }
	public function get_status() { return 'publish'; }
	public function is_type( $types ) { return in_array( $this->type, (array) $types, true ); }
	public function get_parent_id() { return $this->parent; }
	public function is_virtual() { return $this->virtual; }
	public function needs_shipping() { return $this->shipping; }
	public function is_purchasable() { return $this->purchasable; }
	public function get_stock_managed_by_id() { return $this->owner; }
	public function managing_stock() { return $this->managed; }
	public function get_stock_quantity() { return $this->stock; }
	public function get_stock_status() { return $this->status; }
	public function backorders_allowed() { return $this->backorders; }
	public function get_data_store() { return new WC_Data_Store( $this->type === 'variation' ? 'WC_Product_Variation_Data_Store_CPT' : ( $this->type === 'variable' ? 'WC_Product_Variable_Data_Store_CPT' : 'WC_Product_Data_Store_CPT' ) ); }
}
class WC_Product_Variation extends WC_Product {
	public function __construct( int $id, int $parent ) { parent::__construct( $id ); $this->parent = $parent; $this->type = 'variation'; }
}
class WC_Shipping_Rate {
	public function __construct( public $id, public $method, public $instance ) {}
	public function get_id() { return $this->id; }
	public function get_method_id() { return $this->method; }
	public function get_instance_id() { return $this->instance; }
}

require_once __DIR__ . '/../includes/class-overseek-delivery-live-adapter.php';

class Local_Delivery_Store extends OverSeek_Delivery_Input_Storage {
	public array $settings; public array $products = []; public array $inbound = []; public array $reads = [];
	private function row( string $scope, int $id, ?array $payload ): ?array {
		$key = $scope . ':' . $id;
		$this->reads[ $key ] = ( $this->reads[ $key ] ?? 0 ) + 1;
		return null === $payload ? null : [ 'revision' => 1, 'payload' => $payload ];
	}
	public function read_settings(): ?array { return $this->row( 'settings', 0, $this->settings ); }
	public function read_product( int $id ): ?array { return $this->row( 'product', $id, $this->products[ $id ] ?? null ); }
	public function read_inbound( int $id ): ?array { return $this->row( 'inbound', $id, $this->inbound[ $id ] ?? null ); }
}

function configured_rate( string $method, int $id, string $type = 'delivery' ): array {
	return [ 'methodId' => $method, 'instanceId' => $id, 'enabled' => true, 'fulfilmentType' => $type, 'minTransitDays' => 1, 'maxTransitDays' => 2 ];
}
function target( int $id, ?int $owner = null ): array {
	return [ 'wooId' => $id, 'stockOwnerWooId' => $owner ?? $id, 'state' => 'pending', 'supplierLead' => null, 'batches' => [] ];
}
function line( WC_Product $product, $qty = 1 ): array {
	return [ 'data' => $product, 'product_id' => $product->parent ?: $product->id, 'variation_id' => $product->parent ? $product->id : 0, 'quantity' => $qty ];
}
function fixture(): array {
	$GLOBALS['account'] = 'linked-account'; $GLOBALS['catalogue'] = []; $GLOBALS['lookups'] = [];
	$store = new Local_Delivery_Store();
	$store->settings = [ 'enabled' => true, 'settings' => [
		'timezone' => 'UTC', 'cutoffTime' => '14:00', 'productionWeekdays' => [ 1, 2, 3, 4, 5 ],
		'transitWeekdays' => [ 1, 2, 3, 4, 5 ], 'closures' => [], 'fallbackSupplierLeadTimeDays' => 30,
		'shippingMethods' => [ configured_rate( 'flat_rate', 7 ), configured_rate( 'local_pickup', 8, 'collection' ) ],
		'defaultMethod' => [ 'methodId' => 'flat_rate', 'instanceId' => 7 ],
	] ];
	$store->products[10] = [ 'wooId' => 10, 'productionMinDays' => 1, 'productionMaxDays' => 2, 'variations' => [] ];
	$store->inbound[10] = [ 'wooId' => 10, 'generatedAt' => '2026-09-21T00:00:00.000Z', 'expiresAt' => '2026-09-22T00:00:00.000Z', 'receiptSafety' => 'unverified', 'targets' => [ target( 10 ) ] ];
	$product = new WC_Product( 10 );
	$rates = [ new WC_Shipping_Rate( 'flat_rate:7', 'flat_rate', 7 ), new WC_Shipping_Rate( 'local_pickup:8', 'local_pickup', 8 ) ];
	return [ $store, $product, $rates ];
}
function run_adapter( Local_Delivery_Store $store, array $cart, array $rates, string $time = '2026-09-21T12:00:00Z' ): array {
	return ( new OverSeek_Delivery_Live_Adapter( $store ) )->calculate( $cart, $rates, new DateTimeImmutable( $time ) );
}
$assertions = 0;
function same( $expected, $actual, string $name ): void {
	++$GLOBALS['assertions'];
	if ( $expected !== $actual ) { throw new RuntimeException( $name . ': ' . json_encode( [ 'expected' => $expected, 'actual' => $actual ] ) ); }
}
function unavailable( string $reason, array $actual, string $name ): void {
	same( [ 'status' => 'unavailable', 'reason' => $reason ], $actual, $name );
}

[ $store, $p, $rates ] = fixture();
$result = run_adapter( $store, [ line( $p ) ], $rates );
same( 'available', $result['status'], 'unmanaged pending production only' );
same( [ 'min' => '2026-09-22', 'max' => '2026-09-23' ], $result['readiness'], 'production' );
same( [ 'id' => 'flat_rate:7', 'type' => 'delivery', 'min' => '2026-09-23', 'max' => '2026-09-25' ], $result['methods'][0], 'transit' );
same( [ 'id' => 'local_pickup:8', 'type' => 'pickup', 'min' => '2026-09-22', 'max' => '2026-09-23' ], $result['methods'][1], 'collection readiness' );
$after = run_adapter( $store, [ line( $p ) ], $rates, '2026-09-21T14:00:00Z' );
same( '2026-09-22', $after['effective_date'], 'cutoff inclusive' );
same( '2026-09-23', $after['readiness']['min'], 'cutoff applied once' );
$store->inbound[10]['targets'][0]['supplierLead'] = [ 'min' => 3650, 'max' => 3650 ];
$store->inbound[10]['targets'][0]['batches'] = [ [ 'dueDate' => '2026-10-01', 'quantity' => 100 ] ];
same( $result, run_adapter( $store, [ line( $p ) ], $rates ), 'unmanaged ignores supply wait' );

foreach ( [ 100, 0, -1 ] as $stock ) {
	[ $store, $p, $rates ] = fixture(); $p->managed = true; $p->stock = $stock; $p->backorders = true;
	unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $p ) ], $rates ), 'managed reversal gate ' . $stock );
}
foreach ( [ 0, -1, 1.5, 1.0, '1', true, null, 1000001 ] as $qty ) {
	[ $store, $p, $rates ] = fixture();
	unavailable( 'invalid_quantity', run_adapter( $store, [ line( $p, $qty ) ], $rates ), 'invalid cart quantity' );
}
[ $store, $p, $rates ] = fixture();
same( 'available', run_adapter( $store, [ line( $p, 1000000 ) ], $rates )['status'], 'quantity upper bound' );
unavailable( 'invalid_quantity', run_adapter( $store, [ line( $p, 600000 ), line( $p, 600000 ) ], $rates ), 'shared owner demand bound' );
$p->managed = true; $p->stock = 0.5;
unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $p ) ], $rates ), 'unverified proof takes precedence over stale cart quantity' );

foreach ( [ 'unsupported' => 'inbound_unsupported', 'integrity_error' => 'inbound_integrity_error', 'ready' => 'invalid_inbound' ] as $state => $reason ) {
	[ $store, $p, $rates ] = fixture(); $store->inbound[10]['targets'][0]['state'] = $state;
	unavailable( $reason, run_adapter( $store, [ line( $p ) ], $rates ), 'BOM/invalid target ' . $state );
}
foreach ( [
	'missing' => 'inbound_missing', 'tombstone' => 'inbound_target_missing', 'expired' => 'inbound_stale',
	'future' => 'inbound_stale', 'bad_date' => 'invalid_inbound', 'bad_expiry' => 'invalid_inbound',
	'owner' => 'stock_owner_mismatch', 'null_owner' => 'stock_owner_mismatch', 'verified' => 'invalid_inbound',
	'duplicate' => 'invalid_inbound', 'bad_batch' => 'invalid_inbound',
] as $case => $reason ) {
	[ $store, $p, $rates ] = fixture();
	switch ( $case ) {
		case 'missing': unset( $store->inbound[10] ); break;
		case 'tombstone': $store->inbound[10]['targets'] = []; break;
		case 'expired': $store->inbound[10]['generatedAt'] = '2026-09-20T12:00:00Z'; $store->inbound[10]['expiresAt'] = '2026-09-21T12:00:00Z'; break;
		case 'future': $store->inbound[10]['generatedAt'] = '2026-09-22T00:00:00Z'; $store->inbound[10]['expiresAt'] = '2026-09-23T00:00:00Z'; break;
		case 'bad_date': $store->inbound[10]['generatedAt'] = '2026-02-30T00:00:00Z'; break;
		case 'bad_expiry': $store->inbound[10]['expiresAt'] = '2026-09-23T00:00:00Z'; break;
		case 'owner': $store->inbound[10]['targets'][0]['stockOwnerWooId'] = 999; break;
		case 'null_owner': $store->inbound[10]['targets'][0]['stockOwnerWooId'] = null; break;
		case 'verified': $store->inbound[10]['receiptSafety'] = 'verified'; break;
		case 'duplicate': $store->inbound[10]['targets'][] = target( 10 ); break;
		case 'bad_batch': $store->inbound[10]['targets'][0]['batches'][] = [ 'dueDate' => '2026-02-30', 'quantity' => 1 ]; break;
	}
	unavailable( $reason, run_adapter( $store, [ line( $p ) ], $rates ), $case );
}

[ $store, $parent, $rates ] = fixture(); $parent->type = 'variable'; $GLOBALS['catalogue'][10] = $parent;
$a = new WC_Product_Variation( 11, 10 ); $b = new WC_Product_Variation( 12, 10 );
$store->inbound[10]['targets'] = [ target( 11 ), target( 12 ) ];
$store->products[10]['variations'] = [ [ 'wooId' => 11, 'productionMinDays' => 0, 'productionMaxDays' => 0 ], [ 'wooId' => 12, 'productionMinDays' => null, 'productionMaxDays' => null ] ];
same( [ 'min' => '2026-09-21', 'max' => '2026-09-21' ], run_adapter( $store, [ line( $a ) ], $rates )['readiness'], 'explicit variation zero' );
same( [ 'min' => '2026-09-22', 'max' => '2026-09-23' ], run_adapter( $store, [ line( $b ) ], $rates )['readiness'], 'null pair inherits' );
$store->reads = []; $GLOBALS['lookups'] = [];
same( 'available', run_adapter( $store, [ line( $a ), line( $b ), line( $a ) ], $rates )['status'], 'consistent full variation cart' );
same( [ 'settings:0' => 1, 'product:10' => 1, 'inbound:10' => 1 ], $store->reads, 'one blob read per parent per request' );
same( [ 10 => 1 ], $GLOBALS['lookups'], 'one parent lookup' );
$store->products[10]['productionMinDays'] = null; $store->products[10]['productionMaxDays'] = null;
unavailable( 'missing_range', run_adapter( $store, [ line( $a ), line( $b ) ], $rates ), 'one unknown line suppresses everything' );
same( 'available', run_adapter( $store, [ line( $a ) ], $rates )['status'], 'zero override with unknown parent' );
$store->products[10]['productionMinDays'] = 0; $store->products[10]['productionMaxDays'] = 0;
$parent->managed = true; $a->managed = true; $b->managed = true; $a->owner = 10; $b->owner = 10;
unavailable( 'stock_owner_mismatch', run_adapter( $store, [ line( $a ) ], $rates ), 'live owner is authoritative' );
$store->inbound[10]['targets'] = [ target( 11, 10 ), target( 12, 10 ) ];
unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $a, 600000 ), line( $b, 600000 ) ], $rates ), 'unverified parent rejected before demand aggregation' );
unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $a ), line( $b ) ], $rates ), 'shared stock never bypasses safety' );
unset( $GLOBALS['catalogue'][10] );
unavailable( 'stock_owner_missing', run_adapter( $store, [ line( $a ) ], $rates ), 'missing live parent' );

[ $store, $p, $rates ] = fixture();
$p->purchasable = false;
unavailable( 'blocked_item', run_adapter( $store, [ line( $p ) ], $rates ), 'purchasability' );
$p->purchasable = true; $p->status = 'outofstock'; $p->backorders = true;
unavailable( 'blocked_stock', run_adapter( $store, [ line( $p ) ], $rates ), 'outofstock authoritative' );
$p->status = 'onbackorder';
unavailable( 'unsupported_unmanaged_backorder', run_adapter( $store, [ line( $p ) ], $rates ), 'unmanaged backorder' );
$p->status = 'instock'; $p->type = 'bundle';
unavailable( 'unsupported_item', run_adapter( $store, [ line( $p ) ], $rates ), 'custom fulfilment type' );
$p->virtual = true;
unavailable( 'no_physical_items', run_adapter( $store, [ line( $p, 0.5 ) ], $rates ), 'skip virtual before unsupported/qty checks' );
$p->virtual = false; $p->shipping = false;
unavailable( 'no_physical_items', run_adapter( $store, [ line( $p ) ], $rates ), 'nonshipping excluded' );
$physical = new WC_Product( 10 );
$p->id = 20;
same( 'available', run_adapter( $store, [ line( $physical ), line( $p ) ], $rates )['status'], 'nonshipping does not require input' );

[ $store, $p, $rates ] = fixture(); $store->settings['enabled'] = false;
unavailable( 'feature_off', run_adapter( $store, [ line( $p ) ], $rates ), 'account disabled' );
same( [ 'settings:0' => 1 ], $store->reads, 'disabled exits before product reads' );
$GLOBALS['account'] = '';
unavailable( 'account_missing', run_adapter( $store, [ line( $p ) ], $rates ), 'unlinked account' );

foreach ( [ 'missing' => 'no_methods', 'unmapped' => null, 'suffix' => null, 'fake' => 'invalid_method', 'duplicate' => 'invalid_method', 'disabled' => null, 'default' => 'invalid_default_method', 'provider' => 'no_methods', 'provider_exact' => 'no_methods', 'transit' => 'invalid_range' ] as $case => $reason ) {
	[ $store, $p, $rates ] = fixture();
	switch ( $case ) {
		case 'missing': $rates = []; break;
		case 'unmapped': $rates[0] = new WC_Shipping_Rate( 'flat_rate:9', 'flat_rate', 9 ); break;
		case 'suffix': $rates[0]->id = 'flat_rate:7:rule'; break;
		case 'fake': $rates = [ (object) [ 'id' => 'flat_rate:7' ] ]; break;
		case 'duplicate': $rates[] = $rates[0]; break;
		case 'disabled': $store->settings['settings']['shippingMethods'][1]['enabled'] = false; break;
		case 'default': $store->settings['settings']['defaultMethod']['instanceId'] = 999; break;
		case 'provider': $rates = [ new WC_Shipping_Rate( 'weight_based_shipping:4:rule', 'weight_based_shipping', 4 ) ]; break;
		case 'provider_exact': $rates = [ new WC_Shipping_Rate( 'weight_based_shipping:4', 'weight_based_shipping', 4 ) ]; $store->settings['settings']['shippingMethods'][] = configured_rate( 'weight_based_shipping', 4 ); break;
		case 'transit': $store->settings['settings']['shippingMethods'][0]['minTransitDays'] = null; break;
	}
	$actual = run_adapter( $store, [ line( $p ) ], $rates );
	if ( null === $reason ) {
		same( 'available', $actual['status'], 'unmapped option does not poison mapped option ' . $case );
		same( 'suffix' === $case ? 2 : 1, count( $actual['methods'] ), 'only mapped options returned using authoritative metadata ' . $case );
	} else {
		unavailable( $reason, $actual, 'rates ' . $case );
	}
}
[ $store, $p, $rates ] = fixture();
$store->settings['settings']['shippingMethods'][0]['fulfilmentType'] = 'collection';
same( 'pickup', run_adapter( $store, [ line( $p ) ], [ $rates[0] ] )['methods'][0]['type'], 'explicit core clickcollect mapping' );
$store->settings['settings']['defaultMethod'] = null;
same( 'available', run_adapter( $store, [ line( $p ) ], [ $rates[1] ] )['status'], 'actual pickup eligible without default substitution' );
same( 'available', run_adapter( $store, [ line( $p ), line( clone $p ) ], $rates )['status'], 'equivalent distinct simple instances' );
unavailable( 'invalid_quantity', run_adapter( $store, [ line( $p, 600000 ), line( clone $p, 600000 ) ], $rates ), 'distinct instances aggregate owner demand' );
foreach ( [ 'owner' => 999, 'purchasable' => false, 'managed' => true, 'stock' => 99, 'status' => 'onbackorder', 'backorders' => true, 'parent' => 999, 'type' => 'bundle', 'virtual' => true, 'shipping' => false ] as $field => $value ) {
	$conflict = clone $p;
	$conflict->$field = $value;
	unavailable( 'inconsistent_cart', run_adapter( $store, [ line( $p ), line( $conflict ) ], $rates ), 'conflicting cloned snapshot ' . $field );
}
$bad = line( $p ); $bad['product_id'] = 999;
unavailable( 'inconsistent_cart', run_adapter( $store, [ $bad ], $rates ), 'cart ID mismatch' );
same( 0, $GLOBALS['network_calls'], 'no network calls' );

[ $store, $p, $rates ] = fixture();
$adapter = new OverSeek_Delivery_Live_Adapter( $store );
same( 'available', $adapter->calculate( [ line( $p ) ], $rates, new DateTimeImmutable( '2026-09-21T12:00:00Z' ) )['status'], 'reusable adapter initial call' );
unavailable( 'inbound_stale', $adapter->calculate( [ line( $p ) ], $rates, new DateTimeImmutable( '2026-09-22T00:00:00Z' ) ), 'reuse never refreshes expiry' );
same( '2026-09-22T00:00:00.000Z', $store->inbound[10]['expiresAt'], 'read never writes expiry' );
same( 2, $store->reads['inbound:10'], 'no cross-call cache' );
$p->managed = true;
unavailable( 'receipt_safety_unverified', $adapter->calculate( [ line( $p ) ], $rates, new DateTimeImmutable( '2026-09-21T12:00:00Z' ) ), 'reuse reads changed live management' );

[ $store, $p, $rates ] = fixture();
$store->settings['settings']['timezone'] = 'Europe/London';
$before = run_adapter( $store, [ line( $p ) ], $rates, '2026-09-21T12:59:59Z' );
$cutoff = run_adapter( $store, [ line( $p ) ], $rates, '2026-09-21T13:00:00Z' );
same( '2026-09-21', $before['effective_date'], 'store timezone before cutoff' );
same( '2026-09-22', $cutoff['effective_date'], 'store timezone at cutoff' );

[ $store, $parent, $rates ] = fixture(); $parent->type = 'variable'; $GLOBALS['catalogue'][10] = $parent;
$a = new WC_Product_Variation( 11, 10 ); $store->inbound[10]['targets'] = [ target( 11 ) ];
same( [ 'min' => '2026-09-22', 'max' => '2026-09-23' ], run_adapter( $store, [ line( $a ) ], $rates )['readiness'], 'omitted variation inherits' );
$store->products[10]['variations'] = [ [ 'wooId' => 11, 'productionMinDays' => null, 'productionMaxDays' => 0 ] ];
unavailable( 'invalid_range', run_adapter( $store, [ line( $a ) ], $rates ), 'half override does not inherit' );

[ $store, $p, $rates ] = fixture();
$other = new WC_Product( 20 );
unavailable( 'production_missing', run_adapter( $store, [ line( $p ), line( $other ) ], $rates ), 'missing second product suppresses all methods' );
$store->products[20] = [ 'wooId' => 20, 'productionMinDays' => 0, 'productionMaxDays' => 0, 'variations' => [] ];
$store->inbound[20] = $store->inbound[10]; $store->inbound[20]['wooId'] = 20;
$store->inbound[20]['targets'] = [ target( 20 ) ]; $other->managed = true;
unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $p ), line( $other ) ], $rates ), 'one managed item blocks whole mixed cart' );
$store->settings['settings']['shippingMethods'][] = configured_rate( 'free_shipping', 9 );
same( 'available', run_adapter( $store, [ line( $p ) ], [ new WC_Shipping_Rate( 'free_shipping:9', 'free_shipping', 9 ) ] )['status'], 'exact eligible free shipping mapping' );
same( 0, $GLOBALS['network_calls'], 'all cases remain local' );

[ $store, $parent, $rates ] = fixture(); $parent->type = 'variable'; $GLOBALS['catalogue'][10] = $parent;
$a = new WC_Product_Variation( 11, 10 ); $store->inbound[10]['targets'] = [ target( 11 ) ];
same( 'available', run_adapter( $store, [ line( $a ), line( clone $a ) ], $rates )['status'], 'equivalent distinct variation instances' );
unavailable( 'invalid_quantity', run_adapter( $store, [ line( $a, 500001 ), line( clone $a, 500000 ) ], $rates ), 'variation clone demand is aggregated' );
$a->managed = true;
unavailable( 'receipt_safety_unverified', run_adapter( $store, [ line( $a ), line( clone $a ) ], $rates ), 'managed clones retain receipt gate' );

// Exercise the actual importer without changing its validation or clock policy.
require_once __DIR__ . '/../includes/class-overseek-delivery-inbound-validation.php';
[ $store, $p, $rates ] = fixture(); $GLOBALS['catalogue'][10] = $p;
$clock = new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
$generated = $clock->modify( '+4 minutes' );
$store->inbound[10]['generatedAt'] = $generated->format( 'Y-m-d\TH:i:s\Z' );
$store->inbound[10]['expiresAt'] = $generated->modify( '+24 hours' )->format( 'Y-m-d\TH:i:s\Z' );
$wire = json_decode( json_encode( $store->inbound[10], JSON_THROW_ON_ERROR ), false, 32, JSON_THROW_ON_ERROR );
( new OverSeek_Delivery_Inbound_Validation() )->validate( $wire, 10 );
same( 10, $wire->targets[0]->stockOwnerWooId, 'importer accepts unmanaged pending self-owner and future skew' );
$adapter = new OverSeek_Delivery_Live_Adapter( $store );
unavailable( 'inbound_stale', $adapter->calculate( [ line( $p ) ], $rates, $clock ), 'adapter deliberately waits for ingestion-approved future build' );
same( 'available', $adapter->calculate( [ line( $p ) ], $rates, $generated )['status'], 'future input usable at build instant without refresh' );
same( $generated->modify( '+24 hours' )->format( 'Y-m-d\TH:i:s\Z' ), $store->inbound[10]['expiresAt'], 'waiting never extends expiry' );
fwrite( STDOUT, 'Delivery live adapter: ' . $assertions . " assertions passed.\n" );

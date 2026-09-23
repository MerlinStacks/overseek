<?php
/** Standalone native-hook/HPOS CRUD boundary harness. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ );
require_once __DIR__ . '/../includes/class-overseek-delivery-order-snapshot.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-checkout-capture.php';
function check( $ok, $label ) { if ( ! $ok ) { throw new RuntimeException( $label ); } ++$GLOBALS['checks']; }
$checks = 0; $hooks = []; $hook = '';
function add_action( $name, $fn, $priority, $argc ) { $GLOBALS['hooks'][$name] = [ $fn, $priority, $argc ]; }
function current_filter() { return $GLOBALS['hook']; }
function do_action( $name, ...$args ) { $GLOBALS['hook'] = $name; if ( isset( $GLOBALS['hooks'][$name] ) ) { call_user_func_array( $GLOBALS['hooks'][$name][0], $args ); } $GLOBALS['hook'] = ''; }
function WC() { return $GLOBALS['woo']; }
function wc_format_decimal( $v ) { return (string) (float) $v; }
class OverSeek_Delivery_Storefront_Gate { public static $active = true; public static function is_active() { return self::$active; } }
class OverSeek_Delivery_Storefront_Context {
	public static $package; public static $result; public static $calls = 0; public static $country = 'AU';
	public static function current_package() { return self::$package; }
	public static function destination() { return [ 'country' => self::$country ]; }
	public static function cart_result( $rates ) { ++self::$calls; check( $rates === self::$package['rates'], 'all actual rates, no synthetic default' ); return self::$result; }
}
class WC_Product { public function get_id() { return 12; } }
class WC_Shipping_Rate {
	public $id = 'flat_rate:7'; public $method = 'flat_rate'; public $instance = 7;
	public function get_id() { return $this->id; } public function get_method_id() { return $this->method; }
	public function get_instance_id() { return $this->instance; } public function get_label() { return 'Chosen shipping'; }
	public function get_cost() { return 5; } public function get_taxes() { return []; }
}
class Item {
	public $qty = 2; public $product = 12; public $variation = 0;
	public function get_product_id() { return $this->product; } public function get_variation_id() { return $this->variation; } public function get_quantity() { return $this->qty; }
}
class ShippingItem extends WC_Shipping_Rate {
	public $meta = []; public $total = '5.00';
	public function get_method_title() { return $this->get_label(); }
	public function meta_exists( $key ) { return array_key_exists( $key, $this->meta ); }
	public function get_meta( $key, $single ) { return $this->meta[$key]; }
	public function get_total() { return $this->total; } public function get_taxes() { return [ 'total' => [] ]; }
}
class WC_Order {
	public static $meta = []; public static $items; public static $shipping; public static $status = 'pending'; public static $writes = 0;
	public $items_override = null;
	public function __construct( private int $id = 1 ) {}
	public function get_id() { return $this->id; } public function get_type() { return 'shop_order'; }
	public function get_status() { return self::$status; } public function get_date_paid() { return null; }
	public function get_items( $type ) { return 'shipping' === $type ? self::$shipping : ( $this->items_override ?? self::$items ); }
	public function get_shipping_country() { return 'AU'; }
	public function meta_exists( $key ) { return array_key_exists( $key, self::$meta ); }
	public function read_meta_data( $force ) { check( $force, 'fresh CRUD metadata' ); }
	public function get_meta_data() { $rows = []; foreach ( self::$meta as $key => $value ) { $rows[] = new class( $key, $value ) { public function __construct( private $key, private $value ) {} public function get_data() { return [ 'key' => $this->key, 'value' => $this->value ]; } }; } return $rows; }
	public function add_meta_data( $key, $value, $unique ) { check( $unique, 'unique meta' ); self::$meta[$key] = $value; }
	public function save_meta_data() { ++self::$writes; }
	public function get_meta( $key, $single ) { return self::$meta[$key] ?? ''; }
}
$wpdb = new class {
	public $prefix = 'isolated_';
	public function prepare( $sql, ...$args ) { check( str_contains( $sql, 'GET_LOCK' ) || str_contains( $sql, 'RELEASE_LOCK' ), 'no direct order SQL' ); return $sql; }
	public function get_var( $sql ) { return '1'; }
};
function reset_context() {
	WC_Order::$meta = []; WC_Order::$items = [ new Item() ]; WC_Order::$shipping = [ new ShippingItem() ]; WC_Order::$status = 'pending';
	OverSeek_Delivery_Storefront_Gate::$active = true;
	OverSeek_Delivery_Storefront_Context::$country = 'AU';
	$rate = new WC_Shipping_Rate();
	OverSeek_Delivery_Storefront_Context::$package = [ 'overseek_package_key' => 0, 'rates' => [ $rate->id => $rate ] ];
	OverSeek_Delivery_Storefront_Context::$result = [ 'status' => 'available', 'timezone' => 'Australia/Sydney', 'effective_date' => '2026-09-22', 'readiness' => [ 'min' => '2026-09-23', 'max' => '2026-09-24' ], 'methods' => [ [ 'id' => 'flat_rate:7', 'type' => 'delivery', 'min' => '2026-09-24', 'max' => '2026-09-25' ] ] ];
	$GLOBALS['woo'] = (object) [ 'customer' => new stdClass(), 'cart' => new class { public function get_cart() { return [ [ 'data' => new WC_Product(), 'product_id' => 12, 'variation_id' => 0, 'quantity' => 2 ] ]; } }, 'session' => new class { public $chosen = [ 'flat_rate:7' ]; public function get( $key ) { return $this->chosen; } } ];
}
function submit( $blocks = false ) { $order = new WC_Order(); do_action( $blocks ? 'woocommerce_store_api_checkout_order_processed' : 'woocommerce_checkout_order_processed', ... ( $blocks ? [ $order ] : [ 1, [], $order ] ) ); }
OverSeek_Delivery_Checkout_Capture::register();
check( 2 === count( $hooks ), 'only final native hooks registered' );
foreach ( $hooks as $entry ) { check( PHP_INT_MAX === $entry[1], 'late context verification' ); }
foreach ( [ false, true ] as $blocks ) {
	reset_context();
	if ( $blocks ) {
		WC_Order::$status = 'checkout-draft';
		WC()->session->chosen = [ 'flat_rate:old-draft-choice' ];
		foreach ( [ 'woocommerce_store_api_checkout_update_order_meta', 'woocommerce_store_api_checkout_update_order_from_request', 'woocommerce_store_api_checkout_update_order_meta' ] as $draft ) { do_action( $draft, new WC_Order() ); }
		check( ! WC_Order::$meta, 'multiple draft PUTs do not freeze early choice' );
		WC()->session->chosen = [ 'flat_rate:7' ];
	}
	submit( $blocks );
	check( isset( WC_Order::$meta[OverSeek_Delivery_Order_Snapshot::META_KEY] ), 'final submitted order captured' );
	$first = WC_Order::$meta; $writes = WC_Order::$writes;
	OverSeek_Delivery_Storefront_Context::$result['methods'][0]['max'] = '2026-10-01'; submit( $blocks );
	check( $first === WC_Order::$meta && $writes === WC_Order::$writes, 'retry immutable' );
}
$cases = [
	'gate off' => function () { OverSeek_Delivery_Storefront_Gate::$active = false; },
	'quantity changed' => function () { WC_Order::$items[0]->qty = 3; },
	'product changed' => function () { WC_Order::$items[0]->product = 13; },
	'variation changed' => function () { WC_Order::$items[0]->variation = 13; },
	'partial order' => function () { WC_Order::$items = []; },
	'extra item' => function () { WC_Order::$items[] = new Item(); },
	'multiple shipping lines' => function () { WC_Order::$shipping[] = new ShippingItem(); },
	'wrong method' => function () { WC_Order::$shipping[0]->method = 'free_shipping'; },
	'wrong instance' => function () { WC_Order::$shipping[0]->instance = 8; },
	'wrong cost' => function () { WC_Order::$shipping[0]->total = '10'; },
	'destination changed' => function () { OverSeek_Delivery_Storefront_Context::$country = 'NZ'; },
	'separate Blocks pickup' => function () { OverSeek_Delivery_Storefront_Context::$package['rates']['flat_rate:7']->method = 'pickup_location'; },
	'wrong opaque identity' => function () { WC_Order::$shipping[0]->meta['rate_id'] = 'flat_rate:7:other'; },
	'no choice' => function () { WC()->session->chosen = []; },
	'stale choice' => function () { WC()->session->chosen = [ 'flat_rate:8' ]; },
	'invalid package' => function () { OverSeek_Delivery_Storefront_Context::$package = null; },
	'paid state' => function () { WC_Order::$status = 'processing'; },
	'draft classic' => function () { WC_Order::$status = 'checkout-draft'; },
	'no eligible rate' => function () { OverSeek_Delivery_Storefront_Context::$result['methods'][0]['id'] = 'other'; },
	'missing production' => function () { OverSeek_Delivery_Storefront_Context::$result = [ 'status' => 'unavailable', 'reason' => 'missing_range' ]; },
	'unsafe managed stock' => function () { OverSeek_Delivery_Storefront_Context::$result = [ 'status' => 'unavailable', 'reason' => 'receipt_safety_unverified' ]; },
];
foreach ( $cases as $label => $mutate ) { reset_context(); $mutate(); submit(); check( ! WC_Order::$meta, $label . ' skips' ); }
reset_context(); $unsaved = new WC_Order(); $unsaved->items_override = [ new Item() ]; $unsaved->items_override[0]->qty = 3;
do_action( 'woocommerce_checkout_order_processed', 1, [], $unsaved ); check( ! WC_Order::$meta, 'unsaved hook-object mutation rejected' );
reset_context(); $stale = new WC_Order(); $stale->items_override = [ new Item() ]; WC_Order::$items[0]->qty = 3;
do_action( 'woocommerce_checkout_order_processed', 1, [], $stale ); check( ! WC_Order::$meta, 'saved order mutation despite stale callback object rejected' );
reset_context(); WC_Order::$meta[OverSeek_Delivery_Order_Snapshot::META_KEY] = ''; submit(); check( '' === WC_Order::$meta[OverSeek_Delivery_Order_Snapshot::META_KEY], 'invalid existing snapshot preserved' );
reset_context();
$rate = new WC_Shipping_Rate(); $rate->method = 'local_pickup'; $rate->instance = 8; $rate->id = 'local_pickup:8';
OverSeek_Delivery_Storefront_Context::$package['rates'] = [ $rate->id => $rate ]; WC()->session->chosen = [ $rate->id ];
WC_Order::$shipping[0]->method = $rate->method; WC_Order::$shipping[0]->instance = 8;
$result =& OverSeek_Delivery_Storefront_Context::$result; $result['methods'] = [ [ 'id' => $rate->id, 'type' => 'pickup' ] + $result['readiness'] ];
submit( true ); $snapshot = WC_Order::$meta[OverSeek_Delivery_Order_Snapshot::META_KEY] ?? null;
check( $snapshot && null === $snapshot['delivery'] && $snapshot['dispatch'] === $snapshot['collection'], 'normal pickup collection uses whole-order readiness' );
echo "checkout capture: {$checks} checks passed\n";

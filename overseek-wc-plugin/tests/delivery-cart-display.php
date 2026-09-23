<?php
/** Standalone presentation boundary harness; no live checkout activation. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' );
$mode = $argv[1] ?? 'default';
if ( 'missing-version' !== $mode ) { define( 'WC_VERSION', 'old-version' === $mode ? '9.6.2' : ( 'first-native' === $mode ? '9.7.0' : '9.9.0' ) ); }
if ( in_array( $mode, [ 'store-api', 'other-api' ], true ) ) {
	define( 'REST_REQUEST', true );
	$wp = (object) [ 'query_vars' => [ 'rest_route' => 'store-api' === $mode ? '/wc/store/v1/cart' : '/wc/v3/orders' ] ];
}
if ( 'ajax' === $mode ) { define( 'WC_DOING_AJAX', true ); $_GET['wc-ajax'] = 'update_order_review'; }
set_error_handler( static function ( int $severity, string $message, string $file, int $line ): void {
	throw new ErrorException( $message, 0, $severity, $file, $line );
} );
$assertions = 0; $hooks = []; $reads = 0; $forbidden = 0; $admin = false; $storefront = true; $received = false; $pay = false;
function same( $expected, $actual, string $name ): void {
	++$GLOBALS['assertions'];
	if ( $expected !== $actual ) { throw new RuntimeException( $name . ': ' . json_encode( [ $expected, $actual ] ) ); }
}
function add_action( $name, $callback, $priority = 10, $argc = 1 ) { $GLOBALS['hooks'][$name][] = [ $callback, $priority, $argc ]; }
function add_filter( ...$args ) { add_action( ...$args ); }
function is_admin() { ++$GLOBALS['reads']; return $GLOBALS['admin']; }
function is_cart() { return $GLOBALS['storefront']; }
function is_checkout() { return false; }
function is_order_received_page() { return $GLOBALS['received']; }
function is_checkout_pay_page() { return $GLOBALS['pay']; }
function WC() { ++$GLOBALS['reads']; return $GLOBALS['woo']; }
function wp_enqueue_script( ...$args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'Assets forbidden' ); }
function wp_enqueue_style( ...$args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'Assets forbidden' ); }
function wp_remote_request( ...$args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'HTTP forbidden' ); }
function wp_remote_get( ...$args ) { wp_remote_request( ...$args ); }
function wp_remote_post( ...$args ) { wp_remote_request( ...$args ); }

class Rate_Base {
	public $description = 'Provider description <b>unchanged</b>'; public $cost = 12; public $taxes = [ 2 ];
	public function __construct( public $id, public $method, public $instance ) {}
	public function get_id() { return $this->id; }
	public function get_method_id() { return $this->method; }
	public function get_instance_id() { return $this->instance; }
	public function __call( $name, $args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'Unexpected mutation/access: ' . $name ); }
}
if ( 'missing-getter' === $mode ) {
	class WC_Shipping_Rate extends Rate_Base {}
} else {
	class WC_Shipping_Rate extends Rate_Base {
		public function get_delivery_time() { ++$GLOBALS['getter_calls']; throw new RuntimeException( 'Recursive getter forbidden' ); }
	}
}
class OverSeek_Delivery_Storefront_Gate {
	public static $active = false;
	public static function is_active(): bool { return self::$active; }
}
class OverSeek_Delivery_Storefront_Context {
	public static $calls = []; public static $throw = false; public static $nested = null;
	public static $result = [ 'status' => 'available', 'methods' => [
		[ 'id' => 'flat_rate:7', 'type' => 'delivery', 'min' => '2026-09-23', 'max' => '2026-09-25' ],
		[ 'id' => 'local_pickup:8', 'type' => 'pickup', 'min' => '2026-09-22', 'max' => '2026-09-23' ],
	] ];
	public static function cart_result( array $rates ): array {
		if ( ! OverSeek_Delivery_Storefront_Gate::is_active() ) { return [ 'status' => 'unavailable' ]; }
		self::$calls[] = $rates;
		if ( self::$throw ) { throw new RuntimeException( 'Adapter failure' ); }
		if ( self::$nested ) { ( self::$nested )(); }
		return self::$result;
	}
}
// Renderer double exercises the contract boundary. Shared renderer escaping/date
// validation and real adapter stock/package safety have their own harnesses.
class OverSeek_Delivery_Display {
	public static function method_text( array $result, string $id ): string {
		if ( 'available' !== ( $result['status'] ?? '' ) ) { return ''; }
		foreach ( $result['methods'] as $method ) {
			if ( $method['id'] === $id ) { return ( 'pickup' === $method['type'] ? 'Ready for collection: ' : 'Estimated delivery: ' ) . $method['min'] . ' – ' . $method['max']; }
		}
		return '';
	}
	public static function method_html( array $result, string $id, array $branding = [] ): string {
		$text = self::method_text( $result, $id );
		return '' === $text ? '' : '<small class="overseek-delivery-estimate">' . htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ) . '</small>';
	}
}
class Shipping_Double {
	public $packages = [];
	public function get_packages() { ++$GLOBALS['reads']; return $this->packages; }
	public function calculate_shipping( ...$args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'Calculation forbidden' ); }
}
class Cart_Double {
	public function __call( $name, $args ) { ++$GLOBALS['forbidden']; throw new RuntimeException( 'Unexpected cart access: ' . $name ); }
}
class Woo_Double {
	public $cart; public $session; public $customer; public $shipping;
	public function __construct() {
		$this->cart = new Cart_Double();
		$this->session = (object) [ 'chosen_shipping_methods' => [ 'flat_rate:7' ] ];
		$this->customer = (object) [ 'id' => 3 ]; $this->shipping = new Shipping_Double();
	}
	public function shipping() { ++$GLOBALS['reads']; return $this->shipping; }
}
$woo = new Woo_Double(); $getter_calls = 0;
$delivery = new WC_Shipping_Rate( 'flat_rate:7', 'flat_rate', 7 );
$pickup = new WC_Shipping_Rate( 'local_pickup:8', 'local_pickup', 8 );
$rates = [ $delivery->id => $delivery, $pickup->id => $pickup ];
$package = [ 'contents' => [ 'line-a' => [ 'product_id' => 10, 'variation_id' => 11, 'quantity' => 2 ] ], 'rates' => $rates ];
$woo->shipping->packages = [ 0 => $package ];
$includes_before = get_included_files();
require_once __DIR__ . '/../includes/class-overseek-delivery-cart-display.php';
$includes_loaded = get_included_files();
same( [ realpath( __DIR__ . '/../includes/class-overseek-delivery-cart-display.php' ) ], array_values( array_diff( $includes_loaded, $includes_before ) ), 'loading cart class does not preload display/context/adapter/engine' );
$provider = static function () {};
add_action( 'woocommerce_after_shipping_rate', $provider );
$display = new OverSeek_Delivery_Cart_Display();
function classic( $rate, $index = 0 ): string {
	ob_start(); $GLOBALS['display']->after_shipping_rate( $rate, $index ); return ob_get_clean();
}
same( 0, $reads, 'construction has no cart/context/assets reads' );
same( [ $provider, 10, 1 ], $hooks['woocommerce_after_shipping_rate'][0], 'existing classic callback retained' );
same( [ [ $display, 'after_shipping_rate' ], 10, 2 ], $hooks['woocommerce_after_shipping_rate'][1], 'classic registration' );
same( [ [ $display, 'delivery_time' ], 10, 2 ], $hooks['woocommerce_shipping_rate_delivery_time'][0], 'native registration' );
same( 2, count( $hooks ), 'only additive native hooks registered' );
same( '', classic( $delivery ), 'inactive classic blank' );
same( '', $display->delivery_time( '', $delivery ), 'inactive native blank' );
same( 'provider', $display->delivery_time( 'provider', $delivery ), 'inactive preserves text' );
same( true, $reads <= 8, 'bounded request/package reads before shared context admission gate' );
same( [], OverSeek_Delivery_Storefront_Context::$calls, 'inactive shared context never calculates' );
same( $includes_loaded, get_included_files(), 'inactive construction and hooks include no dependencies' );
OverSeek_Delivery_Storefront_Gate::$active = true;

if ( in_array( $mode, [ 'old-version', 'missing-version', 'missing-getter', 'other-api' ], true ) ) {
	same( '', $display->delivery_time( '', $delivery ), 'unsupported native environment blank' );
	same( [], OverSeek_Delivery_Storefront_Context::$calls, 'unsupported native avoids adapter' );
	if ( 'other-api' === $mode ) { same( '', classic( $delivery ), 'non-store REST blank' ); }
} else {
	$before = serialize( $woo );
	$expected = 'Estimated delivery: 2026-09-23 – 2026-09-25';
	same( $expected, $display->delivery_time( '', $delivery ), 'actual delivery option text' );
	same( 'Ready for collection: 2026-09-22 – 2026-09-23', $display->delivery_time( '', $pickup ), 'unselected pickup uses renderer wording' );
	same( $rates, OverSeek_Delivery_Storefront_Context::$calls[0], 'complete actual rates with exact Core IDs/methods/instances' );
	same( $rates, OverSeek_Delivery_Storefront_Context::$calls[1], 'unselected option receives same whole-order context' );
	same( 'flat_rate', OverSeek_Delivery_Storefront_Context::$calls[0]['flat_rate:7']->get_method_id(), 'Core method identity retained' );
	same( 7, OverSeek_Delivery_Storefront_Context::$calls[0]['flat_rate:7']->get_instance_id(), 'Core instance identity retained' );
	$wrapper = '<div class="overseek-delivery-cart-estimate" style="display:block;margin-top:.15em">';
	same( 'store-api' === $mode ? '' : $wrapper . '<small class="overseek-delivery-estimate">' . $expected . '</small></div>', classic( $delivery ), 'classic scoped block wrapper places estimate under method with small margin, or no REST duplicate' );
	same( 'store-api' === $mode ? '' : $wrapper . '<small class="overseek-delivery-estimate">Ready for collection: 2026-09-22 – 2026-09-23</small></div>', classic( $pickup ), 'classic unselected collection option' );
	$woo->shipping->packages = [ 7 => $package ];
	same( '', classic( $delivery, 0 ), 'classic does not assume package zero' );
	same( 'store-api' === $mode ? '' : $wrapper . '<small class="overseek-delivery-estimate">' . $expected . '</small></div>', classic( $delivery, '7' ), 'actual nonzero package key matches template string index' );
	same( $expected, $display->delivery_time( '', $delivery ), 'native resolves sole nonzero package without selection inference' );
	$woo->shipping->packages = [ 0 => $package ];
	$called = count( OverSeek_Delivery_Storefront_Context::$calls );
	foreach ( [ 'Provider 3 days', ' ', '0', '<b>Provider</b>', null, false ] as $original ) {
		same( $original, $display->delivery_time( $original, $delivery ), 'provider value preserved verbatim' );
	}
	same( $called, count( OverSeek_Delivery_Storefront_Context::$calls ), 'provider text prevents calculation' );
	same( '', classic( $delivery, 1 ), 'wrong package index blank' );
	same( '', classic( $delivery, null ), 'missing classic package index blank' );
	same( '', classic( $delivery, false ), 'invalid classic package index blank' );
	same( '', $display->delivery_time( '', clone $delivery ), 'foreign same-ID rate blank' );
	same( '', $display->delivery_time( '', new WC_Shipping_Rate( 'flat_rate:7:custom', 'flat_rate', 7 ) ), 'no prefix matching' );
	same( '', $display->delivery_time( '', (object) [ 'id' => 'flat_rate:7' ] ), 'invalid rate blank' );
	foreach ( [ [], [ $package, $package ], [ [ 'rates' => $rates ] ], [ [ 'contents' => [], 'rates' => $rates ] ] ] as $packages ) {
		$woo->shipping->packages = $packages;
		same( '', $display->delivery_time( '', $delivery ), 'missing/incomplete/ambiguous packages blank' );
		same( '', classic( $delivery ), 'classic ambiguous packages blank' );
	}
	$woo->shipping->packages = [ 0 => $package ];
	$provider_rate = new WC_Shipping_Rate( 'weight_based_shipping:4:rule', 'weight_based_shipping', 4 );
	$woo->shipping->packages[0]['rates'][ $provider_rate->id ] = $provider_rate;
	same( '', $display->delivery_time( '', $provider_rate ), 'actual provider absent from eligible result stays blank' );
	same( '', classic( $provider_rate ), 'no provider prefix/title fallback' );
	$woo->shipping->packages = [ 0 => $package ];
	$admin = true;
	same( '', $display->delivery_time( '', $delivery ), 'admin suppressed' ); same( '', classic( $delivery ), 'admin classic suppressed' );
	$admin = false;
	if ( 'default' === $mode ) {
		$storefront = false; same( '', $display->delivery_time( '', $delivery ), 'non-store page suppressed' ); $storefront = true;
		$received = true; same( '', classic( $delivery ), 'order-received suppressed' ); $received = false;
		$pay = true; same( '', classic( $delivery ), 'order-pay suppressed' ); $pay = false;
	}
	OverSeek_Delivery_Storefront_Context::$throw = true;
	same( '', $display->delivery_time( '', $delivery ), 'exception preserves blank original' );
	same( '', classic( $delivery ), 'classic exception blank' );
	OverSeek_Delivery_Storefront_Context::$throw = false;
	OverSeek_Delivery_Storefront_Context::$nested = static function () use ( $display, $delivery ): void {
		same( '', $display->delivery_time( '', $delivery ), 'native re-entry blank' );
		same( '', classic( $delivery ), 'cross-hook re-entry blank' );
	};
	same( $expected, $display->delivery_time( '', $delivery ), 'guard released after exception' );
	OverSeek_Delivery_Storefront_Context::$nested = null;
	$saved = OverSeek_Delivery_Storefront_Context::$result;
	foreach ( [ [ 'status' => 'unavailable', 'reason' => 'receipt_safety_unverified' ], [ 'status' => 'unavailable', 'reason' => 'ambiguous_package' ], [ 'status' => 'available', 'methods' => [] ] ] as $result ) {
		OverSeek_Delivery_Storefront_Context::$result = $result;
		same( '', $display->delivery_time( '', $delivery ), 'shared safety/eligibility failure never bypassed' );
		same( '', classic( $pickup ), 'whole-order failure suppresses unselected pickup without empty wrapper' );
	}
	OverSeek_Delivery_Storefront_Context::$result = $saved;
	same( $before, serialize( $woo ), 'packages, provider descriptions, prices, taxes and selection never mutated' );
}
same( 0, $getter_calls, 'never calls delivery getter recursively' );
same( $includes_loaded, get_included_files(), 'lazy dependency checks respect loaded shared-class doubles without includes' );
same( 0, $forbidden, 'no calculation, mutation, network or asset attempts even if exceptions are caught' );
fwrite( STDOUT, 'Delivery cart display (' . $mode . '): ' . $assertions . " assertions passed.\n" );

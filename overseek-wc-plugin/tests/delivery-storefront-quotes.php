<?php
/** Offline native quote-cache/address contracts; optional argv[1] is WC version. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' );
define( 'WC_VERSION', $argv[1] ?? '9.9.0' );
set_error_handler( static function ( int $severity, string $message, string $file, int $line ): void { throw new ErrorException( $message, 0, $severity, $file, $line ); } );
require __DIR__ . '/stubs/delivery-storefront.php';
require __DIR__ . '/../includes/class-overseek-delivery-product-service.php';

$catalogue[10] = new WC_Product( 10 );
$flat = new WC_Shipping_Rate( 'flat_rate:7', '', 0, [], 'flat_rate', 7 );
$pickup = new WC_Shipping_Rate( 'local_pickup:8', '', 0, [], 'local_pickup', 8 );
$settings = [ 'defaultMethod' => [ 'methodId' => 'flat_rate', 'instanceId' => 7 ], 'shippingMethods' => [
	[ 'methodId' => 'flat_rate', 'instanceId' => 7, 'enabled' => true, 'fulfilmentType' => 'delivery', 'minTransitDays' => 1, 'maxTransitDays' => 2 ],
	[ 'methodId' => 'local_pickup', 'instanceId' => 8, 'enabled' => true, 'fulfilmentType' => 'collection', 'minTransitDays' => 0, 'maxTransitDays' => 0 ],
] ];
$calculations = 0;
$service = new OverSeek_Delivery_Product_Service(
	static function ( $cart, $rates ) use ( &$calculations ) {
		++$calculations;
		return [ 'status' => 'available', 'methods' => [ [ 'id' => $rates[0]->get_id(), 'type' => 'local_pickup' === $rates[0]->get_method_id() ? 'pickup' : 'delivery', 'min' => '2026-09-23', 'max' => '2026-09-25' ] ] ];
	},
	static fn() => [ 'revision' => 1, 'payload' => [ 'enabled' => true, 'settings' => $settings ] ]
);
$item = [ 'request_id' => 'estimate', 'product_id' => 10, 'variation_id' => 0, 'quantity' => 2 ];
$estimate = static fn() => $service->batch( [ $item ] )[0]['html'];
foreach ( [ [ 'AU', 'NSW' ], [ 'GB', 'LND' ], [ '', '' ] ] as [ $country, $state ] ) {
	$woo->customer->destination['country'] = $country; $woo->customer->destination['state'] = $state;
	same( false, OverSeek_Delivery_Storefront_Context::has_known_address(), 'guest defaults/geolocation are not address evidence' );
	same( true, str_contains( $estimate(), 'configured default method' ), 'guest default core method despite default country' );
}
$woo->customer->id = 42;
same( false, OverSeek_Delivery_Storefront_Context::has_known_address(), 'login alone is not a shipping address' );
$woo->customer->destination = [ 'country' => 'AU', 'state' => 'NSW', 'postcode' => '2000', 'city' => 'Sydney', 'address' => '1 Test St', 'address_2' => '' ];
same( true, OverSeek_Delivery_Storefront_Context::has_known_address(), 'logged-in saved shipping address without calculated flag' );
same( '', $estimate(), 'known saved address without quotes is blank, never default stand-in' );
$woo->customer->id = 0;
same( true, OverSeek_Delivery_Storefront_Context::has_known_address(), 'Woo session entered address is evidence for guests too' );
$woo->customer->destination = [ 'country' => 'AU', 'state' => 'NSW', 'postcode' => '', 'city' => '', 'address' => '', 'address_2' => '' ];
$woo->customer->calculated = true;
same( true, OverSeek_Delivery_Storefront_Context::has_known_address(), 'explicit Woo calculated_shipping is positive evidence' );

// Native 9.7/9.9/10.x JSON preimage: insertion order retained, rates initialized to [],
// product data removed, all remaining fields included. Literal fixture is independent
// of our hash implementation. Native 11.0/11.1 removes the rates key before encoding.
$json = '{"contents":{"a":{"product_id":10,"variation_id":0,"quantity":2,"line_total":20,"line_tax":0}},"contents_cost":20,"applied_coupons":["SAVE"],"user":{"ID":42},"destination":{"country":"AU","state":"NSW","postcode":"2000","city":"Sydney","address":"1 Test St","address_2":""},"cart_subtotal":25}';
$package = json_decode( $json, true );
$package['contents']['a']['data'] = $catalogue[10];
$woo->customer->id = 42; $woo->customer->destination = $package['destination'];
$woo->cart->lines = $package['contents']; $woo->cart->packages = [ $package ];
$options['_transient_shipping-transient-version'] = '1750000000';
$preimage = version_compare( WC_VERSION, '11.0.0', '>=' ) ? $json : substr( $json, 0, -1 ) . ',"rates":[]}';
$quote = [ 'package_hash' => 'wc_ship_' . md5( $preimage . '1750000000' ), 'rates' => [ $flat->id => $flat, $pickup->id => $pickup ] ];
$woo->session->values['shipping_for_package_0'] = $quote; $woo->session->chosen = [ $pickup->id ];
if ( version_compare( WC_VERSION, '9.7.0', '<' ) || version_compare( WC_VERSION, '11.2.0', '>=' ) || str_contains( WC_VERSION, '-' ) ) {
	same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'unreviewed cache format rejected' );
	fwrite( STDOUT, 'Delivery storefront quotes (' . WC_VERSION . '): ' . $assertions . " assertions passed.\n" );
	exit;
}
$before = serialize( [ $woo->session, $woo->cart, $woo->customer, $woo->shipping, $options ] );
same( $quote['rates'], OverSeek_Delivery_Storefront_Context::current_package()['rates'] ?? null, 'returned checkout session native hash valid with empty loaded packages' );
same( true, str_contains( $estimate(), 'Ready for collection' ), 'verified cached previous method preferred' );
same( false, str_contains( $estimate(), 'configured default method' ), 'known cache is not a synthetic default' );
same( $before, serialize( [ $woo->session, $woo->cart, $woo->customer, $woo->shipping, $options ] ), 'all successful quote reads leave WC/session/options unchanged' );
$woo->session->chosen = [ 'absent' ];
same( true, str_contains( $estimate(), 'Estimated delivery' ), 'verified cached configured default fallback' );
$woo->shipping->packages = [ $package + [ 'rates' => [ $flat->id => $flat ] ] ];
same( [ $flat->id => $flat ], OverSeek_Delivery_Storefront_Context::current_package()['rates'] ?? null, 'loaded current package preferred over session quote' );
$woo->shipping->packages[0]['destination']['postcode'] = '9999';
same( '', $estimate(), 'stale loaded package cannot revive cached quote' );
$woo->shipping->packages = [];

foreach ( [ 'destination', 'quantity', 'variation', 'cost', 'coupon', 'user', 'cart_subtotal' ] as $change ) {
	$current = $package;
	switch ( $change ) {
		case 'destination': $current['destination']['postcode'] = '3000'; $woo->customer->destination = $current['destination']; break;
		case 'quantity': $current['contents']['a']['quantity'] = 3; break;
		case 'variation': $current['contents']['a']['variation_id'] = 11; break;
		case 'cost': $current['contents']['a']['line_total'] = 19; $current['contents_cost'] = 19; break;
		case 'coupon': $current['applied_coupons'] = [ 'OTHER' ]; break;
		case 'user': $current['user']['ID'] = 99; break;
		case 'cart_subtotal': $current['cart_subtotal'] = 26; break;
	}
	$woo->cart->lines = $current['contents']; $woo->cart->packages = [ $current ];
	same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'exact native hash rejects changed ' . $change );
	same( '', $estimate(), 'changed ' . $change . ' produces no optimistic product estimate' );
	$woo->customer->destination = $package['destination'];
}
$woo->cart->lines = $package['contents']; $woo->cart->packages = [ $package ];
$options['woocommerce_shipping_debug_mode'] = 'yes';
same( '', $estimate(), 'debug mode rejects session quote' );
$woo->shipping->packages = [ $package + [ 'rates' => $quote['rates'] ] ];
same( '', $estimate(), 'debug mode rejects loaded rates too' );
$woo->shipping->packages = []; unset( $options['woocommerce_shipping_debug_mode'] );
foreach ( [ false, '1750000001' ] as $version ) {
	$options['_transient_shipping-transient-version'] = $version;
	same( '', $estimate(), 'missing/invalidated shipping version blank without initializing it' );
}
$options['_transient_shipping-transient-version'] = '1750000000';
$options['_transient_timeout_shipping-transient-version'] = time() - 1;
same( '', $estimate(), 'expired version blank without deleting transient' );
unset( $options['_transient_timeout_shipping-transient-version'] );
$external_cache = true; $cached_version = '1750000000';
same( true, '' !== $estimate(), 'external object-cache shipping version supported' );
$cached_version = false;
same( '', $estimate(), 'external cache miss does not fall back to stale DB version' );
$external_cache = false;
$filters['pre_transient_shipping-transient-version'] = 10;
same( '', $estimate(), 'filtered transient version unsupported' ); $filters = [];
if ( version_compare( WC_VERSION, '11.0.0', '>=' ) ) {
	$filters['woocommerce_shipping_package_hash_ignored_fields'] = 10;
	same( '', $estimate(), 'custom native hash ignore policy rejected' ); $filters = [];
}
foreach ( [ [], [ 'package_hash' => 'wrong', 'rates' => $quote['rates'] ], [ 'package_hash' => $quote['package_hash'], 'rates' => [] ], [ 'package_hash' => $quote['package_hash'], 'rates' => [ 'wrong-id' => $flat ] ] ] as $bad_quote ) {
	$woo->session->values['shipping_for_package_0'] = $bad_quote;
	same( '', $estimate(), 'missing/mismatched/empty/malformed quote is blank' );
}
$woo->session->values['shipping_for_package_0'] = $quote;
$woo->cart->lines['b'] = $package['contents']['a'];
same( '', $estimate(), 'valid quote for partial cart rejected' );
$woo->cart->lines = $package['contents']; $woo->cart->packages[] = $package;
same( '', $estimate(), 'valid quote with multiple current packages rejected' );
$woo->cart->packages = [ $package ]; $woo->customer->destination['postcode'] = '9999';
same( '', $estimate(), 'valid quote/current package but customer destination mismatch rejected' );
same( false, OverSeek_Delivery_Storefront_Gate::is_active(), 'all internal tests leave production gate false' );
fwrite( STDOUT, 'Delivery storefront quotes (' . WC_VERSION . '): ' . $assertions . " assertions passed.\n" );

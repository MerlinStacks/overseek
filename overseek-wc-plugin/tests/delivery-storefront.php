<?php
/** Standalone shared presentation/product boundary contracts. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' );
define( 'OVERSEEK_WC_VERSION', 'test-release' );
set_error_handler( static function ( int $severity, string $message, string $file, int $line ): void { throw new ErrorException( $message, 0, $severity, $file, $line ); } );
require __DIR__ . '/stubs/delivery-storefront.php';
require __DIR__ . '/../includes/class-overseek-delivery-product.php';
require __DIR__ . '/../includes/class-overseek-delivery-product-service.php';

OverSeek_Delivery_Product::register(); OverSeek_Delivery_Product::register();
same( 1, count( $hooks['init'] ), 'idempotent registration' );
same( [ 'init', 'wc_ajax_overseek_delivery_estimates' ], array_keys( $hooks ), 'no automatic placement' );
OverSeek_Delivery_Product::register_placements();
same( OVERSEEK_WC_VERSION, $registered_scripts['overseek-delivery-editor'][3], 'editor asset release cache busting' );
same( true, isset( $hooks['overseek_delivery_estimate'] ), 'shortcode' );
same( false, OverSeek_Delivery_Storefront_Gate::is_active(), 'unlinked/inactive local gate' );
same( '', OverSeek_Delivery_Product::render_block( [ 'enabled' => true, 'productId' => 10 ] ), 'block inactive' );
same( '', OverSeek_Delivery_Product::shortcode( [ 'active' => '1', 'product_id' => 10 ] ), 'shortcode inactive' );
same( 'unavailable', OverSeek_Delivery_Storefront_Context::cart_result( [] )['status'], 'cart inactive' );
$_POST = [ 'active' => true, 'items' => 'malformed' ];
OverSeek_Delivery_Product::ajax();
same( [ 'items' => [] ], $json, 'AJAX gate before parse' );
same( true, $no_cache, 'no-store response helper' );
same( 5, $reads, 'one linked-account lookup per inactive gate, no Woo/settings/catalogue reads' );

$result = [ 'status' => 'available', 'methods' => [ [ 'id' => 'flat_rate:7', 'type' => 'delivery', 'min' => '2026-09-23', 'max' => '2026-09-25' ] ] ];
same( 'Estimated delivery: 2026-09-23 – 2026-09-25', OverSeek_Delivery_Display::method_text( $result, 'flat_rate:7' ), 'date labels unchanged' );
same( '', OverSeek_Delivery_Display::method_text( $result, 'other' ), 'missing rate blank' );
$bad = $result; $bad['methods'][] = $bad['methods'][0];
same( '', OverSeek_Delivery_Display::method_text( $bad, 'flat_rate:7' ), 'duplicate method blank' );
foreach ( [ '2026-02-30', '2026-09-26', '<script>', '2026-09-23T00:00:00Z' ] as $date ) {
	$bad = $result; $bad['methods'][0]['min'] = $date;
	same( '', OverSeek_Delivery_Display::method_text( $bad, 'flat_rate:7' ), 'invalid/reversed date' );
}
$pickup = $result; $pickup['methods'][0]['type'] = 'pickup'; $pickup['methods'][0]['max'] = '2026-09-23';
same( 'Ready for collection: 2026-09-23', OverSeek_Delivery_Display::method_text( $pickup, 'flat_rate:7' ), 'pickup single day' );
$html = OverSeek_Delivery_Display::method_html( $result, 'flat_rate:7', [ 'textColor' => '#abcdef', 'accentColor' => 'red;position:fixed', 'fontSize' => 999, 'backgroundColor' => 'url(https://bad)', 'showIcon' => '<img>', 'spacing' => 'comfortable' ] );
same( true, str_contains( $html, 'font-family:inherit' ) && str_contains( $html, 'font-size:14px' ) && str_contains( $html, 'color:#abcdef' ), 'bounded compact styles' );
same( false, str_contains( $html, 'position:fixed' ) || str_contains( $html, 'url(' ) || str_contains( $html, '<img' ), 'branding CSS injection blocked' );
$date_format = '\<\b\>Y-m-d';
same( true, str_contains( OverSeek_Delivery_Display::method_html( $result, 'flat_rate:7' ), '&lt;b&gt;' ), 'date format escaped' );
unset( $date_format );

$settings = [ 'defaultMethod' => [ 'methodId' => 'flat_rate', 'instanceId' => 7 ], 'shippingMethods' => [] ];
foreach ( [ [ 'flat_rate', 7, 'delivery' ], [ 'local_pickup', 8, 'collection' ], [ 'free_shipping', 9, 'delivery' ] ] as [ $method, $id, $type ] ) {
	$settings['shippingMethods'][] = [ 'methodId' => $method, 'instanceId' => $id, 'enabled' => true, 'fulfilmentType' => $type, 'minTransitDays' => 1, 'maxTransitDays' => 2 ];
}
$flat = new WC_Shipping_Rate( 'flat_rate:7', '', 0, [], 'flat_rate', 7 );
$pick = new WC_Shipping_Rate( 'local_pickup:8', '', 0, [], 'local_pickup', 8 );
$free = new WC_Shipping_Rate( 'free_shipping:9', '', 0, [], 'free_shipping', 9 );
$select = [ OverSeek_Delivery_Product_Service::class, 'select_rate' ];
same( 'flat_rate:7', $select( $settings, true, null, '' )->get_id(), 'unknown default core' );
same( $pick, $select( $settings, false, [ 'rates' => [ $flat->id => $flat, $pick->id => $pick ] ], $pick->id ), 'valid previous first' );
same( $flat, $select( $settings, false, [ 'rates' => [ $flat->id => $flat ] ], 'missing' ), 'default present fallback' );
same( null, $select( $settings, false, [ 'rates' => [ $free->id => $free ] ], 'missing' ), 'no third service' );
$provider = $settings; $provider['defaultMethod']['methodId'] = 'weight_based_shipping';
same( null, $select( $provider, true, null, '' ), 'WBS unsupported' );

$catalogue[10] = new WC_Product( 10 );
$calls = 0; $input_reads = 0; $last_cart = null;
$service = new OverSeek_Delivery_Product_Service(
	static function ( $cart, $rates ) use ( &$calls, &$last_cart, $result ) { ++$calls; $last_cart = $cart; return $result; },
	static function () use ( &$input_reads, $settings ) { ++$input_reads; return [ 'revision' => 1, 'payload' => [ 'enabled' => true, 'settings' => $settings ] ]; }
);
$item = [ 'request_id' => 'one', 'product_id' => 10, 'variation_id' => 0, 'quantity' => 2 ];
$batch = $service->batch( [ $item, array_replace( $item, [ 'request_id' => 'two' ] ) ] );
same( 1, $calls, 'per-request dedupe' );
same( true, str_contains( $batch[0]['html'], 'configured default method' ), 'unknown explicitly qualified' );
same( [ 'request_id', 'product_id', 'variation_id', 'html' ], array_keys( $batch[0] ), 'safe response fields only' );
same( 2, $last_cart[0]['quantity'], 'quantity forwarded' );
$service->batch( [ array_replace( $item, [ 'quantity' => 4 ] ) ] );
same( 2, $calls, 'no cross-call result cache' );
same( 4, $last_cart[0]['quantity'], 'changed quantity re-read' );
foreach ( [ 0, -1, 1.5, true, '1e2', 1000001 ] as $qty ) {
	same( [], $service->batch( [ array_replace( $item, [ 'quantity' => $qty ] ) ] ), 'quantity rejected' );
}
same( [], $service->batch( array_fill( 0, 21, $item ) ), 'batch bounded' );
same( [], $service->batch( str_repeat( 'a', 8193 ) ), 'body bounded' );
same( [], $service->batch( [ $item, $item ] ), 'duplicate request identity rejected' );
$before = $input_reads;
foreach ( [ 'draft', 'private', 'trash' ] as $status ) {
	$catalogue[10]->status = $status;
	same( '', $service->batch( [ $item ] )[0]['html'], 'non-public product' );
}
$catalogue[10]->status = 'publish'; $passwords[10] = 'secret';
same( '', $service->batch( [ $item ] )[0]['html'], 'password protected product' );
same( $before, $input_reads, 'private inputs never read for blocked products' );
unset( $passwords[10] );
$catalogue[10]->type = 'variable'; $catalogue[11] = new WC_Product_Variation( 11 ); $catalogue[11]->parent = 99;
same( '', $service->batch( [ $item ] )[0]['html'], 'unselected variable product blank' );
$variant = array_replace( $item, [ 'variation_id' => 11 ] );
same( '', $service->batch( [ $variant ] )[0]['html'], 'wrong variation parent' );
$catalogue[11]->parent = 10; $catalogue[11]->type = 'variation';
same( true, '' !== $service->batch( [ $variant ] )[0]['html'], 'valid variation' );
same( 11, $last_cart[0]['variation_id'], 'variation identity forwarded' );
$catalogue[11]->active = false;
same( '', $service->batch( [ $variant ] )[0]['html'], 'disabled variation blank' );
$catalogue[11]->active = true;
$passwords[11] = 'secret';
same( '', $service->batch( [ $variant ] )[0]['html'], 'variation password blocked' );
unset( $passwords[11] ); $catalogue[10]->type = 'simple';

$woo->customer->destination['country'] = 'AU';
$woo->customer->calculated = true;
$woo->cart->lines = [ 'a' => [ 'data' => $catalogue[10], 'product_id' => 10, 'variation_id' => 0, 'quantity' => 2 ] ];
$package = [ 'contents' => $woo->cart->lines, 'destination' => $woo->customer->destination, 'contents_cost' => 20 ];
$woo->cart->packages = [ $package ]; $woo->shipping->packages = [ $package + [ 'rates' => [ $flat->id => $flat ] ] ];
same( true, null !== OverSeek_Delivery_Storefront_Context::current_package(), 'single complete matching package' );
same( false, str_contains( $service->batch( [ $item ] )[0]['html'], 'configured default method' ), 'known destination actual default' );
same( 'rate_not_current', OverSeek_Delivery_Storefront_Context::resolve_cart( [ clone $flat ] )['reason'], 'reject injected rate objects' );
same( 'rate_not_current', OverSeek_Delivery_Storefront_Context::resolve_cart( [ $flat, $flat ] )['reason'], 'reject duplicate rates' );
$woo->cart->lines['b'] = $woo->cart->lines['a'];
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'partial shipment rejected' );
unset( $woo->cart->lines['b'] );
$woo->cart->lines['a']['variation_id'] = 11;
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'changed variation invalidates package' );
$woo->cart->lines['a']['variation_id'] = 0;
$woo->cart->lines['a']['quantity'] = 3;
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'changed quantity invalidates package' );
$woo->cart->lines['a']['quantity'] = 2;
$woo->cart->packages[0]['contents_cost'] = 21;
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'changed costs invalidate rates' );
$woo->cart->packages[0]['contents_cost'] = 20;
$woo->customer->destination['postcode'] = '2000';
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'destination mismatch' );
same( '', $service->batch( [ $item ] )[0]['html'], 'known unmatched destination blank' );
$woo->customer->destination['postcode'] = '';
$woo->cart->packages[] = $package;
same( null, OverSeek_Delivery_Storefront_Context::current_package(), 'multiple packages blank' );
$woo->customer->destination['country'] = '';
same( '', $service->batch( [ $item ] )[0]['html'], 'multiple packages unknown also blank' );
fwrite( STDOUT, 'Delivery storefront: ' . $assertions . " assertions passed.\n" );

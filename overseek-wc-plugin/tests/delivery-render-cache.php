<?php
/** Full common/context + classic/native callbacks, with real gate and adapter. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' ); define( 'ARRAY_A', 'ARRAY_A' ); define( 'WC_VERSION', '11.1.0' );
set_error_handler( static function ( int $severity, string $message, string $file, int $line ): void { throw new ErrorException( $message, 0, $severity, $file, $line ); } );
require __DIR__ . '/stubs/delivery-render-cache.php';
require __DIR__ . '/../includes/class-overseek-delivery-storefront-context.php';
require __DIR__ . '/../includes/class-overseek-delivery-display.php';
require __DIR__ . '/../includes/class-overseek-delivery-cart-display.php';
$display = new OverSeek_Delivery_Cart_Display();
$settings = [ 'timezone' => 'UTC', 'cutoffTime' => '14:00', 'productionWeekdays' => [1,2,3,4,5], 'transitWeekdays' => [1,2,3,4,5], 'closures' => [], 'fallbackSupplierLeadTimeDays' => 30, 'shippingMethods' => [], 'defaultMethod' => null ];
$rates = [];
for ( $i = 1; $i <= 20; ++$i ) {
	$id = 'flat_rate:' . $i; $rates[$id] = new Render_Rate( $id, '', 0, [], 'flat_rate', $i );
	$settings['shippingMethods'][] = [ 'methodId' => 'flat_rate', 'instanceId' => $i, 'enabled' => true, 'fulfilmentType' => 'delivery', 'minTransitDays' => 1, 'maxTransitDays' => 2 ];
}
$clock = new DateTimeImmutable( '-1 hour', new DateTimeZone( 'UTC' ) );
$wpdb->rows = [
	'control:0' => [ 'revision' => 1, 'payload' => [ 'active' => true, 'mode' => 'guarded', 'epoch' => 'epoch', 'settingsRevision' => 1, 'environmentFingerprint' => OverSeek_Delivery_Control::fingerprint() ] ],
	'settings:0' => [ 'revision' => 1, 'payload' => [ 'enabled' => true, 'settings' => $settings ] ],
	'product:10' => [ 'revision' => 1, 'payload' => [ 'wooId' => 10, 'productionMinDays' => 1, 'productionMaxDays' => 2, 'variations' => [] ] ],
	'inbound:10' => [ 'revision' => 1, 'payload' => [ 'wooId' => 10, 'receiptSafety' => 'verified', 'receiptProof' => [ 'version' => 1, 'epoch' => 'epoch', 'owners' => [ [ 'stockOwnerWooId' => 10, 'sequence' => 0, 'operationId' => 'baseline_epoch' ] ] ],
		'generatedAt' => $clock->format( 'Y-m-d\TH:i:s\Z' ), 'expiresAt' => $clock->modify( '+24 hours' )->format( 'Y-m-d\TH:i:s\Z' ), 'targets' => [ [ 'wooId' => 10, 'stockOwnerWooId' => 10, 'state' => 'pending', 'supplierLead' => null, 'batches' => [] ] ] ] ],
];
$catalogue[10] = new Render_Product( 10 );
$woo->cart->lines = [ 'item' => [ 'data' => $catalogue[10], 'product_id' => 10, 'variation_id' => 0, 'quantity' => 1 ] ];
$woo->customer->destination['country'] = 'AU';
function package_refresh(): void {
	$woo = WC();
	$package = [ 'contents' => $woo->cart->lines, 'destination' => $woo->customer->destination, 'applied_coupons' => $GLOBALS['coupons'] ?? [], 'contents_cost' => 10, 'user' => [ 'ID' => 0 ] ];
	$woo->cart->packages = [ $package ]; $woo->shipping->packages = [ $package + [ 'rates' => $GLOBALS['rates'] ] ];
}
package_refresh();
foreach ( $rates as $rate ) { same( true, str_starts_with( $rate->get_delivery_time(), 'Estimated delivery:' ), 'native option estimate' ); }
same( 1, $wpdb->product_reads, '20 native getters calculate the complete rate set once' );
$queries20 = $wpdb->num_queries;
same( true, $queries20 < 100, 'managed single-owner render bounded well below 19 queries per rate' );
foreach ( $rates as $rate ) { ob_start(); $display->after_shipping_rate( $rate, 0 ); $html = ob_get_clean(); same( true, str_contains( $html, 'Estimated delivery:' ), 'classic renderer reuses same result' ); }
same( 1, $wpdb->product_reads, 'classic and Blocks share one calculation' );
$rates['other:9'] = new Render_Rate( 'other:9', '', 0, [], 'other', 9 ); package_refresh();
same( '', $rates['other:9']->get_delivery_time(), 'unmapped callback stays blank' );
$calls = $wpdb->product_reads;
for ( $i = 0; $i < 20; ++$i ) { same( '', $rates['other:9']->get_delivery_time(), 'unmapped option cache hit' ); }
same( $calls, $wpdb->product_reads, 'unmapped callbacks do not recalculate' );
foreach ( [ 'quantity', 'address', 'coupon', 'rate_cost', 'rate_metadata', 'production_revision', 'inbound_revision', 'live_stock', 'object_stock', 'held' ] as $change ) {
	$before = $wpdb->product_reads;
	switch ( $change ) {
		case 'quantity': $woo->cart->lines['item']['quantity'] = 2; break;
		case 'address': $woo->customer->destination['postcode'] = '2000'; break;
		case 'coupon': $coupons = [ 'TEST' ]; break;
		case 'rate_cost': $rates['flat_rate:1']->cost = '11'; break;
		case 'rate_metadata': $rates['flat_rate:1']->metadata = [ 'rule' => 'changed' ]; break;
		case 'production_revision': ++$wpdb->rows['product:10']['revision']; break;
		case 'inbound_revision': ++$wpdb->rows['inbound:10']['revision']; break;
		case 'live_stock': $wpdb->stock['_stock'] = '19'; break;
		case 'object_stock': $catalogue[10]->stock = 19; break;
		case 'held': $held = [ 0 => 1 ]; break;
	}
	package_refresh();
	same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), $change . ' recomputed safely' );
	same( $before + 1, $wpdb->product_reads, $change . ' invalidates' );
}
$wpdb->guard['guard_active'] = '1';
same( '', $rates['flat_rate:1']->get_delivery_time(), 'new pending guard cannot reuse available dates' );
$pending_calls = $wpdb->product_reads;
same( '', $rates['flat_rate:2']->get_delivery_time(), 'pending unavailable reused only behind current guard check' );
same( $pending_calls, $wpdb->product_reads, 'pending result does not repeat full calculation' );
$wpdb->guard['guard_active'] = '0'; $wpdb->guard['sequence'] = '1'; $wpdb->guard['operation_id'] = 'new_receipt';
same( '', $rates['flat_rate:1']->get_delivery_time(), 'cleared guard with newer sequence still rejects old proof' );
$wpdb->rows['inbound:10']['payload']['receiptProof']['owners'][0] = [ 'stockOwnerWooId' => 10, 'sequence' => 1, 'operationId' => 'new_receipt' ]; ++$wpdb->rows['inbound:10']['revision'];
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'matching new proof enables a new calculation only' );
$held_hook = static function () use ( $wpdb ) { $wpdb->guard['guard_active'] = '1'; $GLOBALS['held_hook'] = null; };
same( '', $rates['flat_rate:1']->get_delivery_time(), 'guard change during native held read fails closed' );
$wpdb->guard['guard_active'] = '0';
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'cache cleared after incoherent fence' );
$wpdb->rows['settings:0']['revision'] = 2;
same( '', $rates['flat_rate:1']->get_delivery_time(), 'settings revision without matching activation is inactive' );
$wpdb->rows['control:0']['payload']['settingsRevision'] = 2; ++$wpdb->rows['control:0']['revision'];
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'matching activation revision permits fresh calculation' );
$expiry = new DateTimeImmutable( $wpdb->rows['inbound:10']['payload']['expiresAt'] );
same( false, OverSeek_Delivery_Render_Token::read( 'linked', [10], $expiry->modify( '-1 second' ) ) === OverSeek_Delivery_Render_Token::read( 'linked', [10], $expiry ), 'expiry boundary invalidates without an input write' );
$orders[55] = new class {
	public $status = 'pending';
	public function get_status() { return $this->status; }
	public function has_status( $values ) { return in_array( $this->status, $values, true ); }
	public function get_cart_hash() { return WC()->cart->get_cart_hash(); }
};
$woo->session->values['order_awaiting_payment'] = 55; $held[55] = 0;
$before = $wpdb->product_reads;
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'hash-matching own reservation exclusion stays supported' );
same( $before + 1, $wpdb->product_reads, 'held exclusion order invalidates key' );
$orders[55]->status = 'completed';
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'changed order status recomputes native held context' );
same( $before + 2, $wpdb->product_reads, 'order status invalidates exclusion key' );
$before = $wpdb->product_reads;
same( '', $display->delivery_time( '', clone $rates['flat_rate:1'] ), 'foreign callback cannot access cached result' );
same( $before, $wpdb->product_reads, 'foreign callback avoids adapter' );
$options['overseek_delivery_environment_generation'] = 'changed';
same( '', $rates['flat_rate:1']->get_delivery_time(), 'environment activation fingerprint invalidates warmed result' );
same( $before, $wpdb->product_reads, 'invalid environment never calls adapter' );
unset( $options['overseek_delivery_environment_generation'] );
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'valid environment creates a new snapshot' );
$options['overseek_account_id'] = 'other';
same( '', $rates['flat_rate:1']->get_delivery_time(), 'account change cannot reuse dates' );
$options['overseek_account_id'] = 'linked';
same( true, '' !== $rates['flat_rate:1']->get_delivery_time(), 'original account calculates again after account switch' );
$before = $wpdb->product_reads;
$wpdb->rows['control:0']['payload']['active'] = false; ++$wpdb->rows['control:0']['revision'];
same( '', $rates['flat_rate:1']->get_delivery_time(), 'disable invalidates warmed cache' );
same( $before, $wpdb->product_reads, 'disabled never calls adapter' );
$queries = $wpdb->num_queries;
same( '', $rates['flat_rate:2']->get_delivery_time(), 'subsequent inactive callback stays blank' );
same( true, $wpdb->num_queries - $queries <= 2, 'inactive admission uses bounded control reads' );
fwrite( STDOUT, 'Delivery render cache: ' . $assertions . ' assertions; native 20-rate managed probe: 1 calculation, ' . $queries20 . " modeled queries.\n" );

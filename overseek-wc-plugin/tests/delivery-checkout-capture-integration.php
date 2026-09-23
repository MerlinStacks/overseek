<?php
/** Native Woo checkout integration; disposable wordpress_tests DB only. @package OverSeek */
declare(strict_types=1);

if ( ! defined( 'WP_CLI' ) || ! WP_CLI || '1' !== getenv( 'OVERSEEK_RUN_DISPOSABLE_DB_TESTS' ) || ! defined( 'DB_NAME' ) || 'wordpress_tests' !== DB_NAME ) {
	throw new RuntimeException( 'Requires WP-CLI, OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 and DB_NAME=wordpress_tests.' );
}
global $wpdb;
if ( 'wordpress_tests' !== $wpdb->get_var( 'SELECT DATABASE()' ) || ! class_exists( 'WooCommerce' ) ) {
	throw new RuntimeException( 'Requires actual disposable MySQL and active WooCommerce.' );
}
require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-delivery-storefront-context.php';
require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-delivery-order-snapshot.php';
require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-delivery-checkout-capture.php';
if ( ! OverSeek_Delivery_Storefront_Gate::is_active() ) {
	throw new RuntimeException( 'Complete real disposable-store cutover/activation and input sync first. This harness never bypasses the gate.' );
}
$product_id = (int) getenv( 'OVERSEEK_CHECKOUT_PRODUCT_ID' );
$rate_id = getenv( 'OVERSEEK_CHECKOUT_RATE_ID' );
$product = wc_get_product( $product_id );
if ( ! $product || ! $product->is_type( 'simple' ) || ! $product->needs_shipping() || 0.0 !== (float) $product->get_price() || ! $rate_id ) {
	throw new RuntimeException( 'Supply a synced physical simple product with zero price and an actual zero-cost configured rate ID.' );
}
$managed = $product->managing_stock();
$proof = null;
if ( $managed ) {
	$input = ( new OverSeek_Delivery_Input_Storage() )->read_inbound( $product_id );
	$proof = $input['payload']['receiptProof'] ?? null;
	if ( 'verified' !== ( $input['payload']['receiptSafety'] ?? null ) || ! is_array( $proof ) || $product->backorders_allowed() || (int) $product->get_stock_quantity() < 4 || 'yes' !== get_option( 'woocommerce_manage_stock' ) || (int) get_option( 'woocommerce_hold_stock_minutes', 60 ) <= 0 ) {
		throw new RuntimeException( 'Managed fixture requires already-certified verified inputs, stock >= 4, backorders disabled, and enabled native stock reservations. No proof/guard is manufactured by this harness.' );
	}
	// This read checks the real current epoch, owner guard, sequence and live stock.
	$certified = OverSeek_Delivery_Stock_Snapshot::read( get_option( 'overseek_account_id' ), $product, $proof );
	if ( $certified['quantity'] < 4 || 0 !== $certified['prior_demand'] ) {
		throw new RuntimeException( 'Managed fixture needs at least four certified units and no pre-existing reservations.' );
	}
}
if ( ! WC()->session ) { WC()->initialize_session(); }
if ( ! WC()->cart ) { WC()->initialize_cart(); }
OverSeek_Delivery_Checkout_Capture::register();
$orders = []; $calls = 0; $checks = 0;
$created_orders = [];
$track_created = static function ( $id ) use ( &$created_orders ) { $created_orders[] = $id; };
$original_post = $_POST;
$original_request = $_REQUEST;
$original_request_method = $_SERVER['REQUEST_METHOD'] ?? null;
$expected = [];
$assert = static function ( $valid, $message ) use ( &$checks ) { ++$checks; if ( ! $valid ) { throw new RuntimeException( $message ); } };
$deny_http = static function () use ( &$calls ) { ++$calls; return new WP_Error( 'test_no_network', 'Checkout harness forbids outbound HTTP.' ); };
add_filter( 'pre_http_request', $deny_http, PHP_INT_MAX );
$address = [ 'first_name' => 'Checkout', 'last_name' => 'Fixture', 'company' => '', 'address_1' => '1 Test Street', 'address_2' => '', 'city' => 'Sydney', 'state' => 'NSW', 'postcode' => '2000', 'country' => 'AU' ];
$setup = static function () use ( $product_id, $rate_id, $address, $assert ) {
	WC()->cart->empty_cart(); wc_clear_notices();
	WC()->session->set( 'order_awaiting_payment', 0 );
	WC()->session->set( 'store_api_draft_order', 0 );
	foreach ( [ 'billing', 'shipping' ] as $type ) { foreach ( $address as $key => $value ) { WC()->customer->{ 'set_' . $type . '_' . $key }( $value ); } }
	WC()->customer->set_billing_email( 'checkout@example.test' );
	WC()->customer->set_calculated_shipping( true ); WC()->customer->save();
	WC()->cart->add_to_cart( $product_id, 2 );
	WC()->session->set( 'chosen_shipping_methods', [ $rate_id ] );
	// Native checkout setup may calculate shipping. Capture itself must not.
	WC()->cart->calculate_totals();
	$package = OverSeek_Delivery_Storefront_Context::current_package();
	$assert( $package && isset( $package['rates'][$rate_id] ), 'Configured rate must actually be offered for the fixture destination.' );
	$assert( 0.0 === (float) WC()->cart->get_total( 'edit' ), 'Zero-total fixture required: no payment gateway is called.' );
	$result = OverSeek_Delivery_Storefront_Context::cart_result( $package['rates'] );
	$assert( 'available' === ( $result['status'] ?? null ), 'Fixture needs real available local inputs: ' . wp_json_encode( $result ) );
};
$verify = static function ( $id ) use ( $assert, $rate_id, &$expected ) {
	$order = new WC_Order( $id ); $order->read_meta_data( true );
	$snapshot = OverSeek_Delivery_Order_Snapshot::parse( $order->get_meta( OverSeek_Delivery_Order_Snapshot::META_KEY, true ) );
	$assert( $snapshot && $snapshot['method']['rateId'] === $rate_id, 'Actual chosen-rate snapshot persisted by Woo CRUD.' );
	$assert( isset( $expected[$id] ) && $snapshot === $expected[$id], 'Saved promise equals the complete-cart chosen-rate estimate at the native processed hook.' );
	return $snapshot;
};
// Stop classic AFTER the real capture callback, before zero-payment redirect/exit.
// WC_Checkout catches this sentinel like a gateway failure; the order remains saved.
$stop_classic = static function ( $id ) use ( &$orders ) { $orders[] = $id; throw new RuntimeException( 'fixture_stop_before_payment' ); };
$observe_blocks = static function ( $order ) use ( &$orders ) { $orders[] = $order->get_id(); };
$observe_estimate = static function ( $order ) use ( $assert, $rate_id, &$expected, $managed, $product ) {
	$assert( $order->get_cart_hash() === WC()->cart->get_cart_hash(), 'Native submitted order retains the actual cart hash.' );
	$package = OverSeek_Delivery_Storefront_Context::current_package();
	$result = $package ? OverSeek_Delivery_Storefront_Context::cart_result( $package['rates'] ) : [];
	$assert( 'available' === ( $result['status'] ?? null ), 'Native processed hook has an available complete-cart estimate: ' . wp_json_encode( $result ) );
	if ( $managed ) {
		$assert( (int) wc_get_held_stock_quantity( $product ) - (int) wc_get_held_stock_quantity( $product, $order->get_id() ) === 2, 'Native submitted order really holds its two units before capture/payment.' );
	}
	$fresh = new WC_Order( $order->get_id() );
	$snapshot = OverSeek_Delivery_Order_Snapshot::parse( $fresh->get_meta( OverSeek_Delivery_Order_Snapshot::META_KEY, true ) );
	$assert( null !== $snapshot, 'Production callback persisted a snapshot before subsequent processed callbacks.' );
	$assert( [ $rate_id ] === array_values( WC()->session->get( 'chosen_shipping_methods', [] ) ) && isset( $package['rates'][$rate_id] ), 'Session still selects the actual current-package fixture rate.' );
	$rate = $package['rates'][$rate_id];
	$instance = (int) $rate->get_instance_id();
	if ( -1 === $instance && in_array( $rate->get_method_id(), [ 'wbs', 'wbsng' ], true ) ) { $instance = 0; }
	$method = [ 'methodId' => $rate->get_method_id(), 'instanceId' => $instance, 'rateId' => $rate->get_id(), 'title' => $rate->get_label() ];
	$selected = array_values( array_filter( $result['methods'], static fn( $row ) => $row['id'] === $rate_id ) );
	$assert( 1 === count( $selected ), 'Exactly one actual selected-rate estimate exists.' );
	$expected[$order->get_id()] = OverSeek_Delivery_Order_Snapshot::build( $result, $method, 'pickup' === $selected[0]['type'] ? 'collection' : 'delivery', $snapshot['capturedAt'] );
	$assert( $expected[$order->get_id()] && $expected[$order->get_id()]['method']['rateId'] === $rate_id, 'Current chosen-rate factory result remains consistent.' );
};
$observe_classic = static function ( $id, $posted, $order ) use ( $observe_estimate ) { $observe_estimate( $order ); };
try {
	add_action( 'woocommerce_new_order', $track_created, PHP_INT_MAX, 1 );
	$setup();
	if ( $managed ) {
		$package = OverSeek_Delivery_Storefront_Context::current_package();
		$clock = new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
		$calculate = static fn() => ( new OverSeek_Delivery_Live_Adapter() )->calculate( WC()->cart->get_cart(), $package['rates'], $clock );
		$baseline = $calculate();
		$hash = WC()->cart->get_cart_hash();
		$stock = $certified['quantity'];
		$reserve = static function ( $quantity, $status ) use ( $product, $hash, &$orders ) {
			$order = wc_create_order( [ 'status' => $status ] );
			if ( is_wp_error( $order ) ) { throw new RuntimeException( $order->get_error_message() ); }
			$orders[] = $order->get_id();
			$order->add_product( $product, $quantity );
			$order->set_cart_hash( $hash ); $order->save();
			wc_reserve_stock_for_order( $order );
			return $order;
		};
		$other = $reserve( $stock - 2, 'pending' );
		$own = $reserve( 2, 'checkout-draft' );
		WC()->session->set( 'store_api_draft_order', $own->get_id() );
		$assert( $other->get_cart_hash() === $hash && $own->get_cart_hash() === $hash && WC()->cart->get_cart_hash() === $hash, 'Both real reserved orders use the unchanged actual cart hash; hash alone must not exclude another order.' );
		$assert( (int) wc_get_held_stock_quantity( $product ) === $stock && (int) wc_get_held_stock_quantity( $product, $own->get_id() ) === $stock - 2, 'Native holds include both orders; excluding own retains every other reserved unit.' );
		$live = OverSeek_Delivery_Stock_Snapshot::read( get_option( 'overseek_account_id' ), $product, $proof, $own->get_id() );
		$assert( $live['prior_demand'] === $stock - 2 && $live['quantity'] - $live['prior_demand'] === 2, 'Certified snapshot subtracts other reservations, leaving exactly this cart demand.' );
		$assert( $calculate() === $baseline, 'Matching session draft reservation is excluded: no double-counting of own cart demand.' );
		WC()->session->set( 'store_api_draft_order', 0 );
		$assert( 'unavailable' === $calculate()['status'], 'Without own session identity, both same-hash reservations count and the cart cannot be promised.' );
		WC()->session->set( 'store_api_draft_order', $own->get_id() );
		$own->set_cart_hash( 'not-the-current-cart' ); $own->save();
		$assert( 'unavailable' === $calculate()['status'], 'A stale session draft hash never excludes its reservation.' );
		$own->set_cart_hash( $hash ); $own->save();
		$assert( $calculate() === $baseline, 'Restoring the real unchanged cart hash restores the own-order exclusion.' );
		wc_release_stock_for_order( $own );
		$items = $other->get_items(); $item = reset( $items ); $item->set_quantity( $stock ); $item->save();
		wc_reserve_stock_for_order( new WC_Order( $other->get_id() ) );
		$assert( 'unavailable' === $calculate()['status'], 'Other order consuming all stock is subtracted even when its hash matches the cart and an own draft is selected.' );
		wc_release_stock_for_order( $other );
		WC()->session->set( 'store_api_draft_order', 0 );
		$assert( $calculate() === $baseline, 'Releasing native reservations restores the same chosen-rate estimate.' );
	}
	$before_classic = count( $orders );
	$_POST = [ 'woocommerce-process-checkout-nonce' => wp_create_nonce( 'woocommerce-process_checkout' ), 'ship_to_different_address' => 1, 'shipping_method' => [ $rate_id ], 'billing_email' => 'checkout@example.test', 'billing_phone' => '0400000000', 'terms' => 1 ];
	foreach ( [ 'billing', 'shipping' ] as $type ) { foreach ( $address as $key => $value ) { $_POST[$type . '_' . $key] = $value; } }
	// PHP builds REQUEST before script execution; assigning POST alone does not update it.
	$_REQUEST = $_POST;
	$_SERVER['REQUEST_METHOD'] = 'POST';
	add_action( 'woocommerce_checkout_order_processed', $observe_classic, PHP_INT_MAX, 3 );
	add_action( 'woocommerce_checkout_order_processed', $stop_classic, PHP_INT_MAX, 1 );
	WC()->checkout()->process_checkout();
	remove_action( 'woocommerce_checkout_order_processed', $stop_classic, PHP_INT_MAX );
	$assert( $before_classic + 1 === count( $orders ), 'Native classic checkout reached processed hook: ' . wp_json_encode( wc_get_notices() ) );
	$classic_id = $orders[$before_classic];
	$verify( $classic_id );
	wc_release_stock_for_order( $classic_id );
	$_POST = $original_post; $_REQUEST = $original_request;
	$setup();
	add_action( 'woocommerce_store_api_checkout_order_processed', $observe_estimate, PHP_INT_MAX, 1 );
	add_action( 'woocommerce_store_api_checkout_order_processed', $observe_blocks, PHP_INT_MAX, 1 );
	$request = static function ( $method, $body ) {
		$request = new WP_REST_Request( $method, '/wc/store/v1/checkout' );
		$request->set_header( 'Nonce', wp_create_nonce( 'wc_store_api' ) );
		$request->set_header( 'content-type', 'application/json' ); $request->set_body( wp_json_encode( $body ) );
		return rest_do_request( $request );
	};
	$body = [ 'billing_address' => $address + [ 'email' => 'checkout@example.test', 'phone' => '0400000000' ], 'shipping_address' => $address ];
	foreach ( [ 'GET', 'PUT', 'PUT' ] as $method ) {
		$response = $request( $method, 'GET' === $method ? [] : $body );
		$assert( $response->get_status() < 300, 'Draft request succeeded: ' . wp_json_encode( $response->get_data() ) );
		$id = $response->get_data()['order_id'] ?? 0;
		if ( $id ) { $orders[] = $id; $assert( ! ( new WC_Order( $id ) )->meta_exists( OverSeek_Delivery_Order_Snapshot::META_KEY ), 'Draft GET/PUT never capture.' ); }
	}
	$response = $request( 'POST', $body );
	$assert( $response->get_status() < 300, 'Native Store API POST succeeded: ' . wp_json_encode( $response->get_data() ) );
	$id = $response->get_data()['order_id']; $orders[] = $id; $snapshot = $verify( $id );
	$assert( $snapshot === $verify( $id ), 'Fresh CRUD reads retain captured snapshot after cart emptied/payment completion.' );
	$assert( 0 === $calls, 'No outbound HTTP attempted.' );
	echo 'Native capture: ' . $checks . ' checks; Woo ' . WC_VERSION . '; WP ' . get_bloginfo( 'version' ) . '; HPOS=' . ( \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() ? 'yes' : 'no' ) . "\n";
} finally {
	$_POST = $original_post;
	$_REQUEST = $original_request;
	if ( null === $original_request_method ) { unset( $_SERVER['REQUEST_METHOD'] ); } else { $_SERVER['REQUEST_METHOD'] = $original_request_method; }
	remove_action( 'woocommerce_checkout_order_processed', $observe_classic, PHP_INT_MAX );
	remove_action( 'woocommerce_store_api_checkout_order_processed', $observe_estimate, PHP_INT_MAX );
	remove_action( 'woocommerce_new_order', $track_created, PHP_INT_MAX );
	remove_action( 'woocommerce_checkout_order_processed', $stop_classic, PHP_INT_MAX );
	remove_action( 'woocommerce_store_api_checkout_order_processed', $observe_blocks, PHP_INT_MAX );
	remove_filter( 'pre_http_request', $deny_http, PHP_INT_MAX );
	WC()->cart->empty_cart();
	foreach ( array_unique( array_merge( $orders, $created_orders ) ) as $id ) { $order = wc_get_order( $id ); if ( $order ) { wc_release_stock_for_order( $order ); $order->delete( true ); } }
}

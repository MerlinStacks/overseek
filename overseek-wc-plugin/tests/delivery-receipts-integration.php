<?php
/**
 * Real WordPress/Woo/MySQL guarded receipt tests. DISPOSABLE wordpress_tests DB ONLY.
 * OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 wp --path=wordpress eval-file overseek-wc-plugin/tests/delivery-receipts-integration.php --use-include
 * Requires activated Woo/OverSeek and permission to create/drop a MySQL trigger.
 * @package OverSeek
 */
declare(strict_types=1);

if ( ! defined( 'WP_CLI' ) || true !== WP_CLI || 'cli' !== PHP_SAPI || '1' !== getenv( 'OVERSEEK_RUN_DISPOSABLE_DB_TESTS' ) || ! defined( 'DB_NAME' ) || 'wordpress_tests' !== DB_NAME ) {
	throw new RuntimeException( 'Refusing mutations: requires WP-CLI, OVERSEEK_RUN_DISPOSABLE_DB_TESTS=1 and DB_NAME=wordpress_tests.' );
}

// wp eval-file evaluates in a method scope: explicitly bind WordPress's database global.
global $wpdb;
if ( 'wordpress_tests' !== $wpdb->get_var( 'SELECT DATABASE()' ) || ! class_exists( 'WooCommerce' ) || ! class_exists( 'WC_Product_Simple' ) ) {
	throw new RuntimeException( 'Requires the actual wordpress_tests database and installed/active WooCommerce.' );
}
$routes = rest_get_server()->get_routes();
foreach ( [ 'prepare', 'apply' ] as $action ) {
	if ( ! isset( $routes[ '/overseek/v1/delivery-estimates/receipts/' . $action ] ) ) {
		throw new RuntimeException( 'Activate OverSeek with guarded receipt routes before running this harness.' );
	}
}
// Do not steal a transaction belonging to wp eval-file's caller, even in a disposable DB.
( new OverSeek_Receipt_Storage() )->assert_idle_connection();
if ( 'yes' !== get_option( 'woocommerce_manage_stock', 'yes' ) ) {
	throw new RuntimeException( 'Enable Woo stock management in the disposable test installation first.' );
}

$checks = 0;
$assert = static function ( bool $condition, string $message ) use ( &$checks ): void {
	$checks++;
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
};
$token = bin2hex( random_bytes( 12 ) );
$account = 'receipt-integration-' . $token;
$trigger = 'os_receipt_fail_' . $token;
$trigger_created = false;
$products = [];
$user_id = 0;
$original_user = get_current_user_id();
$missing = new stdClass();
$original_account = get_option( 'overseek_account_id', $missing );
$writes = [];
$count_write = static function ( $sql, $owner ) use ( &$writes, &$products ) {
	if ( in_array( (int) $owner, $products, true ) ) {
		$writes[ (int) $owner ][] = $sql;
	}
	return $sql; // Never change the native statement to inject failure.
};
$request = static function ( string $action, array $operation ) use ( $account ): WP_REST_Response {
	$request = new WP_REST_Request( 'POST', '/overseek/v1/delivery-estimates/receipts/' . $action );
	$request->set_header( 'content-type', 'application/json' );
	$request->set_header( 'x-overseek-account-id', $account );
	$request->set_body( wp_json_encode( [ 'schemaVersion' => 1, 'operation' => $operation ] ) );
	return rest_do_request( $request );
};
$operation = static function ( string $id, int $sequence, int $owner, int $delta, ?int $parent = null ): array {
	return [ 'operationId' => $id, 'sequence' => $sequence, 'productWooId' => $parent ?? $owner, 'variationWooId' => null === $parent ? null : $owner, 'stockOwnerWooId' => $owner, 'delta' => $delta ];
};
$ack = static function ( WP_REST_Response $response, array $op, string $state, ?int $quantity = null ) use ( $assert ): void {
	$assert( 200 === $response->get_status(), 'Expected successful ACK: ' . wp_json_encode( $response->get_data() ) );
	$assert( $response->get_data() === [ 'schemaVersion' => 1, 'operationId' => $op['operationId'], 'sequence' => $op['sequence'], 'stockOwnerWooId' => $op['stockOwnerWooId'], 'state' => $state, 'stockQuantity' => $quantity, 'guardActive' => true, 'receiptSafety' => 'unverified' ], 'ACK did not match original operation/state/quantity.' );
};
$stock = static function ( int $owner ) use ( $wpdb, $assert ): int {
	// Independent DB read for test assertions, not a production success heuristic or stock write.
	$values = $wpdb->get_col( $wpdb->prepare( "SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock'", $owner ) );
	$assert( '' === $wpdb->last_error && 1 === count( $values ), 'Fixture must have exactly one authoritative stock row.' );
	return (int) $values[0];
};
$guard = static function ( array $op ) use ( $wpdb, $account, $assert ): void {
	$table = $wpdb->prefix . 'overseek_receipt_guards';
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT operation_id, sequence, guard_active FROM {$table} WHERE account_id = %s AND owner_id = %d", $account, $op['stockOwnerWooId'] ), ARRAY_A );
	$assert( is_array( $row ) && $row['operation_id'] === $op['operationId'] && (int) $row['sequence'] === $op['sequence'] && 1 === (int) $row['guard_active'], 'Current owner guard must persist, active and account-scoped.' );
};
$failure = null;
$cleanup_errors = [];
try {
	$user_id = wp_insert_user( [ 'user_login' => 'receipt_ci_' . $token, 'user_pass' => wp_generate_password( 32, true, true ), 'role' => 'administrator' ] );
	if ( is_wp_error( $user_id ) ) {
		$user_id = 0;
		throw new RuntimeException( 'Could not create the disposable administrator.' );
	}
	wp_set_current_user( $user_id );
	update_option( 'overseek_account_id', $account );
	$assert( current_user_can( 'manage_woocommerce' ), 'Temporary administrator lacks management permission.' );
	$make_simple = static function ( string $name ) use ( &$products, $assert ): int {
		$product = new WC_Product_Simple();
		$product->set_name( $name );
		$product->set_status( 'publish' );
		$product->set_manage_stock( true );
		$product->set_stock_quantity( 10 );
		$product->set_stock_status( 'instock' );
		try { $id = $product->save(); } finally {
			if ( $product->get_id() > 0 ) { $products[] = $product->get_id(); }
		}
		$assert( $id > 0, 'Could not create simple fixture.' );
		return $id;
	};
	$simple = $make_simple( 'Receipt integration simple ' . $token );
	$failed_owner = $make_simple( 'Receipt integration SQL failure ' . $token );
	$parent = new WC_Product_Variable();
	$parent->set_name( 'Receipt integration variable ' . $token );
	$parent->set_status( 'publish' );
	$parent->set_manage_stock( false );
	try { $parent_id = $parent->save(); } finally {
		if ( $parent->get_id() > 0 ) { $products[] = $parent->get_id(); }
	}
	$assert( $parent_id > 0, 'Could not create parent fixture.' );
	$variation = new WC_Product_Variation();
	$variation->set_parent_id( $parent_id );
	$variation->set_status( 'publish' );
	$variation->set_manage_stock( true );
	$variation->set_stock_quantity( 10 );
	$variation->set_stock_status( 'instock' );
	try { $variation_id = $variation->save(); } finally {
		if ( $variation->get_id() > 0 ) { $products[] = $variation->get_id(); }
	}
	$assert( $variation_id > 0, 'Could not create variation fixture.' );
	$assert( $variation->get_stock_managed_by_id() === $variation_id, 'Variation fixture is not independently stock-managed.' );
	add_filter( 'woocommerce_update_product_stock_query', $count_write, PHP_INT_MIN, 2 );

	// A caller START TRANSACTION still has autocommit=1. Rejection must not commit its write.
	add_post_meta( $simple, '_receipt_integration_tx_marker', 'before', true );
	$assert( false !== $wpdb->query( 'START TRANSACTION' ), 'Could not start caller-owned test transaction.' );
	try {
		$assert( '1' === (string) $wpdb->get_var( 'SELECT @@SESSION.autocommit' ), 'Expected autocommit=1 inside explicit transaction.' );
		$assert( 1 === $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->postmeta} SET meta_value = 'pending' WHERE post_id = %d AND meta_key = '_receipt_integration_tx_marker'", $simple ) ), 'Could not write rollback sentinel.' );
		$rejected = $request( 'prepare', $operation( 'caller-tx', 1, $simple, 3 ) );
		$assert( 503 === $rejected->get_status() && 'overseek_receipt_storage_failed' === $rejected->get_data()['code'], 'Caller transaction was not rejected.' );
	} finally {
		$wpdb->query( 'ROLLBACK' ); // This transaction belongs to this test, never to the endpoint.
	}
	$assert( 'before' === $wpdb->get_var( $wpdb->prepare( "SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_receipt_integration_tx_marker'", $simple ) ), 'Endpoint implicitly committed caller work.' );
	$assert( [] === $writes, 'Rejected transaction reached native stock.' );

	$first = $operation( 'simple-receipt', 1, $simple, 3 );
	$ack( $request( 'prepare', $first ), $first, 'prepared' );
	$assert( 10 === $stock( $simple ), 'Prepare mutated stock.' );
	$guard( $first );
	$ack( $request( 'prepare', $first ), $first, 'prepared' );
	$ack( $request( 'apply', $first ), $first, 'applied', 13 );
	$ack( $request( 'apply', $first ), $first, 'applied', 13 );
	$assert( 13 === $stock( $simple ) && 1 === count( $writes[ $simple ] ), 'Apply replay repeated the increment.' );
	$second = $operation( 'simple-reversal', 2, $simple, -3 );
	$ack( $request( 'prepare', $second ), $second, 'prepared' );
	$ack( $request( 'apply', $second ), $second, 'applied', 10 );
	$ack( $request( 'prepare', $first ), $first, 'applied', 13 );
	$ack( $request( 'apply', $first ), $first, 'applied', 13 );
	$assert( 10 === $stock( $simple ) && 2 === count( $writes[ $simple ] ), 'Historical replay changed stock or lost the original ACK.' );
	$guard( $second );

	$child = $operation( 'variation-receipt', 1, $variation_id, 2, $parent_id );
	$ack( $request( 'prepare', $child ), $child, 'prepared' );
	$ack( $request( 'apply', $child ), $child, 'applied', 12 );
	$ack( $request( 'apply', $child ), $child, 'applied', 12 );
	$assert( 12 === $stock( $variation_id ) && 1 === count( $writes[ $variation_id ] ) && ! isset( $writes[ $parent_id ] ), 'Variation mutation/replay used the wrong owner.' );
	$guard( $child );

	// Parent-managed siblings retain native inherited ownership throughout receipt/reversal.
	$parent = wc_get_product( $parent_id );
	$parent->set_manage_stock( true ); $parent->set_stock_quantity( 10 ); $parent->save();
	$inherited = [];
	foreach ( [ 'a', 'b' ] as $label ) {
		$v = new WC_Product_Variation(); $v->set_parent_id( $parent_id ); $v->set_status( 'publish' ); $v->set_manage_stock( false );
		try { $v->save(); } finally { if ( $v->get_id() ) { $products[] = $v->get_id(); } }
		// New variation objects have not hydrated native inherited parent data yet.
		$v = wc_get_product( $v->get_id() );
		$inherited[] = $v->get_id();
		$assert( $v->get_stock_managed_by_id() === $parent_id, 'Native inherited variation did not resolve parent owner.' );
	}
	$parent_ops = [];
	foreach ( [ [ $inherited[0], 2 ], [ $inherited[1], 3 ], [ $inherited[0], -2 ] ] as $index => [ $variation_woo_id, $delta ] ) {
		$op = [ 'operationId' => 'parent-managed-' . $index, 'sequence' => $index + 1, 'productWooId' => $parent_id, 'variationWooId' => $variation_woo_id, 'stockOwnerWooId' => $parent_id, 'delta' => $delta ];
		$parent_ops[] = $op;
		$ack( $request( 'prepare', $op ), $op, 'prepared' );
		$quantity = [ 12, 15, 13 ][ $index ];
		$ack( $request( 'apply', $op ), $op, 'applied', $quantity );
		$ack( $request( 'apply', $op ), $op, 'applied', $quantity );
		$assert( false === wc_get_product( $variation_woo_id )->get_manage_stock( 'edit' ), 'Receipt forced variant-local stock.' );
	}
	$assert( 13 === $stock( $parent_id ) && 3 === count( $writes[ $parent_id ] ), 'Parent owner sequence applied more than once or to a variant.' );
	$proof_store = new OverSeek_Receipt_Storage();
	try {
		$assert( $proof_store->lock_owners( [ $parent_id ] ), 'Could not acquire native parent proof lock.' );
		$wpdb->query( 'START TRANSACTION' );
		try {
			$proof_store->release_proof( $account, [ 'version' => 1, 'epoch' => 'integration', 'owners' => [ [ 'stockOwnerWooId' => $parent_id, 'sequence' => 3, 'operationId' => 'parent-managed-2' ] ] ] );
		} finally { $wpdb->query( 'ROLLBACK' ); }
		$guard( $parent_ops[2] ); // A failed publish cannot release its guard.
	} finally { $proof_store->close(); }
	$journal = $wpdb->prefix . 'overseek_receipt_journal';
	$assert( 3 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$journal} WHERE account_id = %s AND owner_id = %d AND phase = 4", $account, $parent_id ) ), 'Parent ledger did not retain all immutable terminal operations.' );

	$failed = $operation( 'silent-native-failure', 1, $failed_owner, 3 );
	$ack( $request( 'prepare', $failed ), $failed, 'prepared' );
	// Server-side failure leaves Woo's native SQL text unchanged, unlike a query rewrite mock.
	$trigger_sql = "CREATE TRIGGER `{$trigger}` BEFORE UPDATE ON `{$wpdb->postmeta}` FOR EACH ROW BEGIN IF OLD.post_id = {$failed_owner} AND OLD.meta_key = '_stock' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'receipt integration forced stock failure'; END IF; END";
	$assert( false !== $wpdb->query( $trigger_sql ), 'Could not create failure trigger; provision disposable CI trigger privileges/binlog policy.' );
	$trigger_created = true;
	$ack( $request( 'apply', $failed ), $failed, 'uncertain' );
	$assert( 10 === $stock( $failed_owner ), 'Failing UPDATE changed authoritative DB stock.' );
	$expected_sql = $wpdb->prepare( "UPDATE {$wpdb->postmeta} SET meta_value = meta_value %+f WHERE post_id = %d AND meta_key='_stock'", 3, $failed_owner );
	$assert( [ $expected_sql ] === $writes[ $failed_owner ], 'Failure test did not issue exactly one unchanged native stock statement.' );
	$assert( false !== $wpdb->query( "DROP TRIGGER `{$trigger}`" ), 'Could not remove failure trigger.' );
	$trigger_created = false;
	// Remove the failure condition BEFORE retry: an accidental second call would now increase stock.
	$ack( $request( 'apply', $failed ), $failed, 'uncertain' );
	$ack( $request( 'prepare', $failed ), $failed, 'uncertain' );
	$later = $request( 'prepare', $operation( 'blocked-after-failure', 2, $failed_owner, 1 ) );
	$assert( 409 === $later->get_status() && 'overseek_receipt_sequence_conflict' === $later->get_data()['code'], 'Later sequence bypassed uncertainty.' );
	$assert( 10 === $stock( $failed_owner ) && 1 === count( $writes[ $failed_owner ] ), 'Uncertain retry made another stock attempt.' );
	$guard( $failed );
} catch ( Throwable $error ) {
	$failure = $error;
} finally {
	remove_filter( 'woocommerce_update_product_stock_query', $count_write, PHP_INT_MIN );
	// Try every cleanup even if another cleanup fails; never drop tables or enumerate store data.
	$cleanup = static function ( callable $action ) use ( &$cleanup_errors ): void {
		try { $action(); } catch ( Throwable $error ) { $cleanup_errors[] = $error->getMessage(); }
	};
	if ( $trigger_created ) {
		$cleanup( static function () use ( $wpdb, $trigger ): void {
			if ( false === $wpdb->query( "DROP TRIGGER `{$trigger}`" ) ) { throw new RuntimeException( 'Could not drop fixture trigger ' . $trigger ); }
		} );
	}
	foreach ( array_reverse( $products ) as $id ) {
		$cleanup( static function () use ( $id ): void {
			$product = wc_get_product( $id );
			if ( $product && ! $product->delete( true ) ) { throw new RuntimeException( 'Could not delete fixture product ' . $id ); }
		} );
	}
	foreach ( [ 'guards', 'journal', 'resolutions' ] as $suffix ) {
		$cleanup( static function () use ( $wpdb, $suffix, $account ): void {
			$table = $wpdb->prefix . 'overseek_receipt_' . $suffix;
			if ( $wpdb->get_var( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table ) ) ) {
				// Test-fixture teardown only; runtime journal has no delete/prune path.
				if ( false === $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE account_id = %s", $account ) ) ) { throw new RuntimeException( 'Could not delete fixture receipt rows.' ); }
			}
		} );
	}
	$cleanup( static function () use ( $original_account, $missing ): void {
		if ( $original_account === $missing ) { delete_option( 'overseek_account_id' ); } else { update_option( 'overseek_account_id', $original_account ); }
	} );
	wp_set_current_user( $original_user );
	if ( $user_id ) {
		$cleanup( static function () use ( $user_id ): void {
			require_once ABSPATH . 'wp-admin/includes/user.php';
			if ( ! wp_delete_user( $user_id ) ) { throw new RuntimeException( 'Could not delete temporary administrator.' ); }
		} );
	}
}
if ( $failure || $cleanup_errors ) {
	WP_CLI::error( ( $failure ? $failure->getMessage() : 'Integration cleanup failed.' ) . ( $cleanup_errors ? ' Cleanup: ' . implode( '; ', $cleanup_errors ) : '' ) );
}
WP_CLI::success( "Guarded receipt real Woo/MySQL integration: {$checks} assertions passed; fixtures cleaned up." );

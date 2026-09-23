<?php
/** Bounded primitive snapshot, including native held-stock context. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/class-overseek-delivery-render-token.php';
require_once __DIR__ . '/class-overseek-delivery-control.php';

final class OverSeek_Delivery_Render_State {
	/** No serialization/get_data on arbitrary objects, and never get_delivery_time (recursive). */
	public static function read( array $cart, array $package ): array {
		if ( count( $cart ) > 200 || count( $package['rates'] ) > 100 ) { throw new RuntimeException( 'cache_bounds' ); }
		$now = new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
		$account = get_option( 'overseek_account_id', '' );
		if ( ! is_string( $account ) || '' === $account ) { throw new RuntimeException( 'account_missing' ); }
		$products = []; $owners = []; $lines = [];
		foreach ( $cart as $key => $line ) {
			$product = $line['data'];
			$products[ $product->get_id() ] = $product;
			$line['data'] = self::product( $product );
			$lines[ $key ] = $line;
			if ( ! $product->is_virtual() && $product->needs_shipping() ) {
				foreach ( [ $product->get_parent_id(), $product->get_stock_managed_by_id() ] as $id ) {
					if ( $id && ! isset( $products[ $id ] ) ) { $products[ $id ] = wc_get_product( $id ); }
				}
				if ( $product->managing_stock() ) { $owners[ $product->get_stock_managed_by_id() ] = $products[ $product->get_stock_managed_by_id() ]; }
			}
		}
		$stock = [];
		foreach ( $products as $id => $product ) { $stock[ $id ] = self::product( $product ); }
		$ids = array_keys( $products ); sort( $ids, SORT_NUMERIC );
		foreach ( $package['contents'] as &$line ) { $line['data'] = self::product( $line['data'] ); }
		unset( $line );
		foreach ( $package['rates'] as &$rate ) {
			$data = [];
			foreach ( [ 'id', 'method_id', 'instance_id', 'label', 'cost', 'taxes', 'tax_status', 'description', 'meta_data' ] as $field ) {
				$data[ $field ] = method_exists( $rate, 'get_' . $field ) ? $rate->{ 'get_' . $field }() : null;
			}
			$rate = $data;
		}
		unset( $rate );
		$session = WC()->session; $orders = []; $exclude = 0;
		$cart_hash = $owners ? WC()->cart->get_cart_hash() : '';
		foreach ( [ 'store_api_draft_order', 'order_awaiting_payment' ] as $key ) {
			$id = $session ? (int) $session->get( $key, 0 ) : 0;
			$order = $owners && $id > 0 && function_exists( 'wc_get_order' ) ? wc_get_order( $id ) : null;
			$orders[ $key ] = [ $id, $order ? $order->get_status() : null, $order ? $order->get_cart_hash() : null ];
			if ( ! $exclude && $order && $order->has_status( [ 'checkout-draft', 'pending', 'failed' ] ) && $order->get_cart_hash() && hash_equals( $order->get_cart_hash(), $cart_hash ) ) { $exclude = $id; }
		}
		$before = OverSeek_Delivery_Render_Token::read( $account, $ids, $now );
		$held = [];
		// Use native API, including HPOS and reservation filters; do not copy its SQL semantics.
		foreach ( $owners as $id => $owner ) {
			if ( ! OverSeek_Receipt_Write_Observer::supported( $owner ) ) { throw new RuntimeException( 'unsupported_stock_store' ); }
			$held[ $id ] = wc_get_held_stock_quantity( $owner, $exclude );
		}
		// A receipt/input write during a held-stock read invalidates this entire snapshot.
		if ( $owners && $before !== OverSeek_Delivery_Render_Token::read( $account, $ids, $now ) ) { throw new RuntimeException( 'cache_fence_changed' ); }
		$value = [ $account, OverSeek_Delivery_Control::fingerprint(), $lines, $stock, $package, $orders, $cart_hash, $exclude, $held, $before,
			$now->format( 'Y-m-d H:i' ), get_option( 'woocommerce_manage_stock' ), get_option( 'woocommerce_schema_version' ) ];
		$budget = 40000;
		self::primitives( $value, $budget );
		$json = json_encode( $value, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION );
		if ( strlen( $json ) > 2097152 || $account !== get_option( 'overseek_account_id', '' ) ) { throw new RuntimeException( 'cache_snapshot_invalid' ); }
		return [ 'key' => hash( 'sha256', $json ), 'now' => $now ];
	}

	private static function product( WC_Product $product ): array {
		return [ $product->get_id(), $product->get_type(), $product->get_parent_id(), $product instanceof WC_Product_Variation,
			$product->is_virtual(), $product->needs_shipping(), $product->is_purchasable(), $product->get_stock_managed_by_id(),
			$product->managing_stock(), $product->get_stock_quantity(), $product->get_stock_status(), $product->backorders_allowed() ];
	}

	/** Never invoke __sleep, JsonSerializable or magic getters in extension data. */
	private static function primitives( $value, int &$budget, int $depth = 0 ): void {
		if ( --$budget < 0 || $depth > 12 || is_object( $value ) || is_resource( $value ) || ( is_string( $value ) && strlen( $value ) > 65536 ) ) { throw new RuntimeException( 'cache_nonprimitive' ); }
		if ( is_array( $value ) ) { foreach ( $value as $part ) { self::primitives( $part, $budget, $depth + 1 ); } }
	}
}

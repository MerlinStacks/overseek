<?php
/** Coherent native CPT live stock and held demand, never a cart object's quantity. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/class-overseek-receipt-storage.php';
require_once __DIR__ . '/class-overseek-receipt-validation.php';
require_once __DIR__ . '/class-overseek-receipt-write-observer.php';
require_once __DIR__ . '/class-overseek-delivery-control.php';

final class OverSeek_Delivery_Stock_Snapshot {
	public static function read( string $account, WC_Product $owner, array $proof, int $exclude_order_id = 0 ): array {
		global $wpdb;
		$control = OverSeek_Delivery_Control::state();
		if ( ( $proof['version'] ?? null ) !== 1 || ( $proof['epoch'] ?? null ) !== ( $control['epoch'] ?? null ) || 'guarded' !== ( $control['mode'] ?? null ) || ! OverSeek_Receipt_Write_Observer::supported( $owner ) ) { throw new InvalidArgumentException( 'receipt_safety_unverified' ); }
		$match = null;
		foreach ( $proof['owners'] ?? [] as $candidate ) { if ( $candidate['stockOwnerWooId'] === $owner->get_id() ) { $match = $candidate; break; } }
		$storage = new OverSeek_Receipt_Storage();
		$before = $storage->guard( $account, $owner->get_id() );
		if ( ! $match || ! $before || 0 !== (int) $before['guard_active'] || (int) $before['sequence'] !== $match['sequence'] || $before['operation_id'] !== $match['operationId'] ) { throw new InvalidArgumentException( 'receipt_guard_pending' ); }
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key IN ('_stock','_stock_status','_manage_stock','_backorders') ORDER BY meta_id", $owner->get_id() ), ARRAY_A );
		if ( $wpdb->last_error || 4 !== count( $rows ) ) { throw new InvalidArgumentException( 'invalid_live_stock' ); }
		$meta = [];
		foreach ( $rows as $row ) { if ( isset( $meta[ $row['meta_key'] ] ) ) { throw new InvalidArgumentException( 'invalid_live_stock' ); } $meta[ $row['meta_key'] ] = $row['meta_value']; }
		$stock = OverSeek_Receipt_Validation::quantity( $meta['_stock'] ?? null );
		if ( null === $stock || 'yes' !== ( $meta['_manage_stock'] ?? null ) || ! in_array( $meta['_backorders'] ?? null, [ 'yes', 'no', 'notify' ], true ) || ! in_array( $meta['_stock_status'] ?? null, [ 'instock', 'onbackorder' ], true ) || ! function_exists( 'wc_get_held_stock_quantity' ) ) { throw new InvalidArgumentException( 'invalid_live_stock' ); }
		$held = OverSeek_Receipt_Validation::quantity( wc_get_held_stock_quantity( $owner, $exclude_order_id ) );
		if ( null === $held || $held < 0 || $before !== $storage->guard( $account, $owner->get_id() ) || $control !== OverSeek_Delivery_Control::state() || $account !== get_option( 'overseek_account_id', '' ) ) { throw new InvalidArgumentException( 'stock_snapshot_changed' ); }
		return [ 'quantity' => $stock, 'prior_demand' => max( 0, -$stock ) + $held, 'stock_status' => 'instock' === $meta['_stock_status'] ? 'in_stock' : 'on_backorder', 'backorders_allowed' => 'no' !== $meta['_backorders'], 'guard' => $before ];
	}
}

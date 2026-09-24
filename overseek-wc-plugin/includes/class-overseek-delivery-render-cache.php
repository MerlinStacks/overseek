<?php
/** One coherent cart-render result per PHP request, fenced on every reuse. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/class-overseek-delivery-render-state.php';

final class OverSeek_Delivery_Render_Cache {
	private static ?array $entry = null;

	/** A warm cache only permits a fresh fence read, never unconditional result reuse. */
	public static function has_entry(): bool { return null !== self::$entry; }

	/** Internal reset also bounds memory to one snapshot rather than accumulating cart history. */
	public static function clear(): void { self::$entry = null; }

	public static function calculate( array $cart, array $package ): array {
		try {
			$before = OverSeek_Delivery_Render_State::read( $cart, $package );
			if ( self::$entry && self::$entry['key'] === $before['key'] ) { return self::$entry['result']; }
			self::clear();
			// Never copy or weaken the receipt agent's activation policy. Changes in its
			// control/settings revisions or environment fingerprint force this real gate.
			if ( ! OverSeek_Delivery_Storefront_Gate::is_active() ) { return [ 'status' => 'unavailable', 'reason' => 'storefront_inactive' ]; }
			$result = ( new OverSeek_Delivery_Live_Adapter() )->calculate( $cart, $package['rates'], $before['now'] );
			$after = OverSeek_Delivery_Render_State::read( $cart, $package );
			if ( $before['key'] !== $after['key'] ) { throw new RuntimeException( 'cache_snapshot_changed' ); }
			self::$entry = [ 'key' => $after['key'], 'result' => $result ];
			return $result;
		} catch ( Throwable $error ) {
			self::clear();
			// Simple timing also works before receipt tables/stock certification exist.
			// If that cache fence is unavailable, calculate afresh instead of caching.
			try {
				if ( 'production' === ( OverSeek_Delivery_Control::state()['estimateMode'] ?? null ) && OverSeek_Delivery_Storefront_Gate::is_active() ) {
					return ( new OverSeek_Delivery_Live_Adapter() )->calculate( $cart, $package['rates'] );
				}
			} catch ( Throwable $unavailable ) { /* Local inputs are unavailable. */ }
			return [ 'status' => 'unavailable', 'reason' => 'render_snapshot_unavailable' ];
		}
	}
}

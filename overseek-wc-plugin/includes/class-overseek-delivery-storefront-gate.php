<?php
/** Explicit account-bound local storefront activation boundary. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Storefront_Gate {
	/** Local account-bound activation plus current settings. Per-product proofs gate the adapter. */
	public static function is_active(): bool {
		try {
			require_once __DIR__ . '/class-overseek-delivery-control.php';
			$control = OverSeek_Delivery_Control::state();
			$production = 'production' === ( $control['estimateMode'] ?? null );
			if ( true !== ( $control['active'] ?? false ) || ( ! $production && 'guarded' !== ( $control['mode'] ?? null ) ) ) { return false; }
			if ( ! isset( $control['environmentFingerprint'] ) || ! hash_equals( $control['environmentFingerprint'], OverSeek_Delivery_Control::fingerprint() ) ) { return false; }
			$settings = ( new OverSeek_Delivery_Input_Storage() )->read_settings();
			return $settings && true === ( $settings['payload']['enabled'] ?? null ) && $settings['revision'] === ( $control['settingsRevision'] ?? null )
				&& $production === ( 'production' === ( $settings['payload']['settings']['estimateMode'] ?? null ) );
		} catch ( Throwable $error ) { return false; }
	}
}

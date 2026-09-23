<?php
/** Read-only native Woo quote-cache compatibility boundary. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Session_Quotes {
	/** Shared with authenticated readiness; never certify a version the live cache reader rejects. */
	public static function supports_version( string $version ): bool {
		return 1 === preg_match( '/\A(?:9\.[789]|10\.[0-9]|11\.[01])\.[0-9]+\z/', $version );
	}
	/** @internal Caller must first certify the whole current cart and destination. */
	public static function rates( array $package, $key ): ?array {
		if ( ! defined( 'WC_VERSION' ) || ! self::supports_version( WC_VERSION ) || ! WC()->session ) {
			return null;
		}
		$stored = WC()->session->get( 'shipping_for_package_' . $key );
		if ( ! is_array( $stored ) || ! is_string( $stored['package_hash'] ?? null ) || ! self::valid_rates( $stored['rates'] ?? null ) ) {
			return null;
		}
		$version = self::shipping_version();
		if ( null === $version ) {
			return null;
		}
		// Native calculate_shipping_for_package sets this BEFORE hashing, including its position.
		$package['rates'] = [];
		if ( version_compare( WC_VERSION, '11.0.0', '>=' ) ) {
			// Never honour a plugin hash policy that could exclude destination/user/contents.
			if ( false !== has_filter( 'woocommerce_shipping_package_hash_ignored_fields' ) ) {
				return null;
			}
			foreach ( [ 'subtotal', 'total', 'package_id', 'package_name', 'rates', 'package_index' ] as $field ) {
				unset( $package[ $field ] );
			}
		}
		foreach ( $package['contents'] as $item_id => $item ) {
			unset( $package['contents'][ $item_id ]['data'] );
		}
		$json = wp_json_encode( $package );
		if ( ! is_string( $json ) || 'wc_ship_' . md5( $json . $version ) !== $stored['package_hash'] || $version !== self::shipping_version() ) {
			return null;
		}
		return $stored['rates'];
	}

	/** Validate opaque exact rate identities; supported-method policy remains in the resolver. */
	public static function valid_rates( $rates ): bool {
		if ( ! is_array( $rates ) || ! $rates || count( $rates ) > 100 ) {
			return false;
		}
		foreach ( $rates as $id => $rate ) {
			if ( ! $rate instanceof WC_Shipping_Rate || ! is_string( $id ) || $id !== $rate->get_id() ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Read WC_Cache_Helper's existing shipping-transient-version, never initialize it.
	 * get_transient can delete expired rows; the helper also writes on a cache miss.
	 * Reject filtered versions rather than running unknown filters or guessing a hash.
	 */
	private static function shipping_version(): ?string {
		$name = 'shipping-transient-version';
		foreach ( [ 'pre_transient_' . $name, 'transient_' . $name ] as $hook ) {
			if ( false !== has_filter( $hook ) ) {
				return null;
			}
		}
		if ( wp_using_ext_object_cache() ) {
			$value = wp_cache_get( $name, 'transient' );
		} else {
			$timeout = get_option( '_transient_timeout_' . $name, false );
			if ( false !== $timeout && ( ! is_numeric( $timeout ) || (int) $timeout < time() ) ) {
				return null;
			}
			$value = get_option( '_transient_' . $name, false );
		}
		return is_string( $value ) && 1 === preg_match( '/\A[0-9]{1,20}\z/', $value ) ? $value : null;
	}
}

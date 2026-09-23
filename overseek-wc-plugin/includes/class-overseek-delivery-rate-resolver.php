<?php
/**
 * Exact local rate resolution; never discovers or calculates shipping rates.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Rate_Resolver {

	/** Resolve caller-certified eligible rates for one ship-together package. */
	public static function resolve( array $settings, array $rates ): array {
		$rows = $settings['shippingMethods'] ?? null;
		if ( ! is_array( $rows ) || count( $rows ) > 500 || count( $rates ) > 100 ) {
			throw new InvalidArgumentException( 'invalid_method' );
		}
		$config = [];
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$key = self::mapping_key( $row );
			if ( isset( $config[ $key ] ) || ! is_bool( $row['enabled'] ?? null ) ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$config[ $key ] = $row;
		}
		if ( ! array_key_exists( 'defaultMethod', $settings ) ) {
			throw new InvalidArgumentException( 'invalid_default_method' );
		}
		if ( null !== $settings['defaultMethod'] ) {
			$default = $settings['defaultMethod'];
			if ( ! is_array( $default ) || true !== ( $config[ self::mapping_key( $default ) ]['enabled'] ?? null ) ) {
				throw new InvalidArgumentException( 'invalid_default_method' );
			}
		}
		$resolved = [];
		foreach ( $rates as $rate ) {
			if ( ! $rate instanceof WC_Shipping_Rate ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$method = $rate->get_method_id();
			$id = $rate->get_id();
			if ( ! self::valid_rate_id( $id ) || ! in_array( $method, [ 'flat_rate', 'free_shipping', 'local_pickup', 'wbs', 'wbsng' ], true ) ) {
				continue;
			}
			$key = self::identity( [ 'methodId' => $method, 'instanceId' => $rate->get_instance_id() ] );
			// A disabled exact override also blocks the broad fallback for that option.
			$row = $config[ $key . '|exact_rate|' . $id ] ?? $config[ $key . '|all_provider_rates' ] ?? null;
			if ( null === $row && in_array( $method, [ 'flat_rate', 'free_shipping', 'local_pickup' ], true ) ) {
				$row = $config[ $key ] ?? null;
			}
			if ( ! $row || true !== $row['enabled'] || ( 'all_provider_rates' === ( $row['mappingKind'] ?? '' ) && true !== ( $row['allRatesConfirmed'] ?? false ) ) ) {
				continue;
			}
			// WBSNG multi-shipment promises require a separate fulfilment contract.
			if ( 'wbsng' === $method && method_exists( $rate, 'get_meta_data' ) && array_key_exists( 'wbsng_solution', $rate->get_meta_data() ) ) {
				continue;
			}
			if ( isset( $resolved[ $id ] ) || ! in_array( $row['fulfilmentType'] ?? null, [ 'delivery', 'collection' ], true ) || ( 'local_pickup' === $method && 'collection' !== $row['fulfilmentType'] ) ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$resolved[ $id ] = [
				'id' => $id, 'eligible' => true,
				'type' => 'collection' === $row['fulfilmentType'] ? 'pickup' : 'delivery',
				'transit' => [ 'min' => $row['minTransitDays'] ?? null, 'max' => $row['maxTransitDays'] ?? null ],
			];
		}
		return array_values( $resolved );
	}

	public static function valid_rate_id( $id ): bool {
		return is_string( $id ) && 1 === preg_match( '/\A[\x21-\x7e]{1,200}\z/', $id );
	}

	public static function mapping_key( array $row ): string {
		$key = self::identity( $row );
		$kind = array_key_exists( 'mappingKind', $row ) ? $row['mappingKind'] : 'core_instance';
		if ( 'exact_rate' === $kind && self::valid_rate_id( $row['rateId'] ?? null ) ) {
			return $key . '|exact_rate|' . $row['rateId'];
		}
		if ( 'all_provider_rates' === $kind ) {
			return $key . '|all_provider_rates';
		}
		if ( 'core_instance' !== $kind ) {
			throw new InvalidArgumentException( 'invalid_method' );
		}
		return $key;
	}

	/** Standard Woo method+instance keys only, without numeric coercion. */
	private static function identity( array $row ): string {
		if ( ! is_string( $row['methodId'] ?? null ) || ! preg_match( '/\A[a-zA-Z0-9_-]{1,100}\z/', $row['methodId'] ) || ! is_int( $row['instanceId'] ?? null ) || $row['instanceId'] < 0 || $row['instanceId'] > 2147483647 ) {
			throw new InvalidArgumentException( 'invalid_method' );
		}
		return $row['methodId'] . ':' . $row['instanceId'];
	}
}

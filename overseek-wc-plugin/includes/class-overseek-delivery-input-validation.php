<?php
/**
 * Bounded v1 input validation. Keep aligned with deliveryEstimates/validation.ts.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/class-overseek-delivery-input-exception.php';

class OverSeek_Delivery_Input_Validation {

	/** Decode objects distinctly from arrays and return canonical validated input. */
	public function validate( string $body ): array {
		$this->require_valid( strlen( $body ) <= 512 * 1024, 'payload_limits_exceeded' );
		$value = json_decode( $body, false, 32, JSON_THROW_ON_ERROR );
		$this->object_keys( $value, [ 'schemaVersion', 'scope', 'entityId', 'revision', 'payload' ] );
		$this->integer( $value->schemaVersion, 1, 1 );
		$this->require_valid( 1 === $value->schemaVersion && in_array( $value->scope, [ 'settings', 'product', 'inbound' ], true ) );
		$this->integer( $value->revision, 1, 9007199254740991 );
		$this->integer( $value->entityId, 'settings' === $value->scope ? 0 : 1, 'settings' === $value->scope ? 0 : 9007199254740991 );
		if ( 'settings' === $value->scope ) {
			$this->object_keys( $value->payload, [ 'enabled', 'settings' ] );
			$this->require_valid( is_bool( $value->payload->enabled ) );
			$this->settings( $value->payload->settings );
		} elseif ( 'inbound' === $value->scope ) {
			require_once __DIR__ . '/class-overseek-delivery-inbound-validation.php';
			( new OverSeek_Delivery_Inbound_Validation() )->validate( $value->payload, $value->entityId );
		} else {
			$this->product( $value->payload, $value->entityId );
		}
		return [
			'scope' => $value->scope,
			'entityId' => (int) $value->entityId,
			'revision' => (int) $value->revision,
			'payload' => $this->canonical( $value->payload ),
		];
	}

	/** Validate exact keys; optional fields retain their presence in the hash. */
	private function object_keys( $value, array $required, array $optional = [] ): void {
		$this->require_valid( $value instanceof stdClass );
		$keys = array_keys( get_object_vars( $value ) );
		$this->require_valid( [] === array_diff( $required, $keys ) && [] === array_diff( $keys, array_merge( $required, $optional ) ) );
	}

	private function require_valid( bool $valid, string $reason = 'schema_invalid' ): void {
		if ( ! $valid ) {
			throw new OverSeek_Delivery_Input_Exception( $reason );
		}
	}

	/** JSON 1.0 and 1e0 are integers in the server's number schema too. */
	private function integer( &$value, int $min, int $max ): void {
		$this->require_valid( ( is_int( $value ) || is_float( $value ) ) && is_finite( (float) $value ) && floor( (float) $value ) === (float) $value && $value >= $min && $value <= $max );
		$value = (int) $value;
	}

	/** Zod string lengths count UTF-16 code units, including astral characters. */
	private function text( $value, int $min, int $max ): void {
		$this->require_valid( is_string( $value ) );
		$length = preg_match_all( '/./us', $value ) + preg_match_all( '/[\x{10000}-\x{10FFFF}]/u', $value );
		$this->require_valid( $length >= $min && $length <= $max );
	}

	private function collection( $value, int $max, int $min = 0 ): void {
		$this->require_valid( is_array( $value ) );
		$this->require_valid( count( $value ) >= $min && count( $value ) <= $max, 'payload_limits_exceeded' );
	}

	private function range( object $value, string $min = 'productionMinDays', string $max = 'productionMaxDays', bool $nullable = true ): void {
		if ( $nullable && null === $value->$min && null === $value->$max ) {
			return;
		}
		try {
			$this->integer( $value->$min, 0, 3650 );
			$this->integer( $value->$max, 0, 3650 );
			$this->require_valid( $value->$min <= $value->$max );
		} catch ( OverSeek_Delivery_Input_Exception $error ) {
			throw new OverSeek_Delivery_Input_Exception( 'productionMinDays' === $min ? 'production_range_invalid' : 'schema_invalid' );
		}
	}

	private function identity( object $value ): string {
		$this->require_valid( is_string( $value->methodId ) && 1 === preg_match( '/\A[a-zA-Z0-9_-]{1,100}\z/', $value->methodId ) );
		$this->integer( $value->instanceId, 0, 2147483647 );
		$kind = property_exists( $value, 'mappingKind' ) ? $value->mappingKind : 'core_instance';
		$this->require_valid( in_array( $kind, [ 'core_instance', 'all_provider_rates', 'exact_rate' ], true ) );
		if ( property_exists( $value, 'rateId' ) ) {
			$this->require_valid( is_string( $value->rateId ) && 1 === preg_match( '/\A[\x21-\x7e]{1,200}\z/', $value->rateId ) && 'core_instance' !== $kind );
		}
		$this->require_valid( 'exact_rate' !== $kind || isset( $value->rateId ) );
		return $value->methodId . ':' . $value->instanceId . ( 'exact_rate' === $kind ? '|exact_rate|' . $value->rateId : ( 'all_provider_rates' === $kind ? '|all_provider_rates' : '' ) );
	}

	private function settings( $settings ): void {
		$this->object_keys( $settings, [ 'cutoffTime', 'timezone', 'fallbackSupplierLeadTimeDays', 'productionWeekdays', 'transitWeekdays', 'closures', 'shippingMethods', 'defaultMethod', 'branding' ], [ 'estimateMode' ] );
		$this->require_valid( ! property_exists( $settings, 'estimateMode' ) || in_array( $settings->estimateMode, [ 'production', 'inventory' ], true ) );
		$this->require_valid( is_string( $settings->cutoffTime ) && 1 === preg_match( '/\A([01]\d|2[0-3]):[0-5]\d\z/', $settings->cutoffTime ) );
		$this->text( $settings->timezone, 1, 100 );
		// IANA identifiers/aliases only, never PHP's numeric offsets or abbreviations.
		$timezones = array_map( 'strtolower', DateTimeZone::listIdentifiers( DateTimeZone::ALL_WITH_BC ) );
		$this->require_valid( 'factory' !== strtolower( $settings->timezone ) && in_array( strtolower( $settings->timezone ), $timezones, true ) );
		$this->integer( $settings->fallbackSupplierLeadTimeDays, 0, 3650 );
		foreach ( [ 'productionWeekdays', 'transitWeekdays' ] as $key ) {
			$this->collection( $settings->$key, 7, 1 );
			foreach ( $settings->$key as &$day ) {
				$this->integer( $day, 0, 6 );
			}
			unset( $day );
			$this->require_valid( count( array_unique( $settings->$key ) ) === count( $settings->$key ) );
		}
		$this->collection( $settings->closures, 3660 );
		foreach ( $settings->closures as $closure ) {
			$this->object_keys( $closure, [ 'date', 'scope' ], [ 'label' ] );
			$this->require_valid( is_string( $closure->date ) && 1 === preg_match( '/\A\d{4}-\d{2}-\d{2}\z/', $closure->date ) );
			$date = DateTimeImmutable::createFromFormat( '!Y-m-d', $closure->date, new DateTimeZone( 'UTC' ) );
			$this->require_valid( false !== $date && $date->format( 'Y-m-d' ) === $closure->date );
			$this->require_valid( in_array( $closure->scope, [ 'work', 'transit', 'both' ], true ) );
			if ( property_exists( $closure, 'label' ) ) {
				$this->text( $closure->label, 0, 100 );
			}
		}
		$this->collection( $settings->shippingMethods, 500 );
		$identities = [];
		foreach ( $settings->shippingMethods as $method ) {
			$this->object_keys( $method, [ 'methodId', 'instanceId', 'zoneId', 'zoneName', 'title', 'enabled', 'minTransitDays', 'maxTransitDays', 'fulfilmentType' ], [ 'mappingKind', 'rateId', 'allRatesConfirmed' ] );
			$key = $this->identity( $method );
			$kind = $method->mappingKind ?? 'core_instance';
			$this->require_valid( ( 'exact_rate' === $kind ) === property_exists( $method, 'rateId' ) );
			$this->require_valid( ! property_exists( $method, 'allRatesConfirmed' ) || is_bool( $method->allRatesConfirmed ) );
			$this->require_valid( 'all_provider_rates' === $kind ? true === ( $method->allRatesConfirmed ?? false ) : true !== ( $method->allRatesConfirmed ?? false ) );
			$this->require_valid( ! array_key_exists( $key, $identities ) && is_bool( $method->enabled ) );
			$identities[ $key ] = $method->enabled;
			$this->integer( $method->zoneId, 0, 2147483647 );
			$this->text( $method->zoneName, 0, 200 );
			$this->text( $method->title, 1, 200 );
			$this->range( $method, 'minTransitDays', 'maxTransitDays', false );
			$this->require_valid( in_array( $method->fulfilmentType, [ 'delivery', 'collection' ], true ) );
		}
		if ( null !== $settings->defaultMethod ) {
			$this->object_keys( $settings->defaultMethod, [ 'methodId', 'instanceId' ], [ 'mappingKind', 'rateId' ] );
			$this->require_valid( true === ( $identities[ $this->identity( $settings->defaultMethod ) ] ?? false ) );
		}
		$this->object_keys( $settings->branding, [ 'textColor', 'accentColor', 'backgroundColor', 'fontSize', 'spacing', 'showIcon' ] );
		foreach ( [ 'textColor', 'accentColor', 'backgroundColor' ] as $key ) {
			$colour = $settings->branding->$key;
			$this->require_valid( null === $colour || ( is_string( $colour ) && 1 === preg_match( '/\A#[0-9a-fA-F]{6}\z/', $colour ) ) );
		}
		$this->integer( $settings->branding->fontSize, 12, 20 );
		$this->require_valid( in_array( $settings->branding->spacing, [ 'compact', 'comfortable' ], true ) && is_bool( $settings->branding->showIcon ) );
	}

	/** Validate only the referenced local product and explicitly supplied variations. */
	private function product( $payload, int $entity_id ): void {
		$this->object_keys( $payload, [ 'wooId', 'productionMinDays', 'productionMaxDays', 'variations' ] );
		$this->integer( $payload->wooId, 1, 9007199254740991 );
		$this->require_valid( $payload->wooId === $entity_id );
		$this->range( $payload );
		$this->collection( $payload->variations, 1000 );
		// Exact full replacement clear: valid even after Woo deletion/trashing. Do not
		// look up a product which need no longer exist. Envelope auth/revision checks
		// still apply, and every nonempty configuration follows the normal validation.
		if ( null === $payload->productionMinDays && null === $payload->productionMaxDays && [] === $payload->variations ) {
			return;
		}
		$product = wc_get_product( $entity_id );
		$this->require_valid( $product instanceof WC_Product && $product->get_id() === $entity_id && 'trash' !== $product->get_status(), 'product_missing' );
		$this->require_valid( $product->is_type( [ 'simple', 'variable', 'grouped', 'external' ] ), 'product_type_unsupported' );
		$this->require_valid( [] === $payload->variations || $product->is_type( 'variable' ), 'product_type_unsupported' );
		$seen = [];
		foreach ( $payload->variations as $variation ) {
			$this->object_keys( $variation, [ 'wooId', 'productionMinDays', 'productionMaxDays' ] );
			$this->integer( $variation->wooId, 1, 9007199254740991 );
			$this->require_valid( ! isset( $seen[ $variation->wooId ] ) );
			$seen[ $variation->wooId ] = true;
			$this->range( $variation );
			$local = wc_get_product( $variation->wooId );
			$this->require_valid( $local instanceof WC_Product_Variation && $local->get_id() === $variation->wooId && $local->is_type( 'variation' ) && 'trash' !== $local->get_status(), 'variation_missing' );
			$this->require_valid( $local->get_parent_id() === $entity_id, 'variation_parent_mismatch' );
		}
	}

	/** Sort object keys recursively; preserve array ordering and null semantics. */
	private function canonical( $value ) {
		if ( $value instanceof stdClass ) {
			$values = get_object_vars( $value );
			ksort( $values, SORT_STRING );
			foreach ( $values as &$child ) {
				$child = $this->canonical( $child );
			}
			return (object) $values;
		}
		return is_array( $value ) ? array_map( [ $this, 'canonical' ], $value ) : $value;
	}
}

<?php
/**
 * Canonical local delivery calculation. See delivery-engine-contract.md.
 * Kept together beyond 200 lines so input validation, shared-stock aggregation
 * and fail-closed whole-order results remain one auditable calculation boundary.
 *
 * @package OverSeek
 */
declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/class-overseek-delivery-calendar.php';

final class OverSeek_Delivery_Engine {
	/** Calculate resolved inputs, returning no partial estimates on any failure. */
	public static function calculate( $input ): array {
		try {
			if ( ! is_array( $input ) ) {
				throw new InvalidArgumentException( 'invalid_input' );
			}
			return self::resolve( $input );
		} catch ( InvalidArgumentException $error ) {
			return [ 'status' => 'unavailable', 'reason' => $error->getMessage() ];
		}
	}

	/** Validate and calculate one ship-together order. */
	private static function resolve( array $input ): array {
		if ( false === ( $input['enabled'] ?? null ) ) {
			throw new InvalidArgumentException( 'feature_off' );
		}
		self::require_true( $input['enabled'] ?? null, 'invalid_input' );
		self::state( $input['context_status'] ?? null, 'context' );
		if ( ! is_string( $input['timezone'] ?? null ) || strlen( $input['timezone'] ) > 100 || 'Factory' === $input['timezone'] || ! in_array( $input['timezone'], DateTimeZone::listIdentifiers( DateTimeZone::ALL_WITH_BC ), true ) ) {
			throw new InvalidArgumentException( 'invalid_timezone' );
		}
		if ( ! is_string( $input['cutoff'] ?? null ) || ! preg_match( '/\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z/', $input['cutoff'] ) ) {
			throw new InvalidArgumentException( 'invalid_cutoff' );
		}
		$now = $input['now'] ?? null;
		if ( ! is_string( $now ) || ! preg_match( '/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])\z/', $now ) || ! OverSeek_Delivery_Calendar::valid_date( substr( $now, 0, 10 ) ) ) {
			throw new InvalidArgumentException( 'invalid_now' );
		}
		$local = ( new DateTimeImmutable( $now ) )->setTimezone( new DateTimeZone( $input['timezone'] ) );
		$today = $local->format( 'Y-m-d' );
		$effective = OverSeek_Delivery_Calendar::add_days( $today, $local->format( 'H:i' ) >= $input['cutoff'] ? 1 : 0 );
		$limit = OverSeek_Delivery_Calendar::add_days( $effective, 60000 );
		foreach ( [ 'work_weekdays', 'transit_weekdays', 'closures', 'items', 'methods', 'stock_owners' ] as $key ) {
			if ( ! is_array( $input[ $key ] ?? null ) ) {
				throw new InvalidArgumentException( 'invalid_input' );
			}
		}
		if ( count( $input['items'] ) > 200 || count( $input['methods'] ) > 100 || count( $input['stock_owners'] ) > 200 ) {
			throw new InvalidArgumentException( 'input_too_large' );
		}
		$work = new OverSeek_Delivery_Calendar( $input['work_weekdays'], $input['closures'], 'work', $limit );
		$transit = new OverSeek_Delivery_Calendar( $input['transit_weekdays'], $input['closures'], 'transit', $limit );
		$fallback = self::range( $input['fallback_lead'] ?? [ 'min' => 30, 'max' => 30 ] );
		$items = [];
		$demand = [];
		foreach ( $input['items'] as $item ) {
			if ( ! is_array( $item ) || ! is_bool( $item['virtual'] ?? null ) || ! is_bool( $item['needs_shipping'] ?? null ) ) {
				throw new InvalidArgumentException( 'invalid_item' );
			}
			if ( $item['virtual'] || ! $item['needs_shipping'] ) {
				continue;
			}
			self::require_true( $item['supported'] ?? null, 'unsupported_item' );
			self::require_true( $item['purchasable'] ?? null, 'blocked_item' );
			self::stock_status( $item['stock_status'] ?? null );
			$item['production'] = self::range( $item['production'] ?? null );
			self::integer( $item['quantity'] ?? null, 1, 1000000, 'invalid_quantity' );
			if ( ! is_bool( $item['managed_stock'] ?? null ) ) {
				throw new InvalidArgumentException( 'invalid_stock' );
			}
			if ( $item['managed_stock'] ) {
				$owner = self::identity( $item['stock_owner'] ?? null );
				$demand[ $owner ] = ( $demand[ $owner ] ?? 0 ) + $item['quantity'];
				self::integer( $demand[ $owner ], 1, 1000000, 'invalid_quantity' );
			} elseif ( 'in_stock' !== $item['stock_status'] ) {
				throw new InvalidArgumentException( 'unsupported_unmanaged_backorder' );
			}
			$items[] = $item;
		}
		if ( ! $items ) {
			throw new InvalidArgumentException( 'no_physical_items' );
		}
		$availability = [];
		foreach ( $demand as $owner => $quantity ) {
			$availability[ $owner ] = self::availability( $input['stock_owners'][ $owner ] ?? null, $quantity, $effective, $today, $limit, $fallback );
		}
		$ready = [ 'min' => $effective, 'max' => $effective ];
		foreach ( $items as $item ) {
			$available = $item['managed_stock'] ? $availability[ $item['stock_owner'] ] : [ 'min' => $effective, 'max' => $effective ];
			foreach ( [ 'min', 'max' ] as $end ) {
				$ready[ $end ] = max( $ready[ $end ], $work->advance( $available[ $end ], $item['production'][ $end ] ) );
			}
		}
		if ( ! $input['methods'] ) {
			throw new InvalidArgumentException( 'no_methods' );
		}
		$methods = [];
		$ids = [];
		foreach ( $input['methods'] as $method ) {
			if ( ! is_array( $method ) ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$id = self::identity( $method['id'] ?? null, true );
			self::require_true( $method['eligible'] ?? null, 'unavailable_method' );
			if ( isset( $ids[ $id ] ) || ! in_array( $method['type'] ?? null, [ 'delivery', 'pickup' ], true ) ) {
				throw new InvalidArgumentException( 'invalid_method' );
			}
			$ids[ $id ] = true;
			$dates = $ready;
			if ( 'delivery' === $method['type'] ) {
				$range = self::range( $method['transit'] ?? null );
				foreach ( [ 'min', 'max' ] as $end ) {
					$dates[ $end ] = $transit->advance( $ready[ $end ], $range[ $end ] );
				}
			}
			$methods[] = [ 'id' => $id, 'type' => $method['type'], 'min' => $dates['min'], 'max' => $dates['max'] ];
		}
		return [ 'status' => 'available', 'timezone' => $input['timezone'], 'effective_date' => $effective, 'readiness' => $ready, 'methods' => $methods ];
	}

	/** Cover aggregate owner demand using dated supply, then conservative lead time. */
	private static function availability( $stock, int $quantity, string $effective, string $today, string $limit, array $fallback ): array {
		if ( ! is_array( $stock ) ) {
			throw new InvalidArgumentException( 'missing_stock_owner' );
		}
		self::stock_status( $stock['stock_status'] ?? null );
		self::integer( $stock['quantity'] ?? null, -1000000, 1000000, 'invalid_stock' );
		if ( ! is_bool( $stock['backorders_allowed'] ?? null ) ) {
			throw new InvalidArgumentException( 'invalid_stock' );
		}
		if ( $stock['quantity'] < 0 && ! array_key_exists( 'prior_demand', $stock ) ) {
			throw new InvalidArgumentException( 'unsupported_negative_stock' );
		}
		$prior = array_key_exists( 'prior_demand', $stock ) ? $stock['prior_demand'] : 0;
		self::integer( $prior, 0, 1000000, 'invalid_prior_demand' );
		$deficit = $quantity + $prior - max( 0, $stock['quantity'] );
		if ( $deficit <= 0 ) {
			return [ 'min' => $effective, 'max' => $effective ];
		}
		self::require_true( $stock['backorders_allowed'], 'backorders_blocked' );
		self::state( $stock['projection_status'] ?? null, 'projection' );
		if ( ! is_array( $stock['inbound'] ?? null ) || count( $stock['inbound'] ) > 1000 ) {
			throw new InvalidArgumentException( 'invalid_projection' );
		}
		$batches = [];
		foreach ( $stock['inbound'] as $batch ) {
			// Invalid/undated/ineligible/overdue rows cannot supply any quantity.
			if ( ! is_array( $batch ) || true !== ( $batch['eligible'] ?? null ) || ! OverSeek_Delivery_Calendar::valid_date( $batch['date'] ?? null ) || ! is_int( $batch['quantity'] ?? null ) || $batch['quantity'] <= 0 || $batch['quantity'] > 1000000 || $batch['date'] < $today ) {
				continue;
			}
			if ( $batch['date'] > $limit ) {
				throw new InvalidArgumentException( 'horizon_exceeded' );
			}
			$batches[] = $batch;
		}
		usort( $batches, static fn( array $a, array $b ): int => strcmp( $a['date'], $b['date'] ) );
		$total = 0;
		$last = $effective;
		foreach ( $batches as $batch ) {
			$total += $batch['quantity'];
			$last = max( $effective, $batch['date'] );
			if ( $total >= $deficit ) {
				return [ 'min' => $last, 'max' => $last ];
			}
		}
		$lead = self::range( $stock['supplier_lead'] ?? $fallback );
		return [
			'min' => max( $last, OverSeek_Delivery_Calendar::add_days( $effective, $lead['min'] ) ),
			'max' => max( $last, OverSeek_Delivery_Calendar::add_days( $effective, $lead['max'] ) ),
		];
	}

	/** Validate an explicitly resolved range; null never means zero. */
	private static function range( $range ): array {
		if ( ! is_array( $range ) ) {
			throw new InvalidArgumentException( 'missing_range' );
		}
		self::integer( $range['min'] ?? null, 0, 3650, 'invalid_range' );
		self::integer( $range['max'] ?? null, $range['min'], 3650, 'invalid_range' );
		return [ 'min' => $range['min'], 'max' => $range['max'] ];
	}

	/** Reject coercion of numeric strings, fractions and booleans. */
	private static function integer( $value, int $min, int $max, string $reason ): void {
		if ( ! is_int( $value ) || $value < $min || $value > $max ) {
			throw new InvalidArgumentException( $reason );
		}
	}

	/** Require explicit authority rather than truthy unknown values. */
	private static function require_true( $value, string $reason ): void {
		if ( true !== $value ) {
			throw new InvalidArgumentException( $reason );
		}
	}

	/** Keep pending, integrity, unsupported and missing states distinguishable. */
	private static function state( $state, string $prefix ): void {
		if ( 'ready' !== $state ) {
			$suffix = in_array( $state, [ 'pending', 'integrity_error', 'unsupported', 'stale' ], true ) ? $state : 'missing';
			throw new InvalidArgumentException( $prefix . '_' . $suffix );
		}
	}

	/** Out-of-stock is authoritative, even if upstream also enabled backorders. */
	private static function stock_status( $status ): void {
		if ( ! in_array( $status, [ 'in_stock', 'on_backorder' ], true ) ) {
			throw new InvalidArgumentException( 'blocked_stock' );
		}
	}

	/** Opaque caller-resolved identities, never shipping labels or DB lookups. */
	private static function identity( $id, bool $rate = false ): string {
		if ( ! is_string( $id ) || ! preg_match( $rate ? '/\A[\x21-\x7e]{1,200}\z/' : '/\A[A-Za-z0-9_.:-]{1,128}\z/', $id ) ) {
			throw new InvalidArgumentException( 'invalid_identity' );
		}
		return $id;
	}
}

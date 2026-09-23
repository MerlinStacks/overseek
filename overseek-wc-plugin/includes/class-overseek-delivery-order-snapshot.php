<?php
/**
 * Callable-only order snapshots; see delivery-order-snapshot.md.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Order_Snapshot {

	public const META_KEY = '_overseek_delivery_estimate_v1';

	/** Parse the exact persisted v1 shape (array or encoded JSON), without coercion. */
	public static function parse( $value ): ?array {
		if ( is_string( $value ) ) {
			if ( strlen( $value ) > 8192 ) {
				return null;
			}
			$value = json_decode( $value, true, 16 );
		}
		if ( ! self::keys( $value, [ 'version', 'capturedAt', 'timezone', 'fulfilmentType', 'method', 'dispatch', 'delivery', 'collection' ] ) ) {
			return null;
		}
		$encoded = json_encode( $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS );
		if ( false === $encoded || strlen( $encoded ) > 8192 || 1 !== $value['version'] || ! self::instant( $value['capturedAt'] ) || ! self::timezone( $value['timezone'] ) || ! self::method( $value['method'] ) || ! self::range( $value['dispatch'] ) ) {
			return null;
		}
		$type = $value['fulfilmentType'];
		if ( ! in_array( $type, [ 'delivery', 'collection' ], true ) ) {
			return null;
		}
		$other = 'delivery' === $type ? 'collection' : 'delivery';
		if ( null !== $value[ $other ] || ! self::range( $value[ $type ] ) || $value[ $type ]['min'] < $value['dispatch']['min'] || $value[ $type ]['max'] < $value['dispatch']['max'] ) {
			return null;
		}
		return $value;
	}

	/** Build only from a complete available canonical result and the caller's actual selection. */
	public static function build( $result, $method, $fulfilment_type, $captured_at ): ?array {
		if ( ! self::keys( $result, [ 'status', 'timezone', 'effective_date', 'readiness', 'methods' ] ) || 'available' !== $result['status'] || ! self::date( $result['effective_date'] ) || ! self::range( $result['readiness'] ) || ! self::method( $method ) || ! in_array( $fulfilment_type, [ 'delivery', 'collection' ], true ) || ! is_array( $result['methods'] ) || count( $result['methods'] ) < 1 || count( $result['methods'] ) > 100 || array_keys( $result['methods'] ) !== range( 0, count( $result['methods'] ) - 1 ) ) {
			return null;
		}
		if ( $result['readiness']['min'] < $result['effective_date'] ) {
			return null;
		}
		$selected = null;
		$seen = [];
		foreach ( $result['methods'] as $row ) {
			if ( ! self::keys( $row, [ 'id', 'type', 'min', 'max' ] ) || ! self::identity( $row['id'], 200 ) || isset( $seen[ $row['id'] ] ) || ! in_array( $row['type'], [ 'delivery', 'pickup' ], true ) || ! self::range( [ 'min' => $row['min'], 'max' => $row['max'] ] ) || $row['min'] < $result['readiness']['min'] || $row['max'] < $result['readiness']['max'] ) {
				return null;
			}
			if ( 'pickup' === $row['type'] && ( $row['min'] !== $result['readiness']['min'] || $row['max'] !== $result['readiness']['max'] ) ) {
				return null;
			}
			$seen[ $row['id'] ] = true;
			if ( $row['id'] === $method['rateId'] ) {
				$selected = $row;
			}
		}
		if ( null === $selected || $selected['type'] !== ( 'collection' === $fulfilment_type ? 'pickup' : 'delivery' ) ) {
			return null;
		}
		return self::parse( [
			'version' => 1,
			'capturedAt' => $captured_at,
			'timezone' => $result['timezone'],
			'fulfilmentType' => $fulfilment_type,
			'method' => $method,
			'dispatch' => $result['readiness'],
			'delivery' => 'delivery' === $fulfilment_type ? [ 'min' => $selected['min'], 'max' => $selected['max'] ] : null,
			'collection' => 'collection' === $fulfilment_type ? [ 'min' => $selected['min'], 'max' => $selected['max'] ] : null,
		] );
	}

	/**
	 * First write via Woo CRUD, serialized with cooperating writers. Never updates.
	 * Context is an explicit caller assertion, not receipt-safety certification.
	 * Returns written, existing, conflict, invalid, invalid_context, lock_unavailable or storage_error.
	 */
	public static function write_first( $order, $result, $method, $fulfilment_type, $captured_at, $context ): string {
		if ( 'final_verified_checkout' !== $context || ! ( $order instanceof WC_Order ) || 'shop_order' !== $order->get_type() || $order->get_id() <= 0 ) {
			return 'invalid_context';
		}
		$snapshot = self::build( $result, $method, $fulfilment_type, $captured_at );
		if ( null === $snapshot ) {
			return 'invalid';
		}
		global $wpdb;
		if ( ! is_object( $wpdb ) ) {
			return 'lock_unavailable';
		}
		// Scope by site/table prefix and order, within MySQL's 64-character limit.
		$lock = 'overseek:de:' . sha1( $wpdb->prefix . ':' . $order->get_id() );
		$locked = false;
		try {
			$locked = '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock, 5 ) );
			if ( ! $locked ) {
				return 'lock_unavailable';
			}
			// A fresh CRUD object avoids saving unrelated caller changes. Force bypass of meta cache.
			$fresh = new WC_Order( $order->get_id() );
			if ( $fresh->get_id() !== $order->get_id() || 'shop_order' !== $fresh->get_type() ) {
				return 'invalid_context';
			}
			$fresh->read_meta_data( true );
			$existing = null;
			foreach ( $fresh->get_meta_data() as $meta ) {
				$data = $meta->get_data();
				if ( self::META_KEY !== $data['key'] ) {
					continue;
				}
				$parsed = self::parse( $data['value'] );
				if ( null === $parsed || ( null !== $existing && $existing != $parsed ) ) {
					return 'conflict';
				}
				$existing = $parsed;
			}
			if ( null !== $existing ) {
				return $existing == $snapshot ? 'existing' : 'conflict';
			}
			$fresh->add_meta_data( self::META_KEY, $snapshot, true );
			$fresh->save_meta_data();
			$fresh->read_meta_data( true );
			$stored = $fresh->get_meta( self::META_KEY, true );
			return self::parse( $stored ) == $snapshot ? 'written' : 'storage_error';
		} catch ( Throwable $error ) {
			return 'storage_error';
		} finally {
			if ( $locked ) {
				try {
					if ( '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) ) ) {
						return 'storage_error';
					}
				} catch ( Throwable $error ) {
					return 'storage_error';
				}
			}
		}
	}

	/** Exact object keys, including required null branches. */
	private static function keys( $value, array $keys ): bool {
		return is_array( $value ) && count( $value ) === count( $keys ) && ! array_diff( $keys, array_keys( $value ) );
	}

	/** Bounded opaque Woo identity; titles are never identity evidence. */
	private static function identity( $value, int $limit ): bool {
		return is_string( $value ) && strlen( $value ) <= $limit && 1 === preg_match( '/\A[\x21-\x7e]+\z/', $value );
	}

	/** Exact selected method metadata. Rate suffixes are permitted, never inferred. */
	private static function method( $value ): bool {
		return self::keys( $value, [ 'methodId', 'instanceId', 'rateId', 'title' ] )
			&& is_string( $value['methodId'] ) && 1 === preg_match( '/\A[A-Za-z0-9_-]{1,100}\z/', $value['methodId'] )
			&& is_int( $value['instanceId'] ) && $value['instanceId'] >= 0 && $value['instanceId'] <= 9007199254740991
			&& self::identity( $value['rateId'], 200 )
			&& self::title( $value['title'] );
	}

	/** JS string length counts astral characters twice; trim uses ECMAScript whitespace. */
	private static function title( $value ): bool {
		if ( ! is_string( $value ) || '' === $value || strlen( $value ) > 1200 || 1 !== preg_match( '//u', $value ) ) {
			return false;
		}
		$whitespace = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';
		if ( preg_match( '/[\x00-\x1f\x7f]/', $value ) || preg_match( '/\A' . $whitespace . '|' . $whitespace . '\z/u', $value ) ) {
			return false;
		}
		return preg_match_all( '/./us', $value ) + preg_match_all( '/[\x{10000}-\x{10FFFF}]/u', $value ) <= 300;
	}

	/** Real Gregorian local label, not an instant. */
	private static function date( $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/', $value ) && checkdate( (int) substr( $value, 5, 2 ), (int) substr( $value, 8, 2 ), (int) substr( $value, 0, 4 ) );
	}

	/** Ordered date-only endpoints. */
	private static function range( $value ): bool {
		return self::keys( $value, [ 'min', 'max' ] ) && self::date( $value['min'] ) && self::date( $value['max'] ) && $value['min'] <= $value['max'];
	}

	/** UTC ISO instant, optional one through three fractional digits. */
	private static function instant( $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,3})?Z\z/', $value ) && self::date( substr( $value, 0, 10 ) );
	}

	/** IANA identifiers, not numeric offsets or PHP's Factory placeholder. */
	private static function timezone( $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 100 && 1 === preg_match( '/\A[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*\z/', $value ) && 'Factory' !== $value && in_array( $value, DateTimeZone::listIdentifiers( DateTimeZone::ALL_WITH_BC ), true );
	}
}

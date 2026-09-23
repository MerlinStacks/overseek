<?php
/**
 * Pure date-label arithmetic for delivery estimates. No WordPress services.
 *
 * @package OverSeek
 */
declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class OverSeek_Delivery_Calendar {
	private array $weekdays;
	private array $closures;
	private string $limit;
	private array $cache = [];
	private int $steps = 0;

	/** Build one scoped calendar; dates are labels represented in UTC, not instants. */
	public function __construct( array $weekdays, array $closures, string $scope, string $limit ) {
		if ( ! in_array( $scope, [ 'work', 'transit' ], true ) || ! self::valid_date( $limit ) || ! $weekdays || count( $weekdays ) > 7 || count( $closures ) > 3660 ) {
			throw new InvalidArgumentException( 'invalid_calendar' );
		}
		$this->weekdays = [];
		foreach ( $weekdays as $day ) {
			if ( ! is_int( $day ) || $day < 0 || $day > 6 || isset( $this->weekdays[ $day ] ) ) {
				throw new InvalidArgumentException( 'invalid_calendar' );
			}
			$this->weekdays[ $day ] = true;
		}
		$this->closures = [];
		foreach ( $closures as $closure ) {
			if ( ! is_array( $closure ) || ! self::valid_date( $closure['date'] ?? null ) || ! in_array( $closure['scope'] ?? null, [ 'work', 'transit', 'both' ], true ) ) {
				throw new InvalidArgumentException( 'invalid_calendar' );
			}
			if ( $scope === $closure['scope'] || 'both' === $closure['scope'] ) {
				$this->closures[ $closure['date'] ] = true;
			}
		}
		$this->limit = $limit;
	}

	/** Strict Gregorian YYYY-MM-DD validation without PHP's overflow correction. */
	public static function valid_date( $date ): bool {
		return is_string( $date ) && 1 === preg_match( '/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/', $date )
			&& checkdate( (int) substr( $date, 5, 2 ), (int) substr( $date, 8, 2 ), (int) substr( $date, 0, 4 ) );
	}

	/** Calendar-day addition; UTC labels deliberately avoid DST duration arithmetic. */
	public static function add_days( string $date, int $days ): string {
		if ( ! self::valid_date( $date ) || $days < 0 || $days > 60000 ) {
			throw new InvalidArgumentException( 'invalid_date' );
		}
		$result = ( new DateTimeImmutable( $date, new DateTimeZone( 'UTC' ) ) )->modify( '+' . $days . ' days' )->format( 'Y-m-d' );
		if ( ! self::valid_date( $result ) ) {
			throw new InvalidArgumentException( 'horizon_exceeded' );
		}
		return $result;
	}

	/** Normalize first, then add enabled-day offsets. Zero never adds another day. */
	public function advance( string $date, int $days ): string {
		if ( ! self::valid_date( $date ) || $days < 0 || $days > 3650 ) {
			throw new InvalidArgumentException( 'invalid_range' );
		}
		$key = $date . ':' . $days;
		if ( isset( $this->cache[ $key ] ) ) {
			return $this->cache[ $key ];
		}
		$cursor = new DateTimeImmutable( $date, new DateTimeZone( 'UTC' ) );
		while ( true ) {
			$date = $cursor->format( 'Y-m-d' );
			if ( $date > $this->limit || ++$this->steps > 1000000 ) {
				throw new InvalidArgumentException( 'horizon_exceeded' );
			}
			if ( isset( $this->weekdays[ (int) $cursor->format( 'w' ) ] ) && ! isset( $this->closures[ $date ] ) ) {
				if ( 0 === $days ) {
					$this->cache[ $key ] = $date;
					return $date;
				}
				--$days;
			}
			$cursor = $cursor->modify( '+1 day' );
		}
	}
}

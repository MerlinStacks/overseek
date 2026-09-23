<?php
/** Shared, escaped delivery presentation. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-overseek-delivery-calendar.php';

final class OverSeek_Delivery_Display {
	/** Format only one unambiguous engine-returned method, never settings dates. */
	public static function method_text( array $result, string $rate_id ): string {
		if ( 'available' !== ( $result['status'] ?? null ) || ! is_array( $result['methods'] ?? null ) || '' === $rate_id ) {
			return '';
		}
		$matches = array_values( array_filter( $result['methods'], static fn( $row ) => is_array( $row ) && ( $row['id'] ?? null ) === $rate_id ) );
		if ( 1 !== count( $matches ) ) {
			return '';
		}
		$row = $matches[0];
		if ( ! in_array( $row['type'] ?? null, [ 'delivery', 'pickup' ], true ) || ! OverSeek_Delivery_Calendar::valid_date( $row['min'] ?? null ) || ! OverSeek_Delivery_Calendar::valid_date( $row['max'] ?? null ) || $row['min'] > $row['max'] ) {
			return '';
		}
		// Date-only labels are not instants: explicit UTC prevents store timezone day shifts.
		$format = get_option( 'date_format', 'F j, Y' );
		$format = is_string( $format ) && '' !== $format ? $format : 'F j, Y';
		$date = static fn( string $value ): string => wp_date( $format, ( new DateTimeImmutable( $value, new DateTimeZone( 'UTC' ) ) )->getTimestamp(), new DateTimeZone( 'UTC' ) );
		$range = $date( $row['min'] );
		if ( $row['min'] !== $row['max'] ) {
			$range = sprintf( __( '%1$s – %2$s', 'overseek-wc' ), $range, $date( $row['max'] ) );
		}
		return sprintf( 'pickup' === $row['type'] ? __( 'Ready for collection: %s', 'overseek-wc' ) : __( 'Estimated delivery: %s', 'overseek-wc' ), $range );
	}

	/** Small self-contained styling also works in classic shipping-rate callbacks. */
	public static function method_html( array $result, string $rate_id, array $branding = [] ): string {
		$text = self::method_text( $result, $rate_id );
		if ( '' === $text ) {
			return '';
		}
		$style = 'display:inline-flex;align-items:baseline;gap:.35em;max-width:100%;box-sizing:border-box;font-family:inherit;font-weight:inherit;line-height:1.4;white-space:normal;overflow-wrap:anywhere;';
		foreach ( [ 'textColor' => 'color', 'backgroundColor' => 'background-color' ] as $key => $property ) {
			if ( self::color( $branding[ $key ] ?? null ) ) {
				$style .= $property . ':' . $branding[ $key ] . ';';
			}
		}
		$size = $branding['fontSize'] ?? 14;
		$style .= 'font-size:' . ( is_int( $size ) && $size >= 12 && $size <= 20 ? $size : 14 ) . 'px;';
		$style .= 'padding:' . ( 'comfortable' === ( $branding['spacing'] ?? null ) ? '.35em .5em' : '.15em 0' ) . ';';
		$icon = '';
		if ( true === ( $branding['showIcon'] ?? false ) ) {
			$accent = self::color( $branding['accentColor'] ?? null ) ? 'color:' . $branding['accentColor'] . ';' : '';
			$icon = '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="flex:none;width:1em;height:1em;' . esc_attr( $accent ) . '"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>';
		}
		return '<span class="os-delivery-estimate" style="' . esc_attr( $style ) . '">' . $icon . '<span style="min-width:0">' . esc_html( $text ) . '</span></span>';
	}

	/** No CSS functions, named values or arbitrary markup. */
	private static function color( $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/\A#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})\z/', $value );
	}
}

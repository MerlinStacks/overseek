<?php
/** Internal read-only product batch service; not a registered endpoint. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-overseek-delivery-storefront-context.php';
require_once __DIR__ . '/class-overseek-delivery-display.php';

final class OverSeek_Delivery_Product_Service {
	private $calculate;
	private $settings;

	/** @internal Callable seams are for offline tests, never request/filter configuration. */
	public function __construct( ?callable $calculate = null, ?callable $settings = null ) {
		$this->calculate = $calculate ?? static fn( array $cart, array $rates ): array => ( new OverSeek_Delivery_Live_Adapter() )->calculate( $cart, $rates );
		$this->settings = $settings ?? static fn() => ( new OverSeek_Delivery_Input_Storage() )->read_settings();
	}

	/** @internal Bounded JSON or decoded form items; only safe identities/HTML leave here. */
	public function batch( $items ): array {
		if ( is_string( $items ) && strlen( $items ) <= 8192 ) {
			$items = json_decode( $items, true, 8 );
		}
		if ( ! is_array( $items ) || count( $items ) > 20 || array_values( $items ) !== $items ) {
			return [];
		}
		$valid = [];
		foreach ( $items as $item ) {
			if ( ! is_array( $item ) || count( $item ) > 4 || ! is_string( $item['request_id'] ?? null ) || ! preg_match( '/\A[a-zA-Z0-9_-]{1,64}\z/', $item['request_id'] ) ) {
				return [];
			}
			foreach ( [ 'product_id' => 2147483647, 'variation_id' => 2147483647, 'quantity' => 1000000 ] as $field => $max ) {
				$value = $item[ $field ] ?? ( 'variation_id' === $field ? 0 : null );
				if ( ! ( is_int( $value ) || ( is_string( $value ) && strlen( $value ) <= 10 && preg_match( '/\A(?:0|[1-9][0-9]*)\z/', $value ) ) ) || $value < ( 'variation_id' === $field ? 0 : 1 ) || $value > $max ) {
					return [];
				}
				$item[ $field ] = (int) $value;
			}
			if ( isset( $valid[ $item['request_id'] ] ) ) {
				return [];
			}
			$valid[ $item['request_id'] ] = $item;
		}
		$rows = []; $cache = [];
		foreach ( $valid as $item ) {
			$key = $item['product_id'] . ':' . $item['variation_id'] . ':' . $item['quantity'];
			if ( ! array_key_exists( $key, $cache ) ) {
				try {
					$cache[ $key ] = $this->estimate( $item );
				} catch ( Throwable $error ) {
					$cache[ $key ] = '';
				}
			}
			$rows[] = [ 'request_id' => $item['request_id'], 'product_id' => $item['product_id'], 'variation_id' => $item['variation_id'], 'html' => $cache[ $key ] ];
		}
		return $rows;
	}

	/** Validate public parent and variation before touching private delivery inputs. */
	private function estimate( array $item ): string {
		$parent = wc_get_product( $item['product_id'] );
		if ( ! self::public_product( $parent ) || ! $parent->is_type( [ 'simple', 'variable' ] ) ) {
			return '';
		}
		$product = $parent;
		if ( $item['variation_id'] ) {
			$product = wc_get_product( $item['variation_id'] );
			if ( ! $parent->is_type( 'variable' ) || ! self::public_product( $product ) || ! $product instanceof WC_Product_Variation || $product->get_parent_id() !== $parent->get_id() || ! $product->variation_is_active() || ! $product->variation_is_visible() ) {
				return '';
			}
		} elseif ( ! $parent->is_type( 'simple' ) ) {
			return '';
		}
		$row = ( $this->settings )();
		if ( ! is_array( $row ) || ! is_int( $row['revision'] ?? null ) || $row['revision'] < 1 || true !== ( $row['payload']['enabled'] ?? null ) || ! is_array( $row['payload']['settings'] ?? null ) ) {
			return '';
		}
		$settings = $row['payload']['settings'];
		if ( ( WC()->cart && count( WC()->cart->get_shipping_packages() ) > 1 ) || ( WC()->shipping && count( WC()->shipping->get_packages() ) > 1 ) ) {
			return '';
		}
		$unknown = ! OverSeek_Delivery_Storefront_Context::has_known_address();
		$package = $unknown ? null : OverSeek_Delivery_Storefront_Context::current_package();
		$previous = $package && WC()->session ? WC()->session->get( 'chosen_shipping_methods', [] ) : [];
		$selection = self::select_rate( $settings, $unknown, $package, is_array( $previous ) ? ( $previous[ $package['overseek_package_key'] ?? 0 ] ?? '' ) : '' );
		if ( ! $selection ) {
			return '';
		}
		$result = ( $this->calculate )( [ [ 'product_id' => $item['product_id'], 'variation_id' => $item['variation_id'], 'quantity' => $item['quantity'], 'data' => $product ] ], [ $selection ] );
		$html = OverSeek_Delivery_Display::method_html( $result, $selection->get_id(), is_array( $settings['branding'] ?? null ) ? $settings['branding'] : [] );
		if ( $unknown && '' !== $html ) {
			$html .= '<span class="os-delivery-default">' . esc_html__( 'Estimate for the configured default method; confirm at checkout.', 'overseek-wc' ) . '</span>';
		}
		return $html;
	}

	/** @internal Actual option identities only; never infer provider rules or choose a third service. */
	public static function select_rate( array $settings, bool $unknown, ?array $package, $previous ): ?WC_Shipping_Rate {
		$default = $settings['defaultMethod'] ?? null;
		$default_id = is_array( $default ) && is_string( $default['methodId'] ?? null ) && is_int( $default['instanceId'] ?? null ) ? ( $default['rateId'] ?? $default['methodId'] . ':' . $default['instanceId'] ) : '';
		if ( $unknown ) {
			if ( ! $default_id ) {
				return null;
			}
			// Timing-only stand-in; never inserted into Woo packages, session or cart.
			$rate = new WC_Shipping_Rate( $default_id, '', 0, [], $default['methodId'], $default['instanceId'] );
			return self::eligible( $settings, $rate ) ? $rate : null;
		}
		foreach ( array_unique( [ is_string( $previous ) ? $previous : '', isset( $default['rateId'] ) ? $default_id : '' ] ) as $id ) {
			$rate = $package['rates'][ $id ] ?? null;
			$is_previous = is_string( $previous ) && $id === $previous;
			if ( $rate instanceof WC_Shipping_Rate && $rate->get_id() === $id && ( $is_previous || ( is_array( $default ) && $rate->get_method_id() === $default['methodId'] && $rate->get_instance_id() === $default['instanceId'] ) ) && self::eligible( $settings, $rate ) ) {
				return $rate;
			}
		}
		// An instance default without a nominated option is usable only if unambiguous.
		if ( is_array( $default ) && in_array( $default['mappingKind'] ?? 'core_instance', [ 'core_instance', 'all_provider_rates' ], true ) && ! isset( $default['rateId'] ) ) {
			$matches = [];
			foreach ( $package['rates'] ?? [] as $rate ) {
				if ( $rate instanceof WC_Shipping_Rate && $rate->get_method_id() === $default['methodId'] && $rate->get_instance_id() === $default['instanceId'] && self::eligible( $settings, $rate ) ) {
					$matches[] = $rate;
				}
			}
			return 1 === count( $matches ) ? $matches[0] : null;
		}
		return null;
	}

	/** Validation uses the existing adapter's authoritative supported method policy. */
	private static function eligible( array $settings, WC_Shipping_Rate $rate ): bool {
		try {
			return 1 === count( OverSeek_Delivery_Rate_Resolver::resolve( $settings, [ $rate ] ) );
		} catch ( Throwable $error ) {
			return false;
		}
	}

	/** Password-protected objects remain private even for a logged-in AJAX caller. */
	private static function public_product( $product ): bool {
		return $product instanceof WC_Product && 'publish' === $product->get_status() && '' === (string) get_post_field( 'post_password', $product->get_id() );
	}
}

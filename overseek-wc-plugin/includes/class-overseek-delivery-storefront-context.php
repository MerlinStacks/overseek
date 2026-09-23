<?php
/** Read-only complete-current-package certification. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-overseek-delivery-storefront-gate.php';
require_once __DIR__ . '/class-overseek-delivery-live-adapter.php';
require_once __DIR__ . '/class-overseek-delivery-session-quotes.php';
require_once __DIR__ . '/class-overseek-delivery-render-cache.php';

final class OverSeek_Delivery_Storefront_Context {
	/** Reuse only after a fresh receipt/input/stock fence certifies the same snapshot. */
	public static function cart_result( array $rates ): array {
		$unavailable = [ 'status' => 'unavailable', 'reason' => 'storefront_inactive' ];
		if ( ! OverSeek_Delivery_Render_Cache::has_entry() && ! OverSeek_Delivery_Storefront_Gate::is_active() ) {
			return $unavailable;
		}
		return self::resolve_cart( $rates );
	}

	/** @internal Read-only implementation, separated for offline contract verification. */
	public static function resolve_cart( array $rates ): array {
		try {
			$package = self::current_package();
			if ( ! $package || ! $rates ) {
				return [ 'status' => 'unavailable', 'reason' => 'current_package_missing' ];
			}
			$seen = [];
			foreach ( $rates as $rate ) {
				if ( ! $rate instanceof WC_Shipping_Rate || isset( $seen[ $rate->get_id() ] ) || ( $package['rates'][ $rate->get_id() ] ?? null ) !== $rate ) {
					return [ 'status' => 'unavailable', 'reason' => 'rate_not_current' ];
				}
				$seen[ $rate->get_id() ] = true;
			}
			return OverSeek_Delivery_Render_Cache::calculate( WC()->cart->get_cart(), $package );
		} catch ( Throwable $error ) {
			return [ 'status' => 'unavailable', 'reason' => 'context_unavailable' ];
		}
	}

	/**
	 * @internal Prefer loaded current rates; otherwise certify a native session quote hash.
	 * get_shipping_packages builds inputs; get_packages reads the shipping object's state.
	 */
	public static function current_package(): ?array {
		try {
			$woo = WC();
			if ( ! $woo || ! $woo->cart || ! $woo->customer || ! $woo->shipping || 'yes' === get_option( 'woocommerce_shipping_debug_mode', 'no' ) ) {
				return null;
			}
			$current = $woo->cart->get_shipping_packages();
			$loaded = $woo->shipping->get_packages();
			if ( 1 !== count( $current ) || count( $loaded ) > 1 || ( $loaded && array_keys( $current ) !== array_keys( $loaded ) ) ) {
				return null;
			}
			$key = array_key_first( $current );
			$input = $current[ $key ];
			$cart = self::contents( $woo->cart->get_cart() );
			if ( ! $cart || $cart !== self::contents( $input['contents'] ?? [] ) ) {
				return null;
			}
			$destination = self::destination();
			if ( '' === $destination['country'] ) {
				return null;
			}
			foreach ( $destination as $field => $value ) {
				if ( ( $input['destination'][ $field ] ?? null ) !== $value ) {
					return null;
				}
			}
			if ( $loaded ) {
				$package = $loaded[ $key ];
				// An existing mismatched/empty loaded package must not revive an older quote.
				foreach ( $input as $field => $value ) {
					if ( 'rates' !== $field && ( $package[ $field ] ?? null ) !== $value ) {
						return null;
					}
				}
			} else {
				$package = $input;
				$package['rates'] = OverSeek_Delivery_Session_Quotes::rates( $input, $key );
			}
			if ( ! OverSeek_Delivery_Session_Quotes::valid_rates( $package['rates'] ?? null ) ) {
				return null;
			}
			$package['overseek_package_key'] = $key;
			return $package;
		} catch ( Throwable $error ) {
			return null;
		}
	}

	/**
	 * @internal Country/state may be Woo base/geolocation defaults, not address evidence.
	 * WC loads calculated_shipping and entered addresses from its validated customer
	 * session; logged-in saved shipping fields are already loaded by WC_Customer.
	 */
	public static function has_known_address(): bool {
		$customer = WC()->customer;
		if ( true === $customer->get_calculated_shipping() ) {
			return true;
		}
		foreach ( [ 'address_1', 'city', 'postcode' ] as $field ) {
			if ( '' !== trim( (string) $customer->{ 'get_shipping_' . $field }( 'edit' ) ) ) {
				return true;
			}
		}
		return false;
	}

	/** @internal Actual customer shipping destination only; never request supplied. */
	public static function destination(): array {
		$customer = WC()->customer;
		$destination = [];
		foreach ( [ 'country', 'state', 'postcode', 'city', 'address_1', 'address_2' ] as $field ) {
			$destination[ 'address_1' === $field ? 'address' : $field ] = (string) $customer->{ 'get_shipping_' . $field }();
		}
		return $destination;
	}

	/** Snapshot identities/quantities by cart key; reject duplicates and partial shipments. */
	private static function contents( array $lines ): array {
		$result = [];
		foreach ( $lines as $key => $line ) {
			$product = $line['data'] ?? null;
			if ( ! $product instanceof WC_Product ) {
				throw new InvalidArgumentException( 'invalid_cart' );
			}
			if ( $product->is_virtual() || ! $product->needs_shipping() ) {
				continue;
			}
			$result[ $key ] = [ $line['product_id'] ?? null, $line['variation_id'] ?? null, $line['quantity'] ?? null, $product->get_id() ];
		}
		ksort( $result );
		return $result;
	}
}

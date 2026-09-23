<?php
/** Final checkout promise capture, using Woo CRUD only. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Checkout_Capture {

	/** Register once from the parent bootstrap, after Woo is available. */
	public static function register(): void {
		add_action( 'woocommerce_checkout_order_processed', [ self::class, 'classic' ], PHP_INT_MAX, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', [ self::class, 'blocks' ], PHP_INT_MAX, 1 );
	}

	/** Classic has saved line items and shipping before this pre-payment action. */
	public static function classic( $order_id, $posted_data, $order ): void {
		if ( 'woocommerce_checkout_order_processed' === current_filter() && $order instanceof WC_Order && (int) $order_id === $order->get_id() ) {
			self::capture( $order, false );
		}
	}

	/** POST place-order only; never subscribe to Store API draft/meta update hooks. */
	public static function blocks( $order ): void {
		if ( 'woocommerce_store_api_checkout_order_processed' === current_filter() ) {
			self::capture( $order, true );
		}
	}

	/** Missing evidence is an omitted promise, never a checkout error. */
	private static function capture( $order, bool $blocks ): void {
		try {
			if ( ! class_exists( 'OverSeek_Delivery_Storefront_Gate', false ) ) {
				require_once __DIR__ . '/class-overseek-delivery-storefront-gate.php';
			}
			if ( ! OverSeek_Delivery_Storefront_Gate::is_active() || ! $order instanceof WC_Order || $order->get_id() <= 0 || 'shop_order' !== $order->get_type() ) {
				return;
			}
			// Woo 9.7 still has checkout-draft here; newer Woo sets pending first.
			// The processed action, not draft status or needs_payment(), certifies submission.
			if ( ! in_array( $order->get_status(), $blocks ? [ 'checkout-draft', 'pending', 'failed' ] : [ 'pending', 'failed' ], true ) || $order->get_date_paid() ) {
				return;
			}
			foreach ( [ 'Storefront_Context', 'Order_Snapshot' ] as $dependency ) {
				if ( ! class_exists( 'OverSeek_Delivery_' . $dependency, false ) ) {
					require_once __DIR__ . '/class-overseek-delivery-' . str_replace( '_', '-', strtolower( $dependency ) ) . '.php';
				}
			}
			$woo = WC();
			if ( ! $woo || ! $woo->cart || ! $woo->session || ! $woo->customer ) {
				return;
			}
			$package = OverSeek_Delivery_Storefront_Context::current_package();
			$chosen = $woo->session->get( 'chosen_shipping_methods' );
			if ( ! $package || ! is_array( $chosen ) || 1 !== count( $chosen ) ) {
				return;
			}
			$id = $chosen[ $package['overseek_package_key'] ] ?? null;
			$rate = is_string( $id ) ? ( $package['rates'][ $id ] ?? null ) : null;
			if ( ! $rate instanceof WC_Shipping_Rate || $id !== $rate->get_id() || 'pickup_location' === $rate->get_method_id() ) {
				return;
			}
			$instance = self::instance( $rate->get_instance_id(), $rate->get_method_id() );
			if ( null === $instance ) {
				return;
			}
			$method = [ 'methodId' => $rate->get_method_id(), 'instanceId' => $instance, 'rateId' => $id, 'title' => $rate->get_label() ];
			$cart = self::cart_lines( $woo->cart->get_cart() );
			// Compare both hook object and saved CRUD state; extensions may have changed either.
			$fresh = new WC_Order( $order->get_id() );
			foreach ( [ $order, $fresh ] as $candidate ) {
				if ( $candidate->meta_exists( OverSeek_Delivery_Order_Snapshot::META_KEY ) || ! self::matches( $candidate, $cart, $method, $rate ) ) {
					return;
				}
			}
			// Identical local path to cart/checkout display, with all current actual rates.
			$result = OverSeek_Delivery_Storefront_Context::cart_result( $package['rates'] );
			if ( 'available' !== ( $result['status'] ?? null ) ) {
				return;
			}
			foreach ( $result['methods'] as $row ) {
				if ( $id === $row['id'] ) {
					$written = OverSeek_Delivery_Order_Snapshot::write_first( $order, $result, $method, 'pickup' === $row['type'] ? 'collection' : 'delivery', gmdate( 'Y-m-d\TH:i:s\Z' ), 'final_verified_checkout' );
					if ( 'written' === $written || 'existing' === $written ) {
						// Payment/email callbacks may reuse this object in the same request.
						$order->read_meta_data( true );
					}
					return;
				}
			}
		} catch ( Throwable $error ) {
			// A promise must never block placing or paying for an order.
		}
	}

	/** Woo item getters return numeric strings in some versions; no lossy coercion. */
	private static function instance( $value, string $method ): ?int {
		if ( in_array( $method, [ 'wbs', 'wbsng' ], true ) && ( -1 === $value || '-1' === $value ) ) {
			return 0; // Vendor global instance sentinel; never decode opaque rate IDs.
		}
		if ( is_string( $value ) && preg_match( '/\A(?:0|[1-9][0-9]{0,9})\z/', $value ) ) {
			$value = (int) $value;
		}
		return is_int( $value ) && $value >= 0 ? $value : null;
	}

	/** Compare a multiset of complete lines, including virtual lines and split cart keys. */
	private static function cart_lines( array $cart ): array {
		$lines = [];
		foreach ( $cart as $line ) {
			if ( ! ( $line['data'] ?? null ) instanceof WC_Product || $line['data']->get_id() !== ( ( $line['variation_id'] ?? 0 ) ?: ( $line['product_id'] ?? 0 ) ) ) {
				throw new InvalidArgumentException( 'cart_identity' );
			}
			$lines[] = self::line( $line['product_id'] ?? null, $line['variation_id'] ?? null, $line['quantity'] ?? null );
		}
		sort( $lines );
		return $lines;
	}

	/** Bounded positive integral quantities only, matching the local adapter contract. */
	private static function line( $product, $variation, $quantity ): array {
		foreach ( [ $product, $variation, $quantity ] as $value ) {
			if ( ! is_numeric( $value ) || (float) (int) $value !== (float) $value ) {
				throw new InvalidArgumentException( 'line_identity' );
			}
		}
		if ( $product <= 0 || $variation < 0 || $quantity <= 0 || $quantity > 1000000 ) {
			throw new InvalidArgumentException( 'line_quantity' );
		}
		return [ (int) $product, (int) $variation, (int) $quantity ];
	}

	/** Exact shipping choice and complete order/cart context; no partial promises. */
	private static function matches( WC_Order $order, array $cart, array $method, WC_Shipping_Rate $rate ): bool {
		$lines = [];
		foreach ( $order->get_items( 'line_item' ) as $item ) {
			$lines[] = self::line( $item->get_product_id(), $item->get_variation_id(), $item->get_quantity() );
		}
		sort( $lines );
		if ( ! $cart || $cart !== $lines ) {
			return false;
		}
		$shipping = $order->get_items( 'shipping' );
		if ( 1 !== count( $shipping ) ) {
			return false;
		}
		$item = reset( $shipping );
		if ( $item->get_method_id() !== $method['methodId'] || self::instance( $item->get_instance_id(), $item->get_method_id() ) !== $method['instanceId'] || $item->get_method_title() !== $method['title'] ) {
			return false;
		}
		if ( (string) wc_format_decimal( $item->get_total() ) !== (string) wc_format_decimal( $rate->get_cost() ) || $item->get_taxes()['total'] != $rate->get_taxes() ) {
			return false;
		}
		// Core shipping items omit opaque option IDs. Session + current package are
		// authoritative; if an extension persists one, it must agree as well.
		foreach ( [ 'rate_id', '_rate_id' ] as $key ) {
			if ( $item->meta_exists( $key ) && $item->get_meta( $key, true ) !== $method['rateId'] ) {
				return false;
			}
		}
		foreach ( OverSeek_Delivery_Storefront_Context::destination() as $field => $value ) {
			$field = 'address' === $field ? 'address_1' : $field;
			if ( (string) $order->{ 'get_shipping_' . $field }() !== $value ) {
				return false;
			}
		}
		return true;
	}
}

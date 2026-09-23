<?php
/**
 * Dormant, additive cart/checkout delivery presentation.
 *
 * @package OverSeek
 */

defined( 'ABSPATH' ) || exit;

class OverSeek_Delivery_Cart_Display {

	/** @var bool Prevent re-entry from third-party getters/context hooks. */
	private $rendering = false;

	/** Register placements only; construction never reads the cart. */
	public function __construct() {
		add_action( 'woocommerce_after_shipping_rate', array( $this, 'after_shipping_rate' ), 10, 2 );
		add_filter( 'woocommerce_shipping_rate_delivery_time', array( $this, 'delivery_time' ), 10, 2 );
	}

	/**
	 * Add the shared renderer's escaped scoped HTML in classic templates only.
	 *
	 * @param mixed $rate Shipping rate from the template.
	 * @param mixed $index Current package key (not the selected-rate index).
	 * @return void
	 */
	public function after_shipping_rate( $rate, $index ) {
		try {
			if ( $this->rendering || ! $this->is_storefront() ) {
				return;
			}
			// Blocks use their native delivery_time field, not this template action.
			if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
				return;
			}
			if ( ! is_int( $index ) && ! is_string( $index ) ) {
				return;
			}
			$this->rendering = true;
			try {
				$rates = $this->current_rates( $rate, $index );
				if ( null === $rates ) {
					return;
				}
				$this->load_dependencies();
				$result = OverSeek_Delivery_Storefront_Context::cart_result( $rates );
				// Escaping and bounded scoped styling belong to the shared renderer.
				$html = OverSeek_Delivery_Display::method_html( $result, $rate->get_id(), array() );
				if ( '' !== $html ) {
					echo '<div class="overseek-delivery-cart-estimate" style="display:block;margin-top:.15em">' . $html . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				}
			} finally {
				$this->rendering = false;
			}
		} catch ( Throwable $error ) {
			// Presentation must never interrupt checkout or expose internal errors.
		}
	}

	/**
	 * Supply native Blocks text only when the provider left the field blank.
	 *
	 * @param mixed $original Existing provider delivery time, preserved verbatim.
	 * @param mixed $rate Rate whose getter is applying this filter.
	 * @return mixed
	 */
	public function delivery_time( $original, $rate ) {
		try {
			if ( '' !== $original || $this->rendering ) {
				return $original;
			}
			if ( ! defined( 'WC_VERSION' ) || version_compare( WC_VERSION, '9.7', '<' ) || ! $rate instanceof WC_Shipping_Rate || ! method_exists( $rate, 'get_delivery_time' ) || ! is_callable( array( $rate, 'get_delivery_time' ) ) || ! $this->is_storefront() ) {
				return $original;
			}
			$this->rendering = true;
			try {
				$rates = $this->current_rates( $rate );
				if ( null === $rates ) {
					return $original;
				}
				$this->load_dependencies();
				$result = OverSeek_Delivery_Storefront_Context::cart_result( $rates );
				return OverSeek_Delivery_Display::method_text( $result, $rate->get_id() );
			} finally {
				$this->rendering = false;
			}
		} catch ( Throwable $error ) {
			return $original;
		}
	}

	/** Load shared presentation/calculation classes only for an active valid rate.
	 *
	 * @return void
	 */
	private function load_dependencies() {
		if ( ! class_exists( 'OverSeek_Delivery_Display', false ) ) {
			require_once __DIR__ . '/class-overseek-delivery-display.php';
		}
		if ( ! class_exists( 'OverSeek_Delivery_Storefront_Context', false ) ) {
			require_once __DIR__ . '/class-overseek-delivery-storefront-context.php';
		}
	}

	/**
	 * Restrict reads to customer cart/checkout requests (including Store API).
	 *
	 * @return bool
	 */
	private function is_storefront() {
		if ( is_admin() || ( defined( 'WP_CLI' ) && WP_CLI ) || ( defined( 'DOING_CRON' ) && DOING_CRON ) ) {
			return false;
		}
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			global $wp;
			$route = $wp->query_vars['rest_route'] ?? '';
			return is_string( $route ) && 1 === preg_match( '#^/wc/store/v[0-9]+/(?:cart|checkout|batch)(?:/|$)#D', $route );
		}
		if ( defined( 'WC_DOING_AJAX' ) && WC_DOING_AJAX ) {
			return in_array( $_GET['wc-ajax'] ?? '', array( 'update_order_review', 'update_shipping_method' ), true ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		}
		return ( is_cart() || is_checkout() ) && ! is_order_received_page() && ! is_checkout_pay_page();
	}

	/**
	 * Capture already-calculated rates, never a selected-only or synthetic list.
	 * The shared context validates the complete cart/package and delegates all
	 * eligibility, whole-order dates and managed-stock safety to the local adapter.
	 * Object identity prevents stale or foreign rates with a reused ID matching.
	 *
	 * @param mixed $rate Actual callback rate.
	 * @param mixed $index Classic package key; null for the package-less filter.
	 * @return array|null
	 */
	private function current_rates( $rate, $index = null ) {
		if ( ! $rate instanceof WC_Shipping_Rate ) {
			return null;
		}
		$woo = WC();
		if ( ! $woo || ! $woo->cart || ! $woo->session || ! $woo->customer ) {
			return null;
		}
		$shipping = $woo->shipping();
		$packages = $shipping ? $shipping->get_packages() : null;
		if ( ! is_array( $packages ) || 1 !== count( $packages ) ) {
			return null;
		}
		$key = array_key_first( $packages );
		if ( null !== $index && ( ! is_int( $index ) && ! is_string( $index ) || (string) $key !== (string) $index ) ) {
			return null;
		}
		$package = $packages[ $key ];
		if ( ! is_array( $package ) || empty( $package['contents'] ) || ! is_array( $package['contents'] ) || ! isset( $package['rates'] ) || ! is_array( $package['rates'] ) ) {
			return null;
		}
		$id = $rate->get_id();
		if ( ! is_string( $id ) || '' === $id || ! isset( $package['rates'][ $id ] ) || $package['rates'][ $id ] !== $rate ) {
			return null;
		}
		return $package['rates'];
	}
}

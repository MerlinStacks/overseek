<?php
/**
 * Authenticated, read-only delivery integration discovery.
 *
 * @package OverSeek
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OverSeek_Delivery_Discovery_API {
	/** Observe an administrator's normal calculation only; never request/recalculate rates. */
	public static function capture_admin_rates( $rates ) {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! is_array( $rates ) || count( $rates ) > 100 ) {
			return $rates;
		}
		$account = get_option( 'overseek_account_id', '' );
		if ( ! is_string( $account ) || '' === $account ) {
			return $rates;
		}
		$observed = [];
		foreach ( $rates as $rate ) {
			if ( ! $rate instanceof WC_Shipping_Rate || ! preg_match( '/\A[\x21-\x7e]{1,200}\z/', $rate->get_id() ) || ! preg_match( '/\A[A-Za-z0-9_-]{1,100}\z/', $rate->get_method_id() ) || $rate->get_instance_id() < 0 || $rate->get_instance_id() > 2147483647 ) {
				continue;
			}
			$label = $rate->get_label();
			if ( ! is_string( $label ) || strlen( $label ) > 4096 || 1 !== preg_match( '/\A.{0,100}/us', sanitize_text_field( $label ), $title ) ) { continue; }
			$observed[] = [ 'methodId' => $rate->get_method_id(), 'instanceId' => $rate->get_instance_id(), 'rateId' => $rate->get_id(), 'title' => $title[0], 'capturedAt' => gmdate( 'Y-m-d\TH:i:s\Z' ) ];
		}
		set_transient( 'overseek_delivery_options_' . md5( $account ), $observed, 86400 );
		return $rates;
	}
	/** Register discovery only; no calculator or configuration writes. */
	public function register_routes(): void {
		foreach ( [ 'capabilities' => 'get_capabilities', 'shipping-methods' => 'get_shipping_methods' ] as $path => $callback ) {
			register_rest_route( 'overseek/v1', '/delivery-estimates/' . $path, [
				'methods'             => 'GET',
				'callback'            => [ $this, $callback ],
				'permission_callback' => [ $this, 'check_permission' ],
			] );
		}
	}

	/**
	 * Reuse existing REST user capabilities, then bind to the linked account.
	 * All supplied aliases must match; a valid header cannot mask a bad query.
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return bool|WP_Error
	 */
	public function check_permission( WP_REST_Request $request ) {
		if ( ! ( new OverSeek_API() )->check_admin_permission( $request ) ) {
			return new WP_Error( 'overseek_delivery_forbidden', 'WooCommerce management permission is required.', [ 'status' => rest_authorization_required_code() ] );
		}

		$query = $request->get_query_params();
		$contexts = [];
		foreach ( [ 'x-overseek-account-id', 'accountId' ] as $header ) {
			$value = $request->get_header( $header );
			if ( null !== $value ) {
				$contexts[] = $value;
			}
		}
		foreach ( [ 'accountId', 'account_id' ] as $key ) {
			if ( array_key_exists( $key, $query ) ) {
				$contexts[] = $query[ $key ];
			}
		}
		if ( [] === $contexts ) {
			return new WP_Error( 'overseek_delivery_account_required', 'Send X-Overseek-Account-Id or the accountId query parameter.', [ 'status' => 400 ] );
		}
		foreach ( $contexts as $context ) {
			if ( ! is_string( $context ) || 1 !== preg_match( '/\A[A-Za-z0-9_-]{1,191}\z/', $context ) ) {
				return new WP_Error( 'overseek_delivery_account_invalid', 'Account context must be a non-empty account ID (letters, digits, underscores or hyphens; maximum 191 characters).', [ 'status' => 400 ] );
			}
		}
		$linked = get_option( 'overseek_account_id', '' );
		if ( ! is_string( $linked ) || '' === $linked ) {
			return new WP_Error( 'overseek_delivery_account_unlinked', 'No OverSeek account is linked to this store.', [ 'status' => 403 ] );
		}
		foreach ( $contexts as $context ) {
			if ( ! hash_equals( $linked, $context ) ) {
				return new WP_Error( 'overseek_delivery_account_mismatch', 'Account ID does not match linked account.', [ 'status' => 403 ] );
			}
		}
		return true;
	}

	/** @return WP_REST_Response Plugin capabilities, not feature activation state. */
	public function get_capabilities(): WP_REST_Response {
		return new WP_REST_Response( [
			'schemaVersion' => 1,
			'capabilities'  => [
				'variantSupplierLeads' => true,
				'shippingMethods'   => true,
				'calculationEngine' => true,
				'configurationSync' => true,
				'inboundInputs'     => true,
				'guardedReceipts'   => true,
				'receiptFinalization' => true,
				'inboundReceiptSafety' => true,
				'storefront'        => true,
			],
			'pluginVersion' => OVERSEEK_WC_VERSION,
		], 200 );
	}

	/**
	 * Enumerate configured method instances without evaluating any shipping rates.
	 * Only explicitly allowlisted metadata leaves the plugin.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_shipping_methods() {
		if ( ! class_exists( 'WC_Shipping_Zones' ) || ! class_exists( 'WC_Shipping_Zone' ) ) {
			return new WP_Error( 'overseek_delivery_woocommerce_unavailable', 'WooCommerce shipping discovery is unavailable.', [ 'status' => 503 ] );
		}
		try {
			$zone_ids = [ 0 ];
			foreach ( WC_Shipping_Zones::get_zones() as $zone ) {
				if ( count( $zone_ids ) >= 500 ) { throw new RuntimeException( 'Discovery bound exceeded' ); }
				$zone_ids[] = (int) $zone['zone_id'];
			}
			$methods = [];
			$warnings = [];
			$observed = get_transient( 'overseek_delivery_options_' . md5( (string) get_option( 'overseek_account_id', '' ) ) );
			$observed = is_array( $observed ) && count( $observed ) <= 100 ? $observed : [];
			foreach ( array_unique( $zone_ids ) as $zone_id ) {
				$zone = new WC_Shipping_Zone( $zone_id );
				$zone_methods = $zone->get_shipping_methods( false );
				if ( 0 === $zone_id ) {
					foreach ( [ 'Wbs\\ShippingMethod', 'Aikinomi\\Wbsng\\ShippingMethod' ] as $class ) {
						if ( class_exists( $class ) ) { $zone_methods[] = new $class( 0 ); }
					}
				}
				foreach ( $zone_methods as $method ) {
					if ( count( $methods ) >= 500 ) { throw new RuntimeException( 'Discovery bound exceeded' ); }
					$provider = $this->classify_provider( $method );
					$instance = (int) $method->get_instance_id();
					if ( -1 === $instance && in_array( $method->id, [ 'wbs', 'wbsng' ], true ) && 0 === (int) $method->instance_id ) { $instance = 0; }
					$verification = 'woocommerce' !== $provider;
					$methods[] = [
						'methodId'                 => (string) $method->id,
						'instanceId'               => $instance,
						'zoneId'                   => (int) $zone->get_id(),
						'zoneName'                 => (string) $zone->get_zone_name(),
						'title'                    => (string) $method->get_title(),
						'enabled'                  => 'yes' === $method->enabled,
						'provider'                 => $provider,
						'rateIdentityScope'        => 'method_instance',
						'requiresRateVerification' => $verification,
						'observedRates'            => array_values( array_map( static fn( $rate ) => [ 'rateId' => $rate['rateId'], 'title' => $rate['title'], 'capturedAt' => $rate['capturedAt'] ], array_filter( $observed, static fn( $rate ) => $rate['methodId'] === $method->id && $rate['instanceId'] === $instance ) ) ),
					];
					if ( $verification ) {
						$warnings[] = 'Method ' . $method->id . ':' . $instance . ' requires an exact observed option mapping or an explicitly confirmed instance-wide policy.';
					}
				}
			}
			$response = new WP_REST_Response( [
				'schemaVersion' => 1,
				'timezone'      => wp_timezone_string(),
				'methods'       => $methods,
				'warnings'      => $warnings,
			], 200 );
			$response->header( 'Cache-Control', 'private, no-store' );
			return $response;
		} catch ( Throwable $error ) {
			// Vendor exceptions may contain configuration or credentials. Never expose them.
			return new WP_Error( 'overseek_delivery_discovery_failed', 'Shipping discovery failed.', [ 'status' => 503 ] );
		}
	}

	/**
	 * Best-effort classification only, not a claim of vendor rule support.
	 *
	 * @param object $method WooCommerce shipping method.
	 * @return string
	 */
	private function classify_provider( object $method ): string {
		$identity = strtolower( (string) $method->id . ' ' . get_class( $method ) );
		if ( in_array( $method->id, [ 'wbs', 'wbsng' ], true ) || preg_match( '/weight|\bwbs\b|(?:^|[_\\\\])wbs(?:[_\\\\]|$)/', $identity ) ) {
			return 'weight_based';
		}
		$core = [ 'flat_rate' => 'WC_Shipping_Flat_Rate', 'free_shipping' => 'WC_Shipping_Free_Shipping', 'local_pickup' => 'WC_Shipping_Local_Pickup' ];
		if ( isset( $core[ $method->id ] ) && 0 === strcasecmp( get_class( $method ), $core[ $method->id ] ) ) {
			return 'woocommerce';
		}
		return 'unknown';
	}
}

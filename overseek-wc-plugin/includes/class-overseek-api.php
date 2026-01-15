<?php
/**
 * REST API Handler
 *
 * @package OverSeek
 * @since   1.0.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class OverSeek_API
 *
 * Handles REST API endpoints for remote configuration.
 *
 * @since 1.0.0
 */
class OverSeek_API {

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route( 'overseek/v1', '/settings', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'update_settings_callback' ],
			'permission_callback' => [ $this, 'check_admin_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/health', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'health_check_callback' ],
			'permission_callback' => '__return_true',
		] );
	}

	/**
	 * Check if current user has admin permissions.
	 *
	 * @return bool
	 */
	public function check_admin_permission(): bool {
		return current_user_can( 'manage_woocommerce' ) || current_user_can( 'manage_options' );
	}

	/**
	 * Callback for updating settings via REST API.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function update_settings_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $request->get_json_params();

		if ( isset( $params['account_id'] ) ) {
			update_option( 'overseek_account_id', sanitize_text_field( $params['account_id'] ) );
		}

		if ( isset( $params['api_url'] ) ) {
			update_option( 'overseek_api_url', esc_url_raw( $params['api_url'] ) );
		}

		// Only enable tracking/chat if explicitly requested (security: prevent auto-enable on hijacked sessions).
		if ( isset( $params['enable_tracking'] ) ) {
			update_option( 'overseek_enable_tracking', $params['enable_tracking'] ? '1' : '' );
		}
		if ( isset( $params['enable_chat'] ) ) {
			update_option( 'overseek_enable_chat', $params['enable_chat'] ? '1' : '' );
		}

		return new WP_REST_Response( [ 'success' => true, 'message' => 'Settings updated successfully' ], 200 );
	}

	/**
	 * Health check endpoint for dashboard verification.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function health_check_callback( WP_REST_Request $request ): WP_REST_Response {
		$account_id       = get_option( 'overseek_account_id' );
		$api_url          = get_option( 'overseek_api_url' );
		$tracking_enabled = get_option( 'overseek_enable_tracking' );
		$chat_enabled     = get_option( 'overseek_enable_chat' );

		$query_account_id = $request->get_param( 'account_id' );
		$account_match    = empty( $query_account_id ) || $query_account_id === $account_id;

		return new WP_REST_Response( [
			'success'            => true,
			'plugin'             => 'overseek-wc',
			'version'            => OVERSEEK_WC_VERSION,
			'configured'         => ! empty( $account_id ) && ! empty( $api_url ),
			'accountId'          => $account_id ?: null,
			'accountMatch'       => $account_match,
			'trackingEnabled'    => (bool) $tracking_enabled,
			'chatEnabled'        => (bool) $chat_enabled,
			'woocommerceActive'  => class_exists( 'WooCommerce' ),
			'woocommerceVersion' => defined( 'WC_VERSION' ) ? WC_VERSION : null,
			'phpVersion'         => PHP_VERSION,
			'siteUrl'            => home_url(),
			'timestamp'          => gmdate( 'c' ),
		], 200 );
	}
}


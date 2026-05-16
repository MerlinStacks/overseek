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
	 * Maximum attachment count accepted by the relay endpoint.
	 *
	 * @var int
	 */
	private const MAX_ATTACHMENTS = 10;

	/**
	 * Maximum decoded attachment size in bytes.
	 *
	 * @var int
	 */
	private const MAX_ATTACHMENT_BYTES = 10485760;

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
			'args'                => [
				'account_id'      => [
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				],
				'api_url'         => [
					'type'              => 'string',
					'sanitize_callback' => 'esc_url_raw',
				],
				'enable_tracking' => [
					'type' => 'boolean',
				],
				'enable_chat'     => [
					'type' => 'boolean',
				],
			],
		] );

		register_rest_route( 'overseek/v1', '/health', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'health_check_callback' ],
			'permission_callback' => '__return_true',
		] );

		register_rest_route( 'overseek/v1', '/email-relay', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'email_relay_callback' ],
			'permission_callback' => [ $this, 'check_relay_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/tracking-email-events', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'tracking_email_events_callback' ],
			'permission_callback' => [ $this, 'check_tracking_events_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/artwork-events', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'artwork_events_callback' ],
			'permission_callback' => [ $this, 'check_tracking_events_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/invoices/(?P<order_id>\d+)', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'invoice_details_callback' ],
			'permission_callback' => '__return_true',
		] );

		register_rest_route( 'overseek/v1', '/invoices/download', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'invoice_download_callback' ],
			'permission_callback' => '__return_true',
		] );
	}

	/**
	 * Return a canonical integration error body.
	 *
	 * @param string $code Error code.
	 * @param string $message Human-readable error message.
	 * @param int    $status HTTP status.
	 * @return WP_REST_Response
	 */
	private function integration_error( string $code, string $message, int $status ): WP_REST_Response {
		return new WP_REST_Response( [
			'success' => false,
			'error'   => [
				'code'    => $code,
				'message' => $message,
				'status'  => $status,
			],
		], $status );
	}

	/**
	 * Resolve invoice service instance.
	 *
	 * @return OverSeek_Order_Invoices|null
	 */
	private function get_invoice_service(): ?OverSeek_Order_Invoices {
		if ( ! class_exists( 'OverSeek_Order_Invoices' ) ) {
			return null;
		}

		$service = OverSeek_Order_Invoices::get_instance();
		return $service instanceof OverSeek_Order_Invoices ? $service : null;
	}

	/**
	 * Return invoice payload for a WooCommerce order.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function invoice_details_callback( WP_REST_Request $request ): WP_REST_Response {
		$order_id = absint( (int) $request->get_param( 'order_id' ) );
		if ( $order_id <= 0 ) {
			return $this->integration_error( 'invalid_order_id', 'Order ID must be a positive integer.', 400 );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return $this->integration_error( 'invoice_not_found', 'Invoice not found for this order.', 404 );
		}

		$service = $this->get_invoice_service();
		if ( ! $service ) {
			return $this->integration_error( 'invoice_service_unavailable', 'Invoice service unavailable.', 503 );
		}

		$authorization = $this->authorize_invoice_access( $order, $request, $service );
		if ( $authorization instanceof WP_REST_Response ) {
			return $authorization;
		}

		$user_id = get_current_user_id();

		$payload = $service->get_invoice_for_order( $order_id, $user_id );
		if ( ! is_array( $payload ) ) {
			return $this->integration_error( 'invoice_not_found', 'Invoice not found for this order.', 404 );
		}

		if ( isset( $payload['status'] ) && $payload['status'] === 'pending' ) {
			return $this->integration_error( 'invoice_pending', 'Invoice is not ready yet.', 409 );
		}

		if ( isset( $payload['status'] ) && $payload['status'] === 'failed' ) {
			$failure_message = isset( $payload['error_message'] ) && is_string( $payload['error_message'] ) && $payload['error_message'] !== ''
				? $payload['error_message']
				: 'Invoice generation failed.';
			return $this->integration_error( 'invoice_failed', $failure_message, 409 );
		}

		return new WP_REST_Response( [
			'success' => true,
			'data'    => $payload,
		], 200 );
	}

	/**
	 * Stream invoice PDF for authorized viewers.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function invoice_download_callback( WP_REST_Request $request ): WP_REST_Response {
		$order_id = absint( (int) $request->get_param( 'order_id' ) );
		if ( $order_id <= 0 ) {
			return $this->integration_error( 'invalid_order_id', 'Order ID must be a positive integer.', 400 );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return $this->integration_error( 'invoice_not_found', 'Invoice not found for this order.', 404 );
		}

		$service = $this->get_invoice_service();
		if ( ! $service ) {
			return $this->integration_error( 'invoice_service_unavailable', 'Invoice service unavailable.', 503 );
		}

		$authorization = $this->authorize_invoice_access( $order, $request, $service );
		if ( $authorization instanceof WP_REST_Response ) {
			return $authorization;
		}

		$status = (string) $order->get_meta( '_overseek_invoice_status' );
		$available = $service->invoice_is_available( $order_id );
		if ( $status === '' ) {
			$status = $available ? 'ready' : 'pending';
		}

		if ( method_exists( $service, 'try_generate_invoice_now' ) ) {
			$service->try_generate_invoice_now( $order_id, 30, false, true );
			$available = $service->invoice_is_available( $order_id );
			$status = (string) $order->get_meta( '_overseek_invoice_status' );
			if ( $status === '' ) {
				$status = $available ? 'ready' : 'pending';
			}
		}

		if ( $status === 'pending' ) {
			return $this->integration_error( 'invoice_pending', 'Invoice is not ready yet.', 409 );
		}

		if ( $status === 'failed' ) {
			$payload = $service->get_invoice_for_order( $order_id, get_current_user_id() );
			$failure_message = is_array( $payload ) && isset( $payload['error_message'] ) && is_string( $payload['error_message'] ) && $payload['error_message'] !== ''
				? $payload['error_message']
				: 'Invoice generation failed.';
			return $this->integration_error( 'invoice_failed', $failure_message, 409 );
		}

		if ( ! $available ) {
			return $this->integration_error( 'invoice_not_found', 'Invoice PDF not found for this order.', 404 );
		}

		$file_path = $service->get_invoice_file_path( $order_id );
		if ( $file_path === '' || ! file_exists( $file_path ) || ! is_readable( $file_path ) ) {
			return $this->integration_error( 'invoice_not_found', 'Invoice PDF not found for this order.', 404 );
		}

		nocache_headers();
		header( 'Content-Type: application/pdf' );
		header( 'Content-Disposition: inline; filename="' . basename( $file_path ) . '"' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'Expires: 0' );
		readfile( $file_path );
		exit;
	}

	/**
	 * Ensure current request can access the invoice for an order.
	 *
	 * Allows either an authorized logged-in user or a valid WooCommerce order key.
	 *
	 * @param WC_Order             $order The WooCommerce order.
	 * @param WP_REST_Request      $request The request object.
	 * @param OverSeek_Order_Invoices $service Invoice service.
	 * @return true|WP_REST_Response
	 */
	private function authorize_invoice_access( WC_Order $order, WP_REST_Request $request, OverSeek_Order_Invoices $service ) {
		$user_id = get_current_user_id();
		if ( $user_id > 0 && $service->user_can_access_invoice( $order, $user_id ) ) {
			return true;
		}

		$provided_order_key = (string) $request->get_param( 'key' );
		$expected_order_key = (string) $order->get_order_key();
		if ( $provided_order_key !== '' && $expected_order_key !== '' && hash_equals( $expected_order_key, $provided_order_key ) ) {
			return true;
		}

		if ( $user_id <= 0 ) {
			return $this->integration_error( 'invoice_unauthenticated', 'Authentication or valid order key required.', 401 );
		}

		return $this->integration_error( 'invoice_forbidden', 'You are not allowed to access this invoice.', 403 );
	}

	/**
	 * Check if request has valid relay API key and account ID.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return bool|WP_Error
	 */
	public function check_relay_permission( WP_REST_Request $request ) {
		$stored_key = (string) get_option( 'overseek_relay_api_key', '' );
		$webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );
		
		if ( empty( $stored_key ) && empty( $webhook_token ) ) {
			return new WP_Error( 'relay_not_configured', 'Email relay is not configured', [ 'status' => 503 ] );
		}

		$provided_key = (string) $request->get_header( 'X-Relay-Key' );
		$provided_bearer = $this->extract_bearer_token( $request );

		$key_valid = ! empty( $stored_key ) && ! empty( $provided_key ) && hash_equals( $stored_key, $provided_key );
		$bearer_valid = ! empty( $webhook_token ) && ! empty( $provided_bearer ) && hash_equals( $webhook_token, $provided_bearer );

		if ( ! $key_valid && ! $bearer_valid ) {
			return new WP_Error( 'invalid_relay_key', 'Invalid or missing relay API key', [ 'status' => 401 ] );
		}

		// Validate account ID matches the linked OverSeek account
		$stored_account_id = (string) get_option( 'overseek_account_id', '' );
		if ( ! empty( $stored_account_id ) ) {
			$params = $this->get_request_body( $request );
			$provided_account_id = isset( $params['account_id'] ) ? sanitize_text_field( $params['account_id'] ) : '';
			
			if ( empty( $provided_account_id ) || $provided_account_id !== $stored_account_id ) {
				return new WP_Error( 'account_mismatch', 'Account ID does not match linked account', [ 'status' => 403 ] );
			}
		}

		return true;
	}

	/**
	 * Check if request has valid token for tracking email events bridge.
	 *
	 * If no token is configured, requests are accepted.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return bool|WP_Error
	 */
	public function check_tracking_events_permission( WP_REST_Request $request ) {
		$webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );

		if ( '' === $webhook_token ) {
			return true;
		}

		$provided_bearer = $this->extract_bearer_token( $request );

		if ( '' === $provided_bearer || ! hash_equals( $webhook_token, $provided_bearer ) ) {
			return new WP_Error( 'invalid_webhook_token', 'Invalid or missing webhook bearer token', [ 'status' => 401 ] );
		}

		return true;
	}

	/**
	 * Email relay endpoint - receives email from OverSeek and sends via wp_mail.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function email_relay_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $this->get_request_body( $request );

		// Validate required fields.
		$to = isset( $params['to'] ) ? sanitize_email( $params['to'] ) : '';
		$subject = isset( $params['subject'] ) ? sanitize_text_field( $params['subject'] ) : '';
		$html = isset( $params['html'] ) ? wp_kses_post( $params['html'] ) : '';

		if ( empty( $to ) || ! is_email( $to ) ) {
			return new WP_REST_Response( [ 'success' => false, 'error' => 'Invalid or missing "to" address' ], 400 );
		}

		if ( empty( $subject ) ) {
			return new WP_REST_Response( [ 'success' => false, 'error' => 'Missing subject' ], 400 );
		}

		if ( empty( $html ) ) {
			return new WP_REST_Response( [ 'success' => false, 'error' => 'Missing email body' ], 400 );
		}

		// Build headers.
		$headers = [ 'Content-Type: text/html; charset=UTF-8' ];

		$from_name = isset( $params['from_name'] ) ? sanitize_text_field( $params['from_name'] ) : '';
		$from_email = isset( $params['from_email'] ) ? sanitize_email( $params['from_email'] ) : '';

		if ( ! empty( $from_name ) && ! empty( $from_email ) && is_email( $from_email ) ) {
			$headers[] = sprintf( 'From: %s <%s>', $from_name, $from_email );
		}

		if ( ! empty( $params['reply_to'] ) && is_email( $params['reply_to'] ) ) {
			$headers[] = 'Reply-To: ' . sanitize_email( $params['reply_to'] );
		}

		// Additional headers (In-Reply-To, References for threading).
		if ( ! empty( $params['in_reply_to'] ) ) {
			$headers[] = 'In-Reply-To: ' . sanitize_text_field( $params['in_reply_to'] );
		}

		if ( ! empty( $params['references'] ) ) {
			$headers[] = 'References: ' . sanitize_text_field( $params['references'] );
		}

		// Test mode - validate authentication without sending email.
		if ( ! empty( $params['test_mode'] ) && filter_var( $params['test_mode'], FILTER_VALIDATE_BOOLEAN ) ) {
			return new WP_REST_Response( [
				'success'    => true,
				'test_mode'  => true,
				'message'    => 'Authentication successful. Relay is properly configured.',
			], 200 );
		}

		// Handle base64-encoded attachments.
		$attachment_paths = [];
		if ( ! empty( $params['attachments'] ) && is_array( $params['attachments'] ) ) {
			$attachment_paths = $this->prepare_attachments( $params['attachments'] );
		}

		// Send via wp_mail (with attachments if any).
		$sent = wp_mail( $to, $subject, $html, $headers, $attachment_paths );

		// Cleanup temp attachment files.
		foreach ( $attachment_paths as $path ) {
			if ( is_string( $path ) && file_exists( $path ) ) {
				wp_delete_file( $path );
			}
		}

		if ( $sent ) {
			// Generate a pseudo message ID for tracking.
			$random_bytes = bin2hex( random_bytes( 8 ) );
			$host = wp_parse_url( home_url(), PHP_URL_HOST );
			$message_id = sprintf( '<%s.%s@%s>', $random_bytes, time(), $host ?: 'localhost' );
			
			return new WP_REST_Response( [
				'success'    => true,
				'message_id' => $message_id,
			], 200 );
		} else {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => 'wp_mail failed to send the email',
			], 500 );
		}
	}

	/**
	 * Tracking events bridge endpoint.
	 *
	 * Receives CK Order Workflow payload and forwards to OverSeek API.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function tracking_email_events_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $this->get_request_body( $request );

		$event = isset( $params['event'] ) && is_array( $params['event'] ) ? $params['event'] : null;
		if ( null === $event ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => 'Missing top-level event object',
			], 400 );
		}

		$account_id = (string) get_option( 'overseek_account_id', '' );
		$api_url = untrailingslashit( (string) get_option( 'overseek_api_url', '' ) );
		if ( '' === $account_id || '' === $api_url ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => 'OverSeek connection is not configured',
			], 503 );
		}

		$target_url = $api_url . '/api/tracking-email-events/' . rawurlencode( $account_id );
		$headers = [
			'Content-Type' => 'application/json',
			'User-Agent'   => 'OverSeek-WC-Plugin/' . OVERSEEK_WC_VERSION,
		];

		$webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );
		if ( '' !== $webhook_token ) {
			$headers['Authorization'] = 'Bearer ' . $webhook_token;
		}

		$response = wp_remote_post( $target_url, [
			'timeout' => 10,
			'headers' => $headers,
			'body'    => wp_json_encode( [ 'event' => $event ] ),
		] );

		if ( is_wp_error( $response ) ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => $response->get_error_message(),
			], 502 );
		}

		$status_code = (int) wp_remote_retrieve_response_code( $response );
		$decoded = OverSeek_HTTP_Utils::decode_json_response( $response );
		$ok = $status_code >= 200 && $status_code < 300;

		return new WP_REST_Response( [
			'success'            => $ok,
			'forwarded'          => $ok,
			'upstreamStatusCode' => $status_code,
			'upstream'           => $decoded,
		], $ok ? 202 : 502 );
	}

	/**
	 * Artwork workflow events bridge endpoint.
	 *
	 * Receives CK Order Workflow artwork payload and forwards to OverSeek API.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function artwork_events_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $this->get_request_body( $request );

		$event = isset( $params['event'] ) && is_array( $params['event'] ) ? $params['event'] : null;
		if ( null === $event ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => 'Missing top-level event object',
			], 400 );
		}

		$account_id = (string) get_option( 'overseek_account_id', '' );
		$api_url = untrailingslashit( (string) get_option( 'overseek_api_url', '' ) );
		if ( '' === $account_id || '' === $api_url ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => 'OverSeek connection is not configured',
			], 503 );
		}

		$target_url = $api_url . '/api/artwork-events/' . rawurlencode( $account_id );
		$headers = [
			'Content-Type' => 'application/json',
			'User-Agent'   => 'OverSeek-WC-Plugin/' . OVERSEEK_WC_VERSION,
		];

		$webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );
		if ( '' !== $webhook_token ) {
			$headers['Authorization'] = 'Bearer ' . $webhook_token;
		}

		$response = wp_remote_post( $target_url, [
			'timeout' => 10,
			'headers' => $headers,
			'body'    => wp_json_encode( [ 'event' => $event ] ),
		] );

		if ( is_wp_error( $response ) ) {
			return new WP_REST_Response( [
				'success' => false,
				'error'   => $response->get_error_message(),
			], 502 );
		}

		$status_code = (int) wp_remote_retrieve_response_code( $response );
		$decoded = OverSeek_HTTP_Utils::decode_json_response( $response );
		$ok = $status_code >= 200 && $status_code < 300;

		return new WP_REST_Response( [
			'success'            => $ok,
			'forwarded'          => $ok,
			'upstreamStatusCode' => $status_code,
			'upstream'           => $decoded,
		], $ok ? 202 : 502 );
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
		$params = $this->get_request_body( $request );

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
		$relay_endpoint   = home_url( '/wp-json/overseek/v1/email-relay' );
		$tracking_events_endpoint = home_url( '/wp-json/overseek/v1/tracking-email-events' );
		$artwork_events_endpoint  = home_url( '/wp-json/overseek/v1/artwork-events' );
		$has_relay_key    = ! empty( (string) get_option( 'overseek_relay_api_key', '' ) );
		$has_bearer_token = ! empty( (string) get_option( 'overseek_webhook_auth_token', '' ) );

		$query_account_id = $request->get_param( 'account_id' );
		$account_match    = empty( $query_account_id ) || $query_account_id === $account_id;

		// Only expose sensitive fields when caller proves they know the account ID.
		// Without the correct account_id param, the endpoint is an info-leak vector.
		return new WP_REST_Response( [
			'success'            => true,
			'plugin'             => 'overseek-wc',
			'version'            => OVERSEEK_WC_VERSION,
			'configured'         => ! empty( $account_id ) && ! empty( $api_url ),
			'accountId'          => $account_match ? $account_id : null,
			'accountMatch'       => $account_match,
			'trackingEnabled'    => (bool) $tracking_enabled,
			'chatEnabled'        => (bool) $chat_enabled,
			'woocommerceActive'  => class_exists( 'WooCommerce' ),
			'woocommerceVersion' => $account_match && defined( 'WC_VERSION' ) ? WC_VERSION : null,
			'phpVersion'         => $account_match ? PHP_VERSION : null,
			'siteUrl'            => $account_match ? home_url() : null,
			'emailPlatformWebhookUrl' => $account_match ? $relay_endpoint : null,
			'trackingEventsWebhookUrl' => $account_match ? $tracking_events_endpoint : null,
			'artworkEventsWebhookUrl'  => $account_match ? $artwork_events_endpoint : null,
			'webhookAuth'        => $account_match ? [
				'supportsXRelayKey' => true,
				'supportsBearer'    => true,
				'hasRelayApiKey'    => $has_relay_key,
				'hasBearerToken'    => $has_bearer_token,
			] : null,
			'timestamp'          => gmdate( 'c' ),
		], 200 );
	}

	/**
	 * Extract bearer token from Authorization header.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return string
	 */
	private function extract_bearer_token( WP_REST_Request $request ): string {
		$auth_header = (string) $request->get_header( 'Authorization' );
		if ( preg_match( '/^Bearer\s+(.+)$/i', trim( $auth_header ), $matches ) ) {
			return trim( (string) $matches[1] );
		}

		return '';
	}

	/**
	 * Normalize JSON body access for REST requests.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return array<string, mixed>
	 */
	private function get_request_body( WP_REST_Request $request ): array {
		$params = $request->get_json_params();

		return is_array( $params ) ? $params : [];
	}

	/**
	 * Decode base64 attachments into temporary files suitable for wp_mail().
	 *
	 * @param mixed $attachments Incoming attachment payload.
	 * @return array<int, string>
	 */
	private function prepare_attachments( $attachments ): array {
		if ( ! is_array( $attachments ) ) {
			return [];
		}

		$attachment_paths = [];

		foreach ( array_slice( $attachments, 0, self::MAX_ATTACHMENTS ) as $attachment ) {
			if ( ! is_array( $attachment ) || empty( $attachment['content'] ) || empty( $attachment['filename'] ) ) {
				continue;
			}

			$decoded = base64_decode( (string) $attachment['content'], true );
			if ( false === $decoded || strlen( $decoded ) > self::MAX_ATTACHMENT_BYTES ) {
				continue;
			}

			$safe_filename = sanitize_file_name( (string) $attachment['filename'] );
			if ( '' === $safe_filename ) {
				continue;
			}

			$content_type = '';
			if ( ! empty( $attachment['contentType'] ) && is_string( $attachment['contentType'] ) ) {
				$content_type = sanitize_text_field( $attachment['contentType'] );
			} elseif ( ! empty( $attachment['content_type'] ) && is_string( $attachment['content_type'] ) ) {
				$content_type = sanitize_text_field( $attachment['content_type'] );
			}

			$safe_filename = $this->ensure_attachment_extension( $safe_filename, $content_type );

			$temp_path = $this->create_temp_attachment_path( $safe_filename );
			if ( ! $temp_path ) {
				continue;
			}

			$bytes_written = file_put_contents( $temp_path, $decoded, LOCK_EX );
			if ( false === $bytes_written ) {
				wp_delete_file( $temp_path );
				continue;
			}

			$attachment_paths[] = $temp_path;
		}

		return $attachment_paths;
	}

	/**
	 * Create a temporary file path while preserving the source extension.
	 *
	 * @param string $safe_filename Sanitized attachment filename.
	 * @return string|false
	 */
	private function create_temp_attachment_path( string $safe_filename ) {
		$temp_dir = trailingslashit( get_temp_dir() );
		$extension = pathinfo( $safe_filename, PATHINFO_EXTENSION );
		$basename = pathinfo( $safe_filename, PATHINFO_FILENAME );
		$basename = '' !== $basename ? $basename : 'attachment';

		for ( $attempt = 0; $attempt < 5; $attempt++ ) {
			$suffix = wp_generate_password( 12, false, false );
			$candidate_name = '' !== $extension
				? sprintf( '%s-%s.%s', $basename, $suffix, $extension )
				: sprintf( '%s-%s', $basename, $suffix );
			$candidate_path = $temp_dir . $candidate_name;

			if ( ! file_exists( $candidate_path ) ) {
				return $candidate_path;
			}
		}

		return false;
	}

	/**
	 * Ensure attachment filename has an extension using MIME type fallback.
	 *
	 * @param string $safe_filename Sanitized attachment filename.
	 * @param string $content_type Attachment MIME type.
	 * @return string
	 */
	private function ensure_attachment_extension( string $safe_filename, string $content_type ): string {
		if ( '' !== pathinfo( $safe_filename, PATHINFO_EXTENSION ) ) {
			return $safe_filename;
		}

		$mime_map = [
			'application/pdf' => 'pdf',
			'image/jpeg'      => 'jpg',
			'image/png'       => 'png',
			'image/gif'       => 'gif',
			'text/plain'      => 'txt',
			'text/csv'        => 'csv',
			'application/zip' => 'zip',
			'application/msword' => 'doc',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
			'application/vnd.ms-excel' => 'xls',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
		];

		$normalized_type = strtolower( trim( $content_type ) );
		$extension = isset( $mime_map[ $normalized_type ] ) ? $mime_map[ $normalized_type ] : '';

		if ( '' === $extension ) {
			return $safe_filename;
		}

		return $safe_filename . '.' . $extension;
	}
}

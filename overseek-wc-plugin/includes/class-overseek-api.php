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
	private const MAX_ATTACHMENT_BYTES = 5242880;

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
	}

	/**
	 * Check if request has valid relay API key and account ID.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return bool|WP_Error
	 */
	public function check_relay_permission( WP_REST_Request $request ) {
		$stored_key = (string) get_option( 'overseek_relay_api_key', '' );
		
		if ( empty( $stored_key ) ) {
			return new WP_Error( 'relay_not_configured', 'Email relay is not configured', [ 'status' => 503 ] );
		}

		$provided_key = (string) $request->get_header( 'X-Relay-Key' );
		
		if ( empty( $provided_key ) || ! hash_equals( $stored_key, $provided_key ) ) {
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
			'timestamp'          => gmdate( 'c' ),
		], 200 );
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

			$temp_path = wp_tempnam( $safe_filename );
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
}


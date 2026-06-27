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
	 * Maximum review text length accepted from remote review creation.
	 *
	 * @var int
	 */
	private const MAX_REVIEW_TEXT_LENGTH = 3000;

	/**
	 * Maximum review media attachments accepted from remote review creation.
	 *
	 * @var int
	 */
	private const MAX_REVIEW_ATTACHMENTS = 6;
	private const MAX_STOREFRONT_CONFIG_DEPTH = 6;
	private const MAX_STOREFRONT_CONFIG_KEYS = 200;
	private const MAX_STOREFRONT_CONFIG_STRING_LENGTH = 2000;
	private const MAX_BOT_PATTERNS = 1000;
	private const MAX_BOT_PATTERN_LENGTH = 200;
	private const MAX_BOT_BLOCK_HTML_LENGTH = 100000;

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
				'enable_bot_shield' => [
					'type' => 'boolean',
				],
			],
		] );

		register_rest_route( 'overseek/v1', '/storefront-config', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'update_storefront_config_callback' ],
			'permission_callback' => [ $this, 'check_admin_permission' ],
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

		register_rest_route( 'overseek/v1', '/reviews', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'create_review_callback' ],
			'permission_callback' => [ $this, 'check_admin_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/reviews/(?P<id>\d+)', [
			'methods'             => [ 'PATCH', 'PUT' ],
			'callback'            => [ $this, 'update_review_callback' ],
			'permission_callback' => [ $this, 'check_admin_permission' ],
		] );

		register_rest_route( 'overseek/v1', '/reviews/(?P<id>\d+)/reply', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'reply_to_review_callback' ],
			'permission_callback' => [ $this, 'check_admin_permission' ],
		] );
	}

	/**
	 * Add Overseek media/reply fields to standard WooCommerce review REST responses.
	 *
	 * @param WP_REST_Response $response REST response.
	 * @param mixed            $review   Review object.
	 * @param WP_REST_Request  $request  REST request.
	 * @return WP_REST_Response
	 */
	public function append_review_rest_fields( $response, $review, $request ) {
		if ( ! $response instanceof WP_REST_Response ) {
			return $response;
		}

		$data = $response->get_data();
		$comment_id = isset( $data['id'] ) ? absint( $data['id'] ) : 0;

		if ( ! $comment_id && is_object( $review ) && isset( $review->comment_ID ) ) {
			$comment_id = absint( $review->comment_ID );
		}

		if ( ! $comment_id ) {
			return $response;
		}

		$data['media'] = $this->build_review_media_response( $comment_id );
		$data['replies'] = $this->build_review_replies_response( $comment_id );
		$data['overseekSource'] = $this->build_review_source_response( $comment_id );
		$response->set_data( $data );

		return $response;
	}

	/**
	 * Create a native WooCommerce review from OverSeek.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function create_review_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $this->get_request_body( $request );
		$product_id = isset( $params['product_id'] ) ? absint( (int) $params['product_id'] ) : 0;
		$product = $product_id ? wc_get_product( $product_id ) : null;
		if ( ! $product ) {
			return $this->integration_error( 'invalid_product_id', 'Product not found.', 404 );
		}

		if ( 'product_variation' === get_post_type( $product_id ) && method_exists( $product, 'get_parent_id' ) ) {
			$product_id = absint( (int) $product->get_parent_id() );
			$product = $product_id ? wc_get_product( $product_id ) : null;
		}

		if ( ! $product || 'product' !== get_post_type( $product_id ) ) {
			return $this->integration_error( 'invalid_product_id', 'Product reviews must be attached to a product.', 400 );
		}

		$review = isset( $params['review'] ) ? trim( wp_kses_post( (string) $params['review'] ) ) : '';
		$review = function_exists( 'mb_substr' ) ? mb_substr( $review, 0, self::MAX_REVIEW_TEXT_LENGTH ) : substr( $review, 0, self::MAX_REVIEW_TEXT_LENGTH );
		$reviewer = isset( $params['reviewer'] ) ? sanitize_text_field( (string) $params['reviewer'] ) : '';
		$email = isset( $params['reviewer_email'] ) ? sanitize_email( (string) $params['reviewer_email'] ) : '';
		$rating = isset( $params['rating'] ) ? absint( (int) $params['rating'] ) : 5;
		$source_email_message_id = isset( $params['source_email_message_id'] ) ? sanitize_text_field( (string) $params['source_email_message_id'] ) : '';
		$source_email_log_id = isset( $params['source_email_log_id'] ) ? sanitize_text_field( (string) $params['source_email_log_id'] ) : '';
		$source_order_id = isset( $params['source_order_id'] ) ? sanitize_text_field( (string) $params['source_order_id'] ) : '';

		if ( '' === $review || '' === $reviewer || ! is_email( $email ) || $rating < 1 || $rating > 5 ) {
			return $this->integration_error( 'invalid_review_payload', 'Review, reviewer, email, and rating are required.', 400 );
		}

		$comment_id = wp_new_comment(
			[
				'comment_post_ID'      => $product_id,
				'comment_author'       => $reviewer,
				'comment_author_email' => $email,
				'comment_content'      => $review,
				'comment_type'         => 'review',
				'comment_approved'     => 0,
				'comment_meta'         => [
					'rating'          => $rating,
					'overseek_source' => 'email_reply',
				],
			]
		);

		if ( ! $comment_id || is_wp_error( $comment_id ) ) {
			$message = is_wp_error( $comment_id ) ? $comment_id->get_error_message() : 'Failed to create review.';
			return $this->integration_error( 'review_create_failed', $message, 500 );
		}

		$media_ids = [];
		if ( ! empty( $params['attachments'] ) && is_array( $params['attachments'] ) ) {
			$media_ids = $this->sideload_review_attachments( $params['attachments'], $product_id );
		}

		if ( ! empty( $media_ids ) ) {
			update_comment_meta( (int) $comment_id, 'overseek_media_ids', $media_ids );
		}

		if ( '' !== $source_email_message_id ) {
			update_comment_meta( (int) $comment_id, 'overseek_source_email_message_id', $source_email_message_id );
		}

		if ( '' !== $source_email_log_id ) {
			update_comment_meta( (int) $comment_id, 'overseek_source_email_log_id', $source_email_log_id );
		}

		if ( '' !== $source_order_id ) {
			update_comment_meta( (int) $comment_id, 'overseek_source_order_id', $source_order_id );
		}

		return new WP_REST_Response( [
			'success' => true,
			'review'  => $this->build_review_response( (int) $comment_id ),
		], 201 );
	}

	/**
	 * Update a native WooCommerce review.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function update_review_callback( WP_REST_Request $request ): WP_REST_Response {
		$comment_id = absint( (int) $request->get_param( 'id' ) );
		$comment    = get_comment( $comment_id );
		if ( ! $comment || ! $this->is_product_review_comment( $comment ) ) {
			return $this->integration_error( 'review_not_found', 'Review not found.', 404 );
		}

		$params = $this->get_request_body( $request );
		$update = [ 'comment_ID' => $comment_id ];
		$status = '';

		if ( isset( $params['status'] ) ) {
			$status = $this->map_review_status( sanitize_key( (string) $params['status'] ) );
			if ( '' === $status ) {
				return $this->integration_error( 'invalid_review_status', 'Invalid review status.', 400 );
			}
		}

		if ( isset( $params['content'] ) ) {
			$content = trim( wp_kses_post( (string) $params['content'] ) );
			if ( '' === $content ) {
				return $this->integration_error( 'invalid_review_content', 'Review content cannot be empty.', 400 );
			}
			$update['comment_content'] = $content;
		}

		if ( isset( $params['rating'] ) ) {
			$rating = absint( (int) $params['rating'] );
			if ( $rating < 1 || $rating > 5 ) {
				return $this->integration_error( 'invalid_review_rating', 'Review rating must be between 1 and 5.', 400 );
			}
		}

		if ( count( $update ) > 1 ) {
			$result = wp_update_comment( $update, true );
			if ( is_wp_error( $result ) ) {
				return $this->integration_error( 'review_update_failed', $result->get_error_message(), 500 );
			}
		}

		if ( isset( $params['rating'] ) ) {
			update_comment_meta( $comment_id, 'rating', $rating );
		}

		if ( '' !== $status && ! wp_set_comment_status( $comment_id, $status ) ) {
			return $this->integration_error( 'review_update_failed', 'Failed to update review status.', 500 );
		}

		return new WP_REST_Response( [
			'success' => true,
			'review'  => $this->build_review_response( $comment_id ),
		], 200 );
	}

	/**
	 * Add a merchant reply to a product review.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function reply_to_review_callback( WP_REST_Request $request ): WP_REST_Response {
		$comment_id = absint( (int) $request->get_param( 'id' ) );
		$comment    = get_comment( $comment_id );
		if ( ! $comment || ! $this->is_product_review_comment( $comment ) ) {
			return $this->integration_error( 'review_not_found', 'Review not found.', 404 );
		}

		$params = $this->get_request_body( $request );
		$reply  = isset( $params['reply'] ) ? trim( wp_kses_post( (string) $params['reply'] ) ) : '';
		if ( '' === $reply ) {
			return $this->integration_error( 'invalid_review_reply', 'Reply cannot be empty.', 400 );
		}

		$user = wp_get_current_user();
		$name = array_key_exists( 'author', $params ) ? sanitize_text_field( (string) $params['author'] ) : ( $user && $user->exists() ? $user->display_name : get_bloginfo( 'name' ) );
		$email = $user && $user->exists() ? $user->user_email : get_option( 'admin_email' );

		$reply_id = wp_new_comment(
			[
				'comment_post_ID'      => (int) $comment->comment_post_ID,
				'comment_parent'       => $comment_id,
				'comment_author'       => $name,
				'comment_author_email' => $email,
				'comment_content'      => $reply,
				'comment_type'         => 'comment',
				'comment_approved'     => 1,
			]
		);

		if ( ! $reply_id || is_wp_error( $reply_id ) ) {
			$message = is_wp_error( $reply_id ) ? $reply_id->get_error_message() : 'Failed to create review reply.';
			return $this->integration_error( 'review_reply_failed', $message, 500 );
		}

		update_comment_meta( (int) $reply_id, 'overseek_review_reply', '1' );

		return new WP_REST_Response( [
			'success' => true,
			'replyId' => (int) $reply_id,
			'review'  => $this->build_review_response( $comment_id ),
		], 201 );
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

		$payload = method_exists( $service, 'get_invoice_for_authorized_order' )
			? $service->get_invoice_for_authorized_order( $order_id )
			: $service->get_invoice_for_order( $order_id, get_current_user_id() );
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

		if ( ! $available && in_array( $status, [ 'pending', 'ready' ], true ) && method_exists( $service, 'try_generate_invoice_now' ) ) {
			$service->try_generate_invoice_now( $order_id, 12, false, false );
			$available = $service->invoice_is_available( $order_id );
			$status = (string) $order->get_meta( '_overseek_invoice_status' );
			if ( $status === '' ) {
				$status = $available ? 'ready' : 'pending';
			}
		}

		if ( method_exists( $service, 'try_generate_invoice_now' ) ) {
			$force_regenerate = (string) $request->get_param( 'force_regenerate' ) === '1'
				&& get_current_user_id() > 0
				&& current_user_can( 'manage_woocommerce' );

			if ( $force_regenerate ) {
				$service->try_generate_invoice_now( $order_id, 30, true, true );
				$available = $service->invoice_is_available( $order_id );
				$status = (string) $order->get_meta( '_overseek_invoice_status' );
				if ( $status === '' ) {
					$status = $available ? 'ready' : 'pending';
				}
			}
		}

		if ( $status === 'pending' ) {
			return $this->integration_error( 'invoice_pending', 'Invoice is not ready yet.', 409 );
		}

		if ( $status === 'failed' ) {
			$payload = method_exists( $service, 'get_invoice_for_authorized_order' )
				? $service->get_invoice_for_authorized_order( $order_id )
				: $service->get_invoice_for_order( $order_id, get_current_user_id() );
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

		$provided_invoice_token = (string) $request->get_param( 'invoice_token' );
		$expected_invoice_token = $this->get_invoice_access_token( $order );
		if ( $provided_invoice_token !== '' && hash_equals( $expected_invoice_token, $provided_invoice_token ) ) {
			return true;
		}

		$provided_order_key = (string) $request->get_param( 'order_key' );
		if ( $provided_order_key !== '' && hash_equals( $order->get_order_key(), $provided_order_key ) ) {
			return true;
		}

		if ( $user_id <= 0 ) {
			return $this->integration_error( 'invoice_unauthenticated', 'Authentication or valid order key required.', 401 );
		}

		return $this->integration_error( 'invoice_forbidden', 'You are not allowed to access this invoice.', 403 );
	}

	/**
	 * Build a non-enumerable invoice access token for anonymous invoice links.
	 *
	 * @param WC_Order $order The WooCommerce order.
	 * @return string
	 */
	private function get_invoice_access_token( WC_Order $order ): string {
		return wp_hash( $order->get_id() . '|' . $order->get_order_key() . '|overseek_invoice_access' );
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
	 * A configured token is required so this store cannot be used as an open relay.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return bool|WP_Error
	 */
	public function check_tracking_events_permission( WP_REST_Request $request ) {
		$webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );

		if ( '' === $webhook_token ) {
			return new WP_Error( 'webhook_token_not_configured', 'Webhook auth token is required for event forwarding.', [ 'status' => 503 ] );
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
		$html = ( isset( $params['html'] ) && is_string( $params['html'] ) ) ? $params['html'] : '';

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

		try {
			// Send via wp_mail (with attachments if any).
			$sent = wp_mail( $to, $subject, $html, $headers, $attachment_paths );
		} finally {
			// Cleanup temp attachment files.
			foreach ( $attachment_paths as $path ) {
				if ( is_string( $path ) && file_exists( $path ) ) {
					wp_delete_file( $path );
				}
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
		return $this->forward_event_to_overseek( $request, '/api/tracking-email-events/' );
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
		return $this->forward_event_to_overseek( $request, '/api/artwork-events/' );
	}

	/**
	 * Forward an event payload to an OverSeek upstream endpoint.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @param string          $endpoint_prefix API endpoint prefix ending with slash.
	 * @return WP_REST_Response
	 */
	private function forward_event_to_overseek( WP_REST_Request $request, string $endpoint_prefix ): WP_REST_Response {
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

		$target_url = $api_url . $endpoint_prefix . rawurlencode( $account_id );
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
	public function check_admin_permission( ?WP_REST_Request $request = null ): bool {
		if ( current_user_can( 'manage_woocommerce' ) || current_user_can( 'manage_options' ) ) {
			return true;
		}

		if ( $request instanceof WP_REST_Request ) {
			$user_id = $this->authenticate_wc_rest_key( $request );
			if ( $user_id > 0 ) {
				wp_set_current_user( $user_id );
				return current_user_can( 'manage_woocommerce' ) || current_user_can( 'manage_options' );
			}
		}

		return false;
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
		if ( isset( $params['enable_bot_shield'] ) ) {
			update_option( 'overseek_enable_bot_shield', $params['enable_bot_shield'] ? '1' : '' );
		}

		return new WP_REST_Response( [ 'success' => true, 'message' => 'Settings updated successfully' ], 200 );
	}

	/**
	 * Store storefront-safe config locally so page render does not depend on OverSeek.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public function update_storefront_config_callback( WP_REST_Request $request ): WP_REST_Response {
		$params = $this->get_request_body( $request );

		$stored_account_id = (string) get_option( 'overseek_account_id', '' );
		$provided_account_id = isset( $params['account_id'] ) ? sanitize_text_field( (string) $params['account_id'] ) : '';
		if ( '' !== $stored_account_id && '' !== $provided_account_id && ! hash_equals( $stored_account_id, $provided_account_id ) ) {
			return new WP_REST_Response( [ 'success' => false, 'error' => 'Account ID does not match linked account.' ], 403 );
		}

		$updated = [];
		if ( isset( $params['chat'] ) && is_array( $params['chat'] ) ) {
			update_option( 'overseek_storefront_chat_config', $this->sanitize_storefront_config_array( $params['chat'] ), false );
			delete_transient( 'overseek_chat_config_' . md5( $stored_account_id ) );
			delete_transient( 'overseek_chat_config_stale_' . md5( $stored_account_id ) );
			$updated[] = 'chat';
		}

		if ( isset( $params['pixels'] ) && is_array( $params['pixels'] ) ) {
			update_option( 'overseek_storefront_pixel_config', $this->sanitize_storefront_config_array( $params['pixels'] ), false );
			$updated[] = 'pixels';
		}

		if ( isset( $params['botShield'] ) && is_array( $params['botShield'] ) ) {
			update_option( 'overseek_storefront_bot_shield_config', $this->sanitize_bot_shield_config( $params['botShield'] ), false );
			$updated[] = 'botShield';
		}

		update_option( 'overseek_storefront_config_updated_at', gmdate( 'c' ), false );

		return new WP_REST_Response( [ 'success' => true, 'updated' => $updated ], 200 );
	}

	/**
	 * @param array<string, mixed> $config Raw storefront config.
	 * @return array<string, mixed>
	 */
	private function sanitize_storefront_config_array( array $config, int $depth = 0 ): array {
		if ( $depth >= self::MAX_STOREFRONT_CONFIG_DEPTH ) {
			return [];
		}

		$clean = [];
		$count = 0;
		foreach ( $config as $key => $value ) {
			$count++;
			if ( $count > self::MAX_STOREFRONT_CONFIG_KEYS ) {
				break;
			}

			$clean_key = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $key );
			if ( '' === $clean_key ) {
				continue;
			}

			if ( is_array( $value ) ) {
				$clean[ $clean_key ] = $this->sanitize_storefront_config_array( $value, $depth + 1 );
			} elseif ( is_bool( $value ) || is_int( $value ) || is_float( $value ) ) {
				$clean[ $clean_key ] = $value;
			} elseif ( null === $value ) {
				$clean[ $clean_key ] = null;
			} else {
				$clean[ $clean_key ] = sanitize_text_field( substr( (string) $value, 0, self::MAX_STOREFRONT_CONFIG_STRING_LENGTH ) );
			}
		}

		return $clean;
	}

	/**
	 * @param array<string, mixed> $config Raw bot shield config.
	 * @return array<string, mixed>
	 */
	private function sanitize_bot_shield_config( array $config ): array {
		$patterns = [];
		if ( isset( $config['patterns'] ) && is_array( $config['patterns'] ) ) {
			foreach ( $config['patterns'] as $pattern ) {
				if ( count( $patterns ) >= self::MAX_BOT_PATTERNS ) {
					break;
				}

				$pattern = strtolower( trim( sanitize_text_field( substr( (string) $pattern, 0, self::MAX_BOT_PATTERN_LENGTH ) ) ) );
				if ( '' !== $pattern ) {
					$patterns[ $pattern ] = true;
				}
			}
		}

		return [
			'patterns'      => array_keys( $patterns ),
			'blockPageHtml' => isset( $config['blockPageHtml'] ) ? substr( (string) $config['blockPageHtml'], 0, self::MAX_BOT_BLOCK_HTML_LENGTH ) : '',
			'fetchedAt'     => time(),
		];
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
		$bot_shield_enabled = get_option( 'overseek_enable_bot_shield' );
		$relay_endpoint   = home_url( '/wp-json/overseek/v1/email-relay' );
		$tracking_events_endpoint = home_url( '/wp-json/overseek/v1/tracking-email-events' );
		$artwork_events_endpoint  = home_url( '/wp-json/overseek/v1/artwork-events' );
		$has_relay_key    = ! empty( (string) get_option( 'overseek_relay_api_key', '' ) );
		$has_bearer_token = ! empty( (string) get_option( 'overseek_webhook_auth_token', '' ) );

		$query_account_id = (string) $request->get_param( 'account_id' );
		$account_match    = $query_account_id !== '' && is_string( $account_id ) && hash_equals( (string) $account_id, $query_account_id );
		$bearer_token     = $this->extract_bearer_token( $request );
		$stored_relay_key = (string) get_option( 'overseek_relay_api_key', '' );
		$stored_webhook_token = (string) get_option( 'overseek_webhook_auth_token', '' );
		$token_authorized = ( $stored_relay_key !== '' && $bearer_token !== '' && hash_equals( $stored_relay_key, $bearer_token ) )
			|| ( $stored_webhook_token !== '' && $bearer_token !== '' && hash_equals( $stored_webhook_token, $bearer_token ) );
		$show_sensitive   = $this->check_admin_permission() || ( $account_match && $token_authorized );

		// Only expose environment/configuration details to wp-admin users or authenticated OverSeek services.
		return new WP_REST_Response( [
			'success'            => true,
			'plugin'             => 'overseek-wc',
			'version'            => $show_sensitive ? OVERSEEK_WC_VERSION : null,
			'configured'         => $show_sensitive ? ! empty( $account_id ) && ! empty( $api_url ) : null,
			'accountId'          => $show_sensitive ? $account_id : null,
			'accountMatch'       => $show_sensitive ? $account_match : null,
			'trackingEnabled'    => $show_sensitive ? (bool) $tracking_enabled : null,
			'chatEnabled'        => $show_sensitive ? (bool) $chat_enabled : null,
			'botShieldEnabled'   => $show_sensitive ? (bool) $bot_shield_enabled : null,
			'woocommerceActive'  => $show_sensitive ? class_exists( 'WooCommerce' ) : null,
			'woocommerceVersion' => $show_sensitive && defined( 'WC_VERSION' ) ? WC_VERSION : null,
			'phpVersion'         => $show_sensitive ? PHP_VERSION : null,
			'siteUrl'            => $show_sensitive ? home_url() : null,
			'emailPlatformWebhookUrl' => $show_sensitive ? $relay_endpoint : null,
			'trackingEventsWebhookUrl' => $show_sensitive ? $tracking_events_endpoint : null,
			'artworkEventsWebhookUrl'  => $show_sensitive ? $artwork_events_endpoint : null,
			'webhookAuth'        => $show_sensitive ? [
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
	 * Authenticate WooCommerce REST API query credentials for custom Overseek routes.
	 *
	 * WooCommerce may not set the current user for custom REST namespaces, so we
	 * validate the same consumer key/secret pair here and then apply the normal
	 * WordPress capability checks to the key owner.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return int Authenticated user ID, or 0 on failure.
	 */
	private function authenticate_wc_rest_key( WP_REST_Request $request ): int {
		if ( ! function_exists( 'wc_api_hash' ) ) {
			return 0;
		}

		$consumer_key    = (string) $request->get_param( 'consumer_key' );
		$consumer_secret = (string) $request->get_param( 'consumer_secret' );

		if ( '' === $consumer_key || '' === $consumer_secret ) {
			return 0;
		}

		global $wpdb;
		$table = $wpdb->prefix . 'woocommerce_api_keys';
		$key   = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT key_id, user_id, permissions, consumer_secret FROM {$table} WHERE consumer_key = %s LIMIT 1",
				wc_api_hash( $consumer_key )
			)
		);

		if ( ! $key || ! isset( $key->consumer_secret, $key->permissions, $key->user_id ) ) {
			return 0;
		}

		if ( ! hash_equals( (string) $key->consumer_secret, $consumer_secret ) ) {
			return 0;
		}

		if ( ! in_array( (string) $key->permissions, [ 'write', 'read_write' ], true ) ) {
			return 0;
		}

		$wpdb->update(
			$table,
			[ 'last_access' => current_time( 'mysql' ) ],
			[ 'key_id' => (int) $key->key_id ],
			[ '%s' ],
			[ '%d' ]
		);

		return absint( (int) $key->user_id );
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
	 * Check whether a comment is a product review.
	 *
	 * @param WP_Comment $comment Comment object.
	 * @return bool
	 */
	private function is_product_review_comment( WP_Comment $comment ): bool {
		return 'product' === get_post_type( (int) $comment->comment_post_ID )
			&& ( 'review' === $comment->comment_type || '' === $comment->comment_type );
	}

	/**
	 * Map friendly review status names to WordPress comment statuses.
	 *
	 * @param string $status Incoming status.
	 * @return string
	 */
	private function map_review_status( string $status ): string {
		$map = [
			'approved' => 'approve',
			'approve'  => 'approve',
			'hold'     => 'hold',
			'pending'  => 'hold',
			'spam'     => 'spam',
			'trash'    => 'trash',
		];

		return $map[ $status ] ?? '';
	}

	/**
	 * Build a compact review payload for API responses.
	 *
	 * @param int $comment_id Review comment ID.
	 * @return array<string, mixed>
	 */
	private function build_review_response( int $comment_id ): array {
		$comment = get_comment( $comment_id );
		if ( ! $comment ) {
			return [];
		}

		return [
			'id'             => (int) $comment->comment_ID,
			'product_id'     => (int) $comment->comment_post_ID,
			'status'         => $this->normalize_review_status( (string) $comment->comment_approved ),
			'rating'         => (int) get_comment_meta( $comment_id, 'rating', true ),
			'review'         => (string) $comment->comment_content,
			'reviewer'       => (string) $comment->comment_author,
			'reviewer_email' => (string) $comment->comment_author_email,
			'date_created'   => mysql2date( 'c', $comment->comment_date ),
			'date_created_gmt' => mysql2date( 'c', $comment->comment_date_gmt ),
			'media'          => $this->build_review_media_response( $comment_id ),
			'replies'        => $this->build_review_replies_response( $comment_id ),
			'overseekSource' => $this->build_review_source_response( $comment_id ),
		];
	}

	/**
	 * Build Overseek source metadata for review API responses.
	 *
	 * @param int $comment_id Review comment ID.
	 * @return array<string, string>
	 */
	private function build_review_source_response( int $comment_id ): array {
		$source = [];
		$email_message_id = get_comment_meta( $comment_id, 'overseek_source_email_message_id', true );
		$email_log_id = get_comment_meta( $comment_id, 'overseek_source_email_log_id', true );
		$order_id = get_comment_meta( $comment_id, 'overseek_source_order_id', true );

		if ( is_string( $email_message_id ) && '' !== $email_message_id ) {
			$source['emailMessageId'] = $email_message_id;
		}

		if ( is_string( $email_log_id ) && '' !== $email_log_id ) {
			$source['emailLogId'] = $email_log_id;
		}

		if ( is_string( $order_id ) && '' !== $order_id ) {
			$source['orderId'] = $order_id;
		}

		return $source;
	}

	/**
	 * Build approved review replies payload for API responses.
	 *
	 * @param int $comment_id Review comment ID.
	 * @return array<int, array<string, mixed>>
	 */
	private function build_review_replies_response( int $comment_id ): array {
		$children = get_comments(
			[
				'parent' => $comment_id,
				'status' => 'approve',
				'order'  => 'ASC',
			]
		);

		return array_map(
			static function ( WP_Comment $reply ): array {
				return [
					'id'      => (int) $reply->comment_ID,
					'author'  => (string) $reply->comment_author,
					'content' => (string) $reply->comment_content,
					'date'    => mysql2date( 'c', $reply->comment_date_gmt ),
				];
			},
			array_filter( $children, static fn ( $reply ): bool => $reply instanceof WP_Comment )
		);
	}

	/**
	 * Build review media payload for API responses.
	 *
	 * @param int $comment_id Review comment ID.
	 * @return array<int, array<string, mixed>>
	 */
	private function build_review_media_response( int $comment_id ): array {
		$raw_ids = get_comment_meta( $comment_id, 'overseek_media_ids', true );
		if ( empty( $raw_ids ) ) {
			$raw_ids = get_comment_meta( $comment_id, 'ivole_review_image', true );
		}

		$ids = is_array( $raw_ids ) ? $raw_ids : array_filter( array_map( 'absint', explode( ',', (string) $raw_ids ) ) );

		return array_values( array_filter( array_map(
			static function ( $id ): ?array {
				$attachment_id = absint( $id );
				$url = wp_get_attachment_url( $attachment_id );
				if ( ! $url ) {
					return null;
				}

				return [
					'id'       => $attachment_id,
					'url'      => $url,
					'type'     => (string) get_post_mime_type( $attachment_id ),
					'filename' => basename( get_attached_file( $attachment_id ) ?: $url ),
				];
			},
			$ids
		) ) );
	}

	/**
	 * Normalize WordPress comment status to Woo-style names.
	 *
	 * @param string $status Comment approved value.
	 * @return string
	 */
	private function normalize_review_status( string $status ): string {
		if ( '1' === $status ) {
			return 'approved';
		}

		if ( '0' === $status ) {
			return 'hold';
		}

		return $status;
	}

	/**
	 * Sideload remote review attachments into WordPress media.
	 *
	 * @param mixed $attachments Attachment payload.
	 * @param int   $product_id Product ID to attach media to.
	 * @return array<int, int>
	 */
	private function sideload_review_attachments( $attachments, int $product_id ): array {
		if ( ! is_array( $attachments ) ) {
			return [];
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$ids = [];
		foreach ( array_slice( $attachments, 0, self::MAX_REVIEW_ATTACHMENTS ) as $attachment ) {
			if ( ! is_array( $attachment ) || empty( $attachment['url'] ) ) {
				continue;
			}

			$url = esc_url_raw( (string) $attachment['url'] );
			$type = isset( $attachment['type'] ) ? sanitize_text_field( (string) $attachment['type'] ) : '';
			if ( ! $this->review_attachment_type_allowed( $type, $url ) ) {
				continue;
			}

			$temp_file = download_url( $url, 15 );
			if ( is_wp_error( $temp_file ) ) {
				continue;
			}

			$filename = isset( $attachment['filename'] ) ? sanitize_file_name( (string) $attachment['filename'] ) : basename( wp_parse_url( $url, PHP_URL_PATH ) ?: 'review-media' );
			$file = [
				'name'     => $filename ?: 'review-media',
				'tmp_name' => $temp_file,
			];

			$attachment_id = media_handle_sideload( $file, $product_id );
			if ( is_wp_error( $attachment_id ) ) {
				wp_delete_file( $temp_file );
				continue;
			}

			$ids[] = (int) $attachment_id;
		}

		return $ids;
	}

	/**
	 * Check review attachment type.
	 *
	 * @param string $type MIME type.
	 * @param string $url Attachment URL.
	 * @return bool
	 */
	private function review_attachment_type_allowed( string $type, string $url ): bool {
		$allowed_mimes = [
			'image/jpeg',
			'image/png',
			'image/webp',
			'image/gif',
			'video/mp4',
			'video/quicktime',
			'video/webm',
		];

		if ( in_array( strtolower( $type ), $allowed_mimes, true ) ) {
			return true;
		}

		$extension = strtolower( pathinfo( wp_parse_url( $url, PHP_URL_PATH ) ?: '', PATHINFO_EXTENSION ) );
		return in_array( $extension, [ 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm' ], true );
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

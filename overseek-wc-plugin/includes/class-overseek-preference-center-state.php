<?php
/**
 * State loading and updating for the OverSeek preference center.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OverSeek_Preference_Center_State {
	/**
	 * Resolve the current preference-center state for the incoming request.
	 *
	 * @param string $api_url OverSeek API base URL.
	 * @param string $token Preference token from the email log tracking id.
	 * @param bool   $is_post Whether the current request is a POST submission.
	 * @param bool   $is_valid_submission Whether the POST nonce/csrf validation passed.
	 * @param string $scope Requested preference scope.
	 * @return array<string, mixed>
	 */
	public static function resolve( string $api_url, string $token, bool $is_post, bool $is_valid_submission, string $scope = 'MARKETING' ): array {
		if ( $is_post ) {
			if ( ! $is_valid_submission ) {
				return [
					'title'   => 'Invalid Request',
					'message' => 'We could not verify this request. Please reopen the email preferences link and try again.',
					'status'  => 403,
				];
			}

			return self::update( $api_url, $token, $scope );
		}

		return self::load( $api_url, $token );
	}

	/**
	 * Fetch the current preference state from OverSeek.
	 *
	 * @param string $api_url OverSeek API base URL.
	 * @param string $token Preference token from the email log tracking id.
	 * @return array<string, mixed>
	 */
	public static function load( string $api_url, string $token ): array {
		$response = wp_remote_get(
			$api_url . '/api/email/preferences/' . rawurlencode( $token ),
			[
				'timeout' => 15,
				'headers' => [
					'Accept' => 'application/json',
				],
			]
		);

		if ( is_wp_error( $response ) ) {
			return self::unavailable_state( 'We could not load your preferences right now. Please try again in a moment.' );
		}

		$status_code = (int) wp_remote_retrieve_response_code( $response );
		$body        = OverSeek_HTTP_Utils::decode_json_response( $response );

		if ( 404 === $status_code ) {
			return self::invalid_link_state();
		}

		if ( $status_code < 200 || $status_code >= 300 || ! is_array( $body ) ) {
			return self::unavailable_state( 'We could not load your preferences right now. Please try again in a moment.' );
		}

		return self::hydrate_state( $body, $token, 'Email Preferences', 200, false );
	}

	/**
	 * Submit an updated preference scope back to OverSeek.
	 *
	 * @param string $api_url OverSeek API base URL.
	 * @param string $token Preference token from the email log tracking id.
	 * @param string $scope Requested scope from the customer.
	 * @return array<string, mixed>
	 */
	public static function update( string $api_url, string $token, string $scope ): array {
		$normalized_scope = 'ALL' === strtoupper( $scope ) ? 'ALL' : 'MARKETING';

		$response = wp_remote_post(
			$api_url . '/api/email/preferences/' . rawurlencode( $token ),
			[
				'timeout' => 15,
				'headers' => [
					'Accept'       => 'application/json',
					'Content-Type' => 'application/json',
				],
				'body'    => wp_json_encode(
					[
						'scope' => $normalized_scope,
					]
				),
			]
		);

		if ( is_wp_error( $response ) ) {
			return self::unavailable_state( 'We could not update your preferences right now. Please try again in a moment.' );
		}

		$status_code = (int) wp_remote_retrieve_response_code( $response );
		$body        = OverSeek_HTTP_Utils::decode_json_response( $response );

		if ( 404 === $status_code ) {
			return self::invalid_link_state();
		}

		if ( $status_code < 200 || $status_code >= 300 || ! is_array( $body ) ) {
			return self::unavailable_state( 'We could not update your preferences right now. Please try again in a moment.' );
		}

		return self::hydrate_state( $body, $token, 'Preferences Updated', 200, true, $normalized_scope );
	}

	/**
	 * @param array<string, mixed> $body
	 * @return array<string, mixed>
	 */
	private static function hydrate_state( array $body, string $token, string $title, int $status, bool $is_success, string $fallback_scope = 'NONE' ): array {
		return [
			'title'        => $title,
			'status'       => $status,
			'email'        => isset( $body['email'] ) ? (string) $body['email'] : '',
			'accountName'  => isset( $body['accountName'] ) ? (string) $body['accountName'] : 'this sender',
			'currentScope' => isset( $body['currentScope'] ) ? (string) $body['currentScope'] : $fallback_scope,
			'token'        => $token,
			'isSuccess'    => $is_success,
		];
	}

	/**
	 * @return array<string, mixed>
	 */
	private static function invalid_link_state(): array {
		return [
			'title'   => 'Invalid Link',
			'message' => 'This email preferences link is invalid or has expired.',
			'status'  => 404,
		];
	}

	/**
	 * @return array<string, mixed>
	 */
	private static function unavailable_state( string $message ): array {
		return [
			'title'   => 'Unavailable',
			'message' => $message,
			'status'  => 502,
		];
	}
}

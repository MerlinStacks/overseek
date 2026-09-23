<?php
/**
 * Authenticated v1 configuration ingestion, with no storefront activation.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

class OverSeek_Delivery_Input_API {
	public function register_routes(): void {
		register_rest_route( 'overseek/v1', '/delivery-estimates/inputs', [
			'methods' => 'POST',
			'callback' => [ $this, 'ingest' ],
			'permission_callback' => [ $this, 'check_permission' ],
		] );
	}

	/** Discovery enforces Woo permissions and every supplied account alias. */
	public function check_permission( WP_REST_Request $request ) {
		$permission = ( new OverSeek_Delivery_Discovery_API() )->check_permission( $request );
		if ( true !== $permission ) {
			return $permission;
		}
		if ( null === $request->get_header( 'x-overseek-account-id' ) ) {
			return new WP_Error( 'overseek_delivery_account_required', 'Send X-Overseek-Account-Id.', [ 'status' => 400 ] );
		}
		return true;
	}

	/** @return WP_REST_Response|WP_Error Exact contract acknowledgement on success only. */
	public function ingest( WP_REST_Request $request ) {
		$permission = $this->check_permission( $request );
		if ( true !== $permission ) {
			return $permission;
		}
		$body = $request->get_body();
		if ( strlen( $body ) > 512 * 1024 ) {
			return new WP_Error( 'overseek_delivery_input_too_large', 'Delivery input exceeds the size limit.', [ 'status' => 413, 'reason' => 'payload_limits_exceeded' ] );
		}
		try {
			$input = ( new OverSeek_Delivery_Input_Validation() )->validate( $body );
		} catch ( Throwable $error ) {
			return new WP_Error( 'overseek_delivery_input_invalid', 'Invalid delivery input.', [ 'status' => 400, 'reason' => $error instanceof OverSeek_Delivery_Input_Exception ? $error->reason() : 'schema_invalid' ] );
		}
		$applied = ( new OverSeek_Delivery_Input_Storage() )->store( $request->get_header( 'x-overseek-account-id' ), $input );
		if ( $applied instanceof WP_Error ) {
			return $applied;
		}
		return new WP_REST_Response( [
			'schemaVersion' => 1,
			'scope' => $input['scope'],
			'entityId' => $input['entityId'],
			'revision' => $input['revision'],
			'storedRevision' => $input['revision'],
			'applied' => $applied,
			// Legacy wire field: THIS input write does not activate. Not live control status.
			'storefrontActivated' => false,
		], 200 );
	}
}

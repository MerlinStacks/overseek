<?php
/** Fresh observation plus operator-attested resolution; no stock mutation. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Receipt_Reconciliation {
	public function register_routes(): void {
		foreach ( [ 'observe', 'reconcile' ] as $action ) {
			register_rest_route( 'overseek/v1', '/delivery-estimates/receipts/' . $action, [ 'methods' => 'POST', 'callback' => [ $this, $action ], 'permission_callback' => [ new OverSeek_Delivery_Input_API(), 'check_permission' ] ] );
		}
	}
	public function observe( WP_REST_Request $request ) { return $this->handle( $request, false ); }
	public function reconcile( WP_REST_Request $request ) { return $this->handle( $request, true ); }
	private function handle( WP_REST_Request $request, bool $resolve ) {
		global $wpdb;
		$storage = new OverSeek_Receipt_Storage();
		try {
			$permission = ( new OverSeek_Delivery_Input_API() )->check_permission( $request );
			if ( true !== $permission ) { return $permission; }
			$body = $request->get_json_params();
			if ( strlen( $request->get_body() ) > 16384 ) { throw new InvalidArgumentException(); }
			$op = ( new OverSeek_Receipt_Validation() )->decode( wp_json_encode( [ 'schemaVersion' => 1, 'operation' => $body['operation'] ?? null ] ) );
			$account = get_option( 'overseek_account_id', '' );
			if ( ! $storage->lock( $account, $op ) ) { throw new DomainException( 'Owner busy.' ); }
			$storage->install();
			if ( true !== ( new OverSeek_Delivery_Input_API() )->check_permission( $request ) ) { throw new DomainException( 'Account changed.' ); }
			if ( $resolve ) {
				if ( ! is_string( $body['actionId'] ?? null ) || ! preg_match( '/\A[A-Za-z0-9_-]{1,128}\z/', $body['actionId'] ) || ! is_string( $body['actorId'] ?? null ) || ! is_string( $body['reason'] ?? null ) || strlen( trim( $body['reason'] ) ) < 5 || true !== ( $body['correctedCountIncludesOperation'] ?? null ) ) { throw new InvalidArgumentException(); }
				$previous = $storage->resolution( $account, $body['actionId'] );
				if ( $previous ) {
					if ( $previous['requestHash'] !== OverSeek_Receipt_Storage::request_identity( $body ) ) { throw new DomainException( 'Resolution identity conflict.' ); }
					return new WP_REST_Response( $previous['ack'], 200 );
				}
			}
			$row = $storage->operation( $account, $op['operationId'] );
			$guard = $storage->guard( $account, $op['stockOwnerWooId'] );
			if ( ! $row && ! $resolve ) {
				$last = $guard && (int) $guard['sequence'] > 0 ? $storage->operation( $account, $guard['operation_id'] ) : null;
				if ( $op['sequence'] !== ( $guard ? (int) $guard['sequence'] + 1 : 1 ) || ( $guard && (int) $guard['sequence'] > 0 && ( ! $last || ! in_array( (int) $last['phase'], [ 4, 5 ], true ) ) ) ) { throw new DomainException( 'Owner sequence changed.' ); }
				( new OverSeek_Receipt_Validation() )->product( $op );
				$storage->prepare( $account, $op );
				$row = $storage->operation( $account, $op['operationId'] );
				$guard = $storage->guard( $account, $op['stockOwnerWooId'] );
			}
			if ( ! $row || $row['operation'] !== OverSeek_Receipt_Storage::identity( $op ) || ! in_array( (int) $row['phase'], [ 1, 2, 3, 4 ], true ) || ! $guard || $guard['operation_id'] !== $op['operationId'] || (int) $guard['sequence'] !== $op['sequence'] || 1 !== (int) $guard['guard_active'] ) { throw new DomainException( 'Operation/guard changed.' ); }
			$product = ( new OverSeek_Receipt_Validation() )->product( $op );
			if ( ! OverSeek_Receipt_Write_Observer::supported( $product ) ) { throw new DomainException( 'Unsupported stock store.' ); }
			$stocks = $wpdb->get_results( $wpdb->prepare( "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock'", $op['stockOwnerWooId'] ), ARRAY_A );
			if ( $wpdb->last_error || 1 !== count( $stocks ) ) { throw new DomainException( 'Stock unavailable.' ); }
			$quantity = OverSeek_Receipt_Validation::quantity( $stocks[0]['meta_value'] );
			if ( null === $quantity ) { throw new DomainException( 'Invalid stock.' ); }
			$observation = [ 'accountId' => $account, 'operation' => $op, 'guard' => $guard, 'phase' => $row['phase'], 'stock' => $stocks[0], 'expiresAt' => time() + 120, 'nonce' => bin2hex( random_bytes( 16 ) ) ];
			if ( ! $resolve ) {
				$encoded = base64_encode( wp_json_encode( $observation ) );
				return new WP_REST_Response( [ 'schemaVersion' => 1, 'operationId' => $op['operationId'], 'stockQuantity' => $quantity, 'observationToken' => $encoded . '.' . hash_hmac( 'sha256', $encoded, wp_salt( 'auth' ) ), 'expiresAt' => gmdate( 'c', $observation['expiresAt'] ) ], 200 );
			}
			$parts = explode( '.', (string) ( $body['observationToken'] ?? '' ) );
			if ( 2 !== count( $parts ) || ! hash_equals( hash_hmac( 'sha256', $parts[0], wp_salt( 'auth' ) ), $parts[1] ) ) { throw new DomainException( 'Invalid observation.' ); }
			$observed = json_decode( base64_decode( $parts[0], true ), true, 32, JSON_THROW_ON_ERROR );
			if ( $observed['expiresAt'] < time() || $observed['accountId'] !== $account || $observed['operation'] !== $op || $observed['guard'] !== $guard || $observed['phase'] !== $row['phase'] || $observed['stock'] !== $stocks[0] || ( $body['observedStockQuantity'] ?? null ) !== $quantity ) { throw new DomainException( 'Observation stale; observe corrected inventory again.' ); }
			$ack = [ 'schemaVersion' => 1, 'operationId' => $op['operationId'], 'sequence' => $op['sequence'], 'stockOwnerWooId' => $op['stockOwnerWooId'], 'actionId' => $body['actionId'], 'state' => 'reconciled', 'stockQuantity' => $quantity ];
			$storage->reconcile( $account, $op, [ 'actionId' => $body['actionId'], 'actorId' => $body['actorId'], 'reason' => $body['reason'], 'quantity' => $quantity, 'observation' => $observed, 'requestHash' => OverSeek_Receipt_Storage::request_identity( $body ), 'ack' => $ack, 'resolvedAt' => gmdate( 'c' ) ] );
			return new WP_REST_Response( $ack, 200 );
		} catch ( InvalidArgumentException $error ) { return new WP_Error( 'overseek_resolution_invalid', 'Invalid attestation.', [ 'status' => 400 ] );
		} catch ( Throwable $error ) { return new WP_Error( 'overseek_resolution_conflict', $error->getMessage() ?: 'Resolution unavailable.', [ 'status' => 409 ] );
		} finally { $storage->close(); }
	}
}

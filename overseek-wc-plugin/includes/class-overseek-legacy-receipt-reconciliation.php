<?php
/** Explicit legacy-drain attestation. Never retries absolute stock writes or deltas. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Legacy_Receipt_Reconciliation {
	public function register_routes(): void {
		foreach ( [ 'observe', 'reconcile' ] as $action ) {
			register_rest_route( 'overseek/v1', '/delivery-estimates/receipts/legacy/' . $action, [ 'methods' => 'POST', 'callback' => [ $this, $action ], 'permission_callback' => [ new OverSeek_Delivery_Input_API(), 'check_permission' ] ] );
		}
	}
	public function observe( WP_REST_Request $request ) { return $this->handle( $request, false ); }
	public function reconcile( WP_REST_Request $request ) { return $this->handle( $request, true ); }

	/** Resolve actual effective owners, retaining explicit failures rather than inventing quantities. */
	private function topology( array $targets ): array {
		$owners = []; $unobservable = [];
		foreach ( $targets as $target ) {
			$product = wc_get_product( $target['variationWooId'] ?? $target['productWooId'] );
			if ( ! $product instanceof WC_Product || ( null !== $target['variationWooId'] && ( ! $product instanceof WC_Product_Variation || $product->get_parent_id() !== $target['productWooId'] ) ) ) {
				$unobservable[] = [ 'target' => $target, 'reason' => 'missing_or_changed_product_identity' ]; continue;
			}
			$id = $product->get_stock_managed_by_id();
			$owner = wc_get_product( $id );
			if ( ! in_array( $id, [ $target['productWooId'], $target['variationWooId'] ], true ) || ! $owner instanceof WC_Product || ! $owner->managing_stock() || ! OverSeek_Receipt_Write_Observer::supported( $owner ) ) {
				$unobservable[] = [ 'target' => $target, 'reason' => 'unsupported_or_unmanaged_stock_owner' ]; continue;
			}
			$owners[ $id ] = $id;
		}
		sort( $owners, SORT_NUMERIC );
		return [ 'owners' => $owners, 'unobservable' => $unobservable ];
	}

	private function handle( WP_REST_Request $request, bool $resolve ) {
		$storage = new OverSeek_Receipt_Storage();
		try {
			if ( true !== ( $permission = ( new OverSeek_Delivery_Input_API() )->check_permission( $request ) ) ) { return $permission; }
			$body = $request->get_json_params();
			if ( strlen( $request->get_body() ) > 1024 * 1024 || 1 !== ( $body['schemaVersion'] ?? null ) || ! is_string( $body['jobId'] ?? null ) || ! preg_match( '/\A[A-Za-z0-9_-]{1,128}\z/', $body['jobId'] ) || ! is_bool( $body['sourceIncomplete'] ?? null ) || ! is_array( $body['targets'] ?? null ) || count( $body['targets'] ) > 1000 ) { throw new InvalidArgumentException(); }
			foreach ( $body['targets'] as $target ) {
				if ( ! is_int( $target['productWooId'] ?? null ) || $target['productWooId'] < 1 || ! array_key_exists( 'variationWooId', $target ) || ( null !== $target['variationWooId'] && ( ! is_int( $target['variationWooId'] ) || $target['variationWooId'] < 1 ) ) ) { throw new InvalidArgumentException(); }
			}
			$account = get_option( 'overseek_account_id', '' );
			// Account control lock also serializes historical ACK recovery for deleted targets.
			if ( ! $storage->lock_owners( [ 0 ] ) ) { return new WP_Error( 'overseek_legacy_busy', 'Legacy review busy; retry the same action.', [ 'status' => 409 ] ); }
			$storage->install();
			if ( true !== ( $permission = ( new OverSeek_Delivery_Input_API() )->check_permission( $request ) ) ) { return $permission; }
			if ( $resolve ) {
				// The server bounds reason to 1000 UTF-16 units; permit its UTF-8 wire encoding.
				if ( ! is_string( $body['actionId'] ?? null ) || ! preg_match( '/\A[A-Za-z0-9_-]{1,128}\z/', $body['actionId'] ) || ! is_string( $body['actorId'] ?? null ) || ! strlen( $body['actorId'] ) || ! is_string( $body['reason'] ?? null ) || strlen( trim( $body['reason'] ) ) < 5 || strlen( $body['reason'] ) > 4000 || true !== ( $body['workersRestarted'] ?? null ) || true !== ( $body['receivingPaused'] ?? null ) || true !== ( $body['correctedInventoryIncludesLegacyWork'] ?? null ) || ! is_bool( $body['acknowledgeUnobservableTargets'] ?? null ) ) { throw new InvalidArgumentException(); }
				$previous = $storage->resolution( $account, $body['actionId'] );
				if ( $previous ) {
					if ( $previous['requestHash'] !== OverSeek_Receipt_Storage::request_identity( $body ) ) { throw new DomainException( 'Legacy resolution identity conflict.' ); }
					return new WP_REST_Response( $previous['ack'], 200 );
				}
			}
			$topology = $this->topology( $body['targets'] );
			if ( $topology['owners'] && ! $storage->lock_owners( $topology['owners'] ) ) { return new WP_Error( 'overseek_legacy_busy', 'Legacy owner busy; retry the same action.', [ 'status' => 409 ] ); }
			if ( $topology !== $this->topology( $body['targets'] ) ) { throw new DomainException( 'Legacy ownership changed; observe again.' ); }
			$owners = []; $unobservable = $topology['unobservable'];
			foreach ( $topology['owners'] as $id ) {
				$stock = $storage->native_stock( $id );
				if ( null === $stock ) { $unobservable[] = [ 'stockOwnerWooId' => $id, 'reason' => 'native_transactional_stock_unavailable' ]; continue; }
				$owners[] = [ 'stockOwnerWooId' => $id, 'stock' => $stock, 'guard' => $storage->guard( $account, $id ) ];
			}
			$observation = [ 'accountId' => $account, 'jobId' => $body['jobId'], 'targets' => $body['targets'], 'sourceIncomplete' => $body['sourceIncomplete'], 'owners' => $owners, 'unobservable' => $unobservable, 'expiresAt' => time() + 300, 'nonce' => bin2hex( random_bytes( 16 ) ) ];
			if ( ! $resolve ) {
				$encoded = base64_encode( wp_json_encode( $observation ) );
				return new WP_REST_Response( [ 'schemaVersion' => 1, 'jobId' => $body['jobId'], 'sourceIncomplete' => $body['sourceIncomplete'], 'unobservable' => $unobservable,
					'owners' => array_map( static fn( $owner ) => [ 'stockOwnerWooId' => $owner['stockOwnerWooId'], 'stockQuantity' => OverSeek_Receipt_Validation::quantity( $owner['stock']['meta_value'] ) ], $owners ),
					'observationToken' => $encoded . '.' . hash_hmac( 'sha256', $encoded, wp_salt( 'auth' ) ), 'expiresAt' => gmdate( 'c', $observation['expiresAt'] ) ], 200 );
			}
			$parts = explode( '.', (string) ( $body['observationToken'] ?? '' ) );
			if ( 2 !== count( $parts ) || ! hash_equals( hash_hmac( 'sha256', $parts[0], wp_salt( 'auth' ) ), $parts[1] ) ) { throw new DomainException( 'Invalid legacy observation.' ); }
			$observed = json_decode( base64_decode( $parts[0], true ), true, 32, JSON_THROW_ON_ERROR );
			foreach ( [ 'accountId', 'jobId', 'targets', 'sourceIncomplete', 'owners', 'unobservable' ] as $key ) {
				if ( OverSeek_Receipt_Storage::request_identity( [ $observed[ $key ] ?? null ] ) !== OverSeek_Receipt_Storage::request_identity( [ $observation[ $key ] ] ) ) { throw new DomainException( 'Legacy observation stale; observe corrected inventory again.' ); }
			}
			if ( ( $body['sourceIncomplete'] || $unobservable || ! $body['targets'] ) && ! $body['acknowledgeUnobservableTargets'] ) { throw new DomainException( 'Explicit unobservable inventory/dependent-work acknowledgment required.' ); }
			$ack = [ 'schemaVersion' => 1, 'jobId' => $body['jobId'], 'actionId' => $body['actionId'], 'state' => 'operator_attested_drained' ];
			$storage->resolve_legacy( $account, [ 'actionId' => $body['actionId'], 'requestHash' => OverSeek_Receipt_Storage::request_identity( $body ), 'actorId' => $body['actorId'], 'wooUserId' => get_current_user_id(), 'reason' => $body['reason'], 'request' => $body, 'observation' => $observed, 'ack' => $ack, 'resolvedAt' => gmdate( 'c' ) ] );
			return new WP_REST_Response( $ack, 200 );
		} catch ( InvalidArgumentException $error ) { return new WP_Error( 'overseek_legacy_invalid', 'Invalid legacy inventory attestation.', [ 'status' => 400 ] );
		} catch ( Throwable $error ) { return new WP_Error( 'overseek_legacy_conflict', $error->getMessage() ?: 'Legacy review unavailable.', [ 'status' => 409 ] );
		} finally { $storage->close(); }
	}
}

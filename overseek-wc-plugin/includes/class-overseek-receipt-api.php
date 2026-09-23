<?php
/** Authenticated guarded receipts: at-most-one attempted native stock application. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

class OverSeek_Receipt_API {
	public function register_routes(): void {
		foreach ( [ 'prepare', 'apply' ] as $action ) {
			register_rest_route( 'overseek/v1', '/delivery-estimates/receipts/' . $action, [
				'methods' => 'POST',
				'callback' => [ $this, $action ],
				'permission_callback' => [ $this, 'check_permission' ],
			] );
		}
	}

	public function check_permission( WP_REST_Request $request ) {
		return ( new OverSeek_Delivery_Input_API() )->check_permission( $request );
	}

	public function prepare( WP_REST_Request $request ) {
		return $this->ingest( $request, false );
	}

	public function apply( WP_REST_Request $request ) {
		return $this->ingest( $request, true );
	}

	private function error( string $code, int $status ): WP_Error {
		return new WP_Error( 'overseek_receipt_' . $code, 'Guarded receipt ' . str_replace( '_', ' ', $code ) . '.', [ 'status' => $status ] );
	}

	private function ack( array $op, string $state, ?int $quantity = null ): WP_REST_Response {
		return new WP_REST_Response( [ 'schemaVersion' => 1, 'operationId' => $op['operationId'], 'sequence' => $op['sequence'], 'stockOwnerWooId' => $op['stockOwnerWooId'], 'state' => $state, 'stockQuantity' => $quantity, 'guardActive' => true, 'receiptSafety' => 'unverified' ], 200 );
	}

	private function ingest( WP_REST_Request $request, bool $apply ) {
		$permission = $this->check_permission( $request );
		if ( true !== $permission ) {
			return $permission;
		}
		$body = $request->get_body();
		if ( strlen( $body ) > 16 * 1024 ) {
			return $this->error( 'too_large', 413 );
		}
		$validation = new OverSeek_Receipt_Validation();
		try {
			$op = $validation->decode( $body );
		} catch ( Throwable $error ) {
			return $this->error( 'invalid', 400 );
		}
		global $wpdb;
		$previous = $wpdb->suppress_errors( true );
		$storage = new OverSeek_Receipt_Storage();
		$account = $request->get_header( 'x-overseek-account-id' );
		$attempting = false;
		try {
			if ( ! $storage->lock( $account, $op ) ) {
				return $this->error( 'busy', 409 );
			}
			// Recheck after acquiring locks; another linked account never inherits this journal.
			$permission = $this->check_permission( $request );
			if ( true !== $permission ) {
				return $permission;
			}
			$storage->install();
			$row = $storage->operation( $account, $op['operationId'] );
			if ( $row && $row['operation'] !== OverSeek_Receipt_Storage::identity( $op ) ) {
				return $this->error( 'identity_conflict', 409 );
			}
			// A final ACK is historical. Do not consult current stock, ownership or the newer guard.
			if ( $row && in_array( (int) $row['phase'], [ 4, 5 ], true ) ) {
				return $this->ack( $op, 'applied', (int) $row['quantity'] );
			}
			if ( $row && in_array( (int) $row['phase'], [ 2, 3 ], true ) ) {
				// The existing durable barrier is enough to ACK uncertainty even if capture fails.
				$attempting = true;
				if ( 2 === (int) $row['phase'] ) {
					$storage->transition( $account, $op, 3 );
				}
				return $this->ack( $op, 'uncertain' );
			}
			$guard = $storage->guard( $account, $op['stockOwnerWooId'] );
			if ( $row ) {
				if ( ! $guard || $guard['operation_id'] !== $op['operationId'] || (int) $guard['sequence'] !== $op['sequence'] || 1 !== (int) $guard['guard_active'] ) {
					return $this->error( 'guard_conflict', 409 );
				}
				if ( ! $apply ) {
					return $this->ack( $op, 'prepared' );
				}
			} else {
				if ( $apply ) {
					return $this->error( 'not_prepared', 409 );
				}
				$last = $guard ? $storage->operation( $account, $guard['operation_id'] ) : null;
				$baseline = $guard && 0 === (int) $guard['sequence'] && 0 === strpos( $guard['operation_id'], 'baseline_' );
				if ( $op['sequence'] !== ( $guard ? (int) $guard['sequence'] + 1 : 1 ) || ( $guard && ! $baseline && ( ! $last || ! in_array( (int) $last['phase'], [ 4, 5 ], true ) ) ) ) {
					return $this->error( 'sequence_conflict', 409 );
				}
			}
			try {
				$product = $validation->product( $op );
			} catch ( Throwable $error ) {
				return $this->error( 'stock_identity_conflict', 409 );
			}
			try {
				if ( ! OverSeek_Receipt_Write_Observer::supported( $product ) ) {
					return $this->error( 'unsupported_stock_store', 409 );
				}
				$observer = new OverSeek_Receipt_Write_Observer( $op );
			} catch ( Throwable $error ) {
				return $this->error( 'unsupported_stock_store', 409 );
			}
			if ( ! $apply ) {
				$storage->prepare( $account, $op );
				return $this->ack( $op, 'prepared' );
			}
			// Commit uncertainty barrier BEFORE any native hook. Never a transaction across Woo.
			$storage->transition( $account, $op, 2 );
			$attempting = true;
			$permission = $this->check_permission( $request );
			if ( true !== $permission ) {
				return $this->ack( $op, 'uncertain' );
			}
			$storage->assert_locks();
			$storage->assert_idle_connection();
			try {
				$observer->start();
				$result = wc_update_product_stock( $product, abs( $op['delta'] ), $op['delta'] > 0 ? 'increase' : 'decrease' );
				// CPT may return a computed number even when its UPDATE silently failed.
				$quantity = $observer->verified() ? OverSeek_Receipt_Validation::quantity( $result ) : null;
			} catch ( Throwable $error ) {
				$quantity = null;
			} finally {
				$observer->close();
			}
			$storage->transition( $account, $op, null === $quantity ? 3 : 4, $quantity );
			return $this->ack( $op, null === $quantity ? 'uncertain' : 'applied', $quantity );
		} catch ( Throwable $error ) {
			// Failed final capture leaves the durable applying barrier. Never retry Woo here.
			return $attempting ? $this->ack( $op, 'uncertain' ) : $this->error( 'storage_failed', 503 );
		} finally {
			$storage->close();
			$wpdb->suppress_errors( $previous );
		}
	}
}

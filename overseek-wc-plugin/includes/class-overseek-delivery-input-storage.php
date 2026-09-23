<?php
/**
 * Private account-scoped delivery inputs. No option/meta or Woo product writes.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

class OverSeek_Delivery_Input_Storage {
	/** Only called during authenticated, validated ingestion, never during reads. */
	private function install(): void {
		global $wpdb;
		$table = $this->table();
		if ( $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) ) ) {
			return;
		}
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		// ASCII binary keys preserve account case and stay within older index limits.
		dbDelta( "CREATE TABLE {$table} (
			account_id varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			scope varchar(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			entity_id bigint unsigned NOT NULL,
			revision bigint unsigned NOT NULL,
			payload_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			payload longtext NOT NULL,
			PRIMARY KEY  (account_id,scope,entity_id)
		) ENGINE=InnoDB {$wpdb->get_charset_collate()};" );
	}

	private function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'overseek_delivery_inputs';
	}

	/**
	 * Lock the unique key including first-insert races, then compare and replace.
	 * The sentinel revision is never committed. InnoDB serializes competing writers;
	 * conditional UPDATE additionally prevents a stale revision from overwriting.
	 *
	 * @return bool|WP_Error Whether a new revision was applied.
	 */
	public function store( string $account, array $input ) {
		global $wpdb;
		$previous = $wpdb->suppress_errors( true );
		$transaction = false;
		$receipts = null;
		try {
			if ( $account !== get_option( 'overseek_account_id', '' ) ) {
				return new WP_Error( 'overseek_delivery_account_mismatch', 'Account ID does not match linked account.', [ 'status' => 403 ] );
			}
			$decoded = json_decode( json_encode( $input['payload'], JSON_THROW_ON_ERROR ), true, 32, JSON_THROW_ON_ERROR );
			$proof = 'inbound' === $input['scope'] && 'verified' === ( $decoded['receiptSafety'] ?? null ) ? $decoded['receiptProof'] : null;
			if ( $proof ) {
				require_once __DIR__ . '/class-overseek-receipt-storage.php';
				$receipts = new OverSeek_Receipt_Storage();
				$receipts->assert_idle_connection();
			}
			$this->install();
			if ( $proof ) {
				require_once __DIR__ . '/class-overseek-delivery-control.php';
				$control = OverSeek_Delivery_Control::state();
				if ( ( $control['epoch'] ?? null ) !== $proof['epoch'] || ! in_array( $control['mode'] ?? null, [ 'baseline', 'guarded' ], true ) ) { throw new DomainException( 'stale_proof' ); }
				if ( ! $receipts->lock_owners( array_merge( [ 0 ], array_column( $proof['owners'], 'stockOwnerWooId' ) ) ) ) { throw new DomainException( 'stale_proof' ); }
				$receipts->install(); // Prove guard/journal engines remain transactional before the shared transaction.
				$control = OverSeek_Delivery_Control::state();
				if ( ( $control['epoch'] ?? null ) !== $proof['epoch'] ) { throw new DomainException( 'stale_proof' ); }
			}
			$table = $this->table();
			// Fail closed if an installation has been altered to a nontransactional engine.
			$engine = $wpdb->get_var( $wpdb->prepare( 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table ) );
			if ( 'innodb' !== strtolower( (string) $engine ) ) {
				throw new RuntimeException();
			}
			$json = json_encode( $input['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR );
			$hash = hash( 'sha256', $json );
			$this->query( 'START TRANSACTION' );
			$transaction = true;
			$this->query( $wpdb->prepare(
				"INSERT INTO {$table} (account_id, scope, entity_id, revision, payload_hash, payload) VALUES (%s, %s, %d, 0, '', '') ON DUPLICATE KEY UPDATE entity_id = entity_id",
				$account, $input['scope'], $input['entityId']
			) );
			$row = $wpdb->get_row( $wpdb->prepare(
				"SELECT revision, payload_hash FROM {$table} WHERE account_id = %s AND scope = %s AND entity_id = %d FOR UPDATE",
				$account, $input['scope'], $input['entityId']
			), ARRAY_A );
			if ( ! $row ) {
				throw new RuntimeException();
			}
			$revision = (int) $row['revision'];
			if ( $revision > $input['revision'] || ( $revision === $input['revision'] && ! hash_equals( $row['payload_hash'], $hash ) ) ) {
				return new WP_Error( 'overseek_delivery_revision_conflict', 'Delivery input revision conflicts with stored input.', [ 'status' => 409 ] );
			}
			$applied = $revision < $input['revision'];
			if ( $applied ) {
				$changed = $this->query( $wpdb->prepare(
					"UPDATE {$table} SET payload = %s, payload_hash = %s, revision = %d WHERE account_id = %s AND scope = %s AND entity_id = %d AND revision < %d",
					$json, $hash, $input['revision'], $account, $input['scope'], $input['entityId'], $input['revision']
				) );
				if ( 1 !== $changed ) {
					throw new RuntimeException();
				}
			}
			if ( $receipts ) { $receipts->release_proof( $account, $proof ); }
			if ( $account !== get_option( 'overseek_account_id', '' ) ) { throw new RuntimeException(); }
			$this->query( 'COMMIT' );
			$transaction = false;
			return $applied;
		} catch ( DomainException $error ) {
			return new WP_Error( 'overseek_delivery_stale_proof', 'Receipt proof changed; rebuild inbound input.', [ 'status' => 409 ] );
		} catch ( Throwable $error ) {
			return new WP_Error( 'overseek_delivery_storage_failed', 'Delivery input storage is unavailable.', [ 'status' => 503 ] );
		} finally {
			if ( $transaction ) {
				$wpdb->query( 'ROLLBACK' );
			}
			if ( $receipts ) { $receipts->close(); }
			$wpdb->suppress_errors( $previous );
		}
	}

	/** Throw without exposing SQL or payloads. */
	private function query( string $sql ): int {
		global $wpdb;
		$result = $wpdb->query( $sql );
		if ( false === $result ) {
			throw new RuntimeException();
		}
		return (int) $result;
	}

	/** Local readers cannot choose another account or enumerate the catalogue. */
	public function read_settings(): ?array {
		return $this->read( 'settings', 0 );
	}

	public function read_control(): ?array { return $this->read( 'control', 0 ); }

	/** Read one complete product blob; omitted variations have no stored override. */
	public function read_product( int $product_id ): ?array {
		return $product_id > 0 ? $this->read( 'product', $product_id ) : null;
	}

	/** Read one full inbound replacement using only the currently linked account. */
	public function read_inbound( int $parentId ): ?array {
		return $parentId > 0 ? $this->read( 'inbound', $parentId ) : null;
	}

	private function read( string $scope, int $entity_id ): ?array {
		global $wpdb;
		$account = get_option( 'overseek_account_id', '' );
		if ( ! is_string( $account ) || '' === $account ) {
			return null;
		}
		$previous = $wpdb->suppress_errors( true );
		try {
			$table = $this->table();
			$row = $wpdb->get_row( $wpdb->prepare(
				"SELECT revision, payload FROM {$table} WHERE account_id = %s AND scope = %s AND entity_id = %d",
				$account, $scope, $entity_id
			), ARRAY_A );
			if ( ! $row || (int) $row['revision'] < 1 ) {
				return null;
			}
			return [ 'revision' => (int) $row['revision'], 'payload' => json_decode( $row['payload'], true, 32, JSON_THROW_ON_ERROR ) ];
		} catch ( Throwable $error ) {
			return null;
		} finally {
			$wpdb->suppress_errors( $previous );
		}
	}
}

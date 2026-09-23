<?php
/** Private InnoDB append-only receipt journal and account/owner guards. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

class OverSeek_Receipt_Storage {
	private array $locks = [];
	private bool $transaction = false;

	private function table( string $suffix ): string {
		global $wpdb;
		return $wpdb->prefix . 'overseek_receipt_' . $suffix;
	}

	/** Called only after authenticated, validated ingestion. Never an activation/read hook. */
	public function install(): void {
		global $wpdb;
		$this->assert_idle_connection();
		$journal = $this->table( 'journal' );
		$guards = $this->table( 'guards' );
		$definitions = [ $journal => "CREATE TABLE IF NOT EXISTS {$journal} (
			account_id varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			operation_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			owner_id bigint unsigned NOT NULL,
			sequence bigint unsigned NOT NULL,
			phase tinyint unsigned NOT NULL,
			operation longtext NOT NULL,
			quantity bigint NULL,
			PRIMARY KEY (account_id,operation_id,phase),
			UNIQUE KEY owner_sequence (account_id,owner_id,sequence,phase)
		) ENGINE=InnoDB", $guards => "CREATE TABLE IF NOT EXISTS {$guards} (
			account_id varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			owner_id bigint unsigned NOT NULL,
			operation_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			sequence bigint unsigned NOT NULL,
			guard_active tinyint unsigned NOT NULL,
			PRIMARY KEY (account_id,owner_id)
		) ENGINE=InnoDB" ];
		$definitions[ $this->table( 'resolutions' ) ] = 'CREATE TABLE IF NOT EXISTS ' . $this->table( 'resolutions' ) . ' (
			account_id varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			action_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
			audit longtext NOT NULL, PRIMARY KEY (account_id,action_id)
		) ENGINE=InnoDB';
		foreach ( $definitions as $table => $definition ) {
			$engine = $this->engine( $table );
			if ( null === $engine ) {
				// Even IF NOT EXISTS implicitly commits. Never issue DDL for an existing table.
				$this->assert_idle_connection();
				$this->query( $definition );
				$engine = $this->engine( $table );
			}
			if ( 'innodb' !== strtolower( (string) $engine ) ) {
				throw new RuntimeException();
			}
		}
	}

	private function engine( string $table ): ?string {
		global $wpdb;
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table ) );
		if ( $wpdb->last_error ) {
			throw new RuntimeException();
		}
		return $value;
	}

	/**
	 * Prove absence of an unowned transaction, without COMMIT/ROLLBACK or changing autocommit.
	 * PHP mysqli does NOT expose mysqlnd's server_status / SERVER_STATUS_IN_TRANS bit.
	 * Native MySQL ignores SAVEPOINT outside a transaction; RELEASE then gives 1305/42000.
	 * Inside a transaction RELEASE succeeds, so reject (after removing just our probe).
	 * Any other result, unsupported driver or inaccessible handle fails closed.
	 */
	public function assert_idle_connection(): void {
		global $wpdb;
		if ( ! is_object( $wpdb ) || 'wpdb' !== get_class( $wpdb ) || ! ( $wpdb->dbh instanceof mysqli ) ) {
			throw new RuntimeException();
		}
		if ( '1' !== (string) $wpdb->get_var( 'SELECT @@SESSION.autocommit' ) || $wpdb->last_error ) {
			throw new RuntimeException();
		}
		$dbh = $wpdb->dbh;
		$name = 'os_receipt_probe_' . bin2hex( random_bytes( 16 ) );
		if ( true !== $dbh->query( "SAVEPOINT `{$name}`" ) ) {
			throw new RuntimeException();
		}
		try {
			$released = $dbh->query( "RELEASE SAVEPOINT `{$name}`" );
			$absent = false === $released && 1305 === $dbh->errno && '42000' === $dbh->sqlstate;
		} catch ( mysqli_sql_exception $error ) {
			$absent = 1305 === $error->getCode() && '42000' === $error->getSqlState();
		}
		if ( ! $absent || $wpdb->dbh !== $dbh ) {
			throw new RuntimeException();
		}
	}

	/** Fixed order: account operation identity, then physical owner (across relinks). No waiting. */
	public function lock( string $account, array $op ): bool {
		global $wpdb;
		$this->assert_idle_connection();
		foreach ( [ 'op:' . $account . ':' . $op['operationId'], 'owner:' . $op['stockOwnerWooId'] ] as $key ) {
			$name = 'osreceipt:' . substr( hash( 'sha256', $this->table( '' ) . ':' . $key ), 0, 54 );
			// MySQL permits recursive locks on the same connection; reject hook reentrancy too.
			if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT IS_USED_LOCK(%s)', $name ) ) || '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', $name ) ) ) {
				return false;
			}
			$this->locks[] = $name;
		}
		return true;
	}

	/** Detect a dropped/reconnected DB connection before attempting stock. */
	public function assert_locks(): void {
		global $wpdb;
		if ( ! count( $this->locks ) ) {
			throw new RuntimeException();
		}
		foreach ( $this->locks as $name ) {
			if ( '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT IS_USED_LOCK(%s) = CONNECTION_ID()', $name ) ) ) {
				throw new RuntimeException();
			}
		}
	}

	public function operation( string $account, string $id ): ?array {
		global $wpdb;
		$table = $this->table( 'journal' );
		return $this->row( $wpdb->prepare( "SELECT operation, phase, quantity FROM {$table} WHERE account_id = %s AND operation_id = %s ORDER BY phase DESC LIMIT 1", $account, $id ) );
	}

	public function guard( string $account, int $owner ): ?array {
		global $wpdb;
		$table = $this->table( 'guards' );
		return $this->row( $wpdb->prepare( "SELECT operation_id, sequence, guard_active FROM {$table} WHERE account_id = %s AND owner_id = %d", $account, $owner ) );
	}

	/** Finalizers/control acquire physical owners in numeric order, matching prepare/apply. */
	public function lock_owners( array $owners ): bool {
		global $wpdb;
		$this->assert_idle_connection();
		$owners = array_unique( $owners );
		sort( $owners, SORT_NUMERIC );
		foreach ( $owners as $owner ) {
			$name = 'osreceipt:' . substr( hash( 'sha256', $this->table( '' ) . ':owner:' . $owner ), 0, 54 );
			if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT IS_USED_LOCK(%s)', $name ) ) || '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', $name ) ) ) { return false; }
			$this->locks[] = $name;
		}
		return true;
	}

	/** Explicit baseline only, never invoked by normal inbound ingestion or storefront reads. */
	public function baseline( string $account, string $epoch, array $owners ): void {
		global $wpdb;
		$this->begin();
		$table = $this->table( 'guards' );
		foreach ( $owners as $owner ) {
			$guard = $this->guard( $account, $owner );
			$id = 'baseline_' . $epoch;
			if ( $guard && (int) $guard['sequence'] > 0 ) {
				$row = $this->operation( $account, $guard['operation_id'] );
				if ( ! $row || ! in_array( (int) $row['phase'], [ 4, 5 ], true ) ) { throw new RuntimeException( 'Existing owner requires reconciliation.' ); }
				continue;
			}
			if ( $guard && ( 0 !== (int) $guard['sequence'] || $guard['operation_id'] !== $id ) ) { throw new RuntimeException( 'Existing owner requires reconciliation.' ); }
			$this->query( $wpdb->prepare( "INSERT IGNORE INTO {$table} (account_id, owner_id, operation_id, sequence, guard_active) VALUES (%s, %d, %s, 0, 1)", $account, $owner, $id ) );
		}
		$this->commit();
	}

	/** Must run inside the input-storage transaction while all physical owner locks are held. */
	public function release_proof( string $account, array $proof ): void {
		global $wpdb;
		$this->assert_locks();
		$table = $this->table( 'guards' );
		foreach ( $proof['owners'] as $owner ) {
			$guard = $this->guard( $account, $owner['stockOwnerWooId'] );
			if ( ! $guard || (int) $guard['sequence'] !== $owner['sequence'] || $guard['operation_id'] !== $owner['operationId'] ) { throw new DomainException( 'stale_proof' ); }
			if ( 0 === $owner['sequence'] ) {
				if ( $owner['operationId'] !== 'baseline_' . $proof['epoch'] ) { throw new DomainException( 'stale_proof' ); }
			} else {
				$row = $this->operation( $account, $owner['operationId'] );
				if ( ! $row || ! in_array( (int) $row['phase'], [ 4, 5 ], true ) ) { throw new DomainException( 'stale_proof' ); }
			}
			$this->query( $wpdb->prepare( "UPDATE {$table} SET guard_active = 0 WHERE account_id = %s AND owner_id = %d AND sequence = %d AND operation_id = %s", $account, $owner['stockOwnerWooId'], $owner['sequence'], $owner['operationId'] ) );
		}
	}

	public function resolution( string $account, string $action ): ?array {
		global $wpdb;
		$table = $this->table( 'resolutions' );
		$row = $this->row( $wpdb->prepare( "SELECT audit FROM {$table} WHERE account_id = %s AND action_id = %s", $account, $action ) );
		return $row ? json_decode( $row['audit'], true, 32, JSON_THROW_ON_ERROR ) : null;
	}

	/** Fresh native observation; unsupported/nontransactional stores require explicit review. */
	public function native_transactions(): bool {
		global $wpdb;
		return 'innodb' === strtolower( (string) $this->engine( $wpdb->postmeta ) );
	}

	public function native_stock( int $owner, bool $for_update = false ): ?array {
		global $wpdb;
		if ( ! $this->native_transactions() ) { return null; }
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock'" . ( $for_update ? ' FOR UPDATE' : '' ), $owner ), ARRAY_A );
		if ( $wpdb->last_error ) { throw new RuntimeException( 'Stock observation storage unavailable.' ); }
		return 1 === count( $rows ) && null !== OverSeek_Receipt_Validation::quantity( $rows[0]['meta_value'] ) ? $rows[0] : null;
	}

	/** Atomic stock-observation check plus immutable audit/ACK; no stock/journal operation is applied. */
	public function resolve_legacy( string $account, array $audit ): void {
		global $wpdb;
		$this->begin();
		foreach ( $audit['observation']['owners'] as $owner ) {
			if ( $this->native_stock( $owner['stockOwnerWooId'], true ) !== $owner['stock'] || $this->guard( $account, $owner['stockOwnerWooId'] ) !== $owner['guard'] ) { throw new DomainException( 'Legacy observation stale; observe corrected inventory again.' ); }
		}
		if ( $audit['observation']['expiresAt'] < time() || $account !== get_option( 'overseek_account_id', '' ) ) { throw new DomainException( 'Legacy observation expired or account changed.' ); }
		$table = $this->table( 'resolutions' );
		$this->query( $wpdb->prepare( "INSERT INTO {$table} (account_id, action_id, audit) VALUES (%s, %s, %s)", $account, $audit['actionId'], wp_json_encode( $audit ) ) );
		$this->commit();
	}

	/** Operator attestation never invokes stock APIs or replays a delta. */
	public function reconcile( string $account, array $op, array $audit ): void {
		global $wpdb;
		if ( 'innodb' !== strtolower( (string) $this->engine( $wpdb->postmeta ) ) ) { throw new RuntimeException( 'Transactional native stock storage required.' ); }
		$this->begin();
		$table = $this->table( 'resolutions' );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_stock' FOR UPDATE", $op['stockOwnerWooId'] ), ARRAY_A );
		if ( 1 !== count( $rows ) || $rows[0] !== $audit['observation']['stock'] || $audit['observation']['expiresAt'] < time() ) { throw new DomainException( 'Stock observation changed or expired.' ); }
		$this->append( $account, $op, 5, $audit['quantity'] );
		$this->query( $wpdb->prepare( "INSERT INTO {$table} (account_id, action_id, audit) VALUES (%s, %s, %s)", $account, $audit['actionId'], wp_json_encode( $audit ) ) );
		$this->commit();
	}

	/** Atomically append prepared and advance the active owner guard. */
	public function prepare( string $account, array $op ): void {
		global $wpdb;
		$this->begin();
		$this->append( $account, $op, 1, null );
		$table = $this->table( 'guards' );
		$this->query( $wpdb->prepare( "INSERT INTO {$table} (account_id, owner_id, operation_id, sequence, guard_active) VALUES (%s, %d, %s, %d, 1) ON DUPLICATE KEY UPDATE operation_id = VALUES(operation_id), sequence = VALUES(sequence), guard_active = 1", $account, $op['stockOwnerWooId'], $op['operationId'], $op['sequence'] ) );
		$this->commit();
	}

	/** Each status is a new journal row. No operation is overwritten or deleted. */
	public function transition( string $account, array $op, int $phase, ?int $quantity = null ): void {
		$this->begin();
		$this->append( $account, $op, $phase, $quantity );
		$this->commit();
	}

	private function append( string $account, array $op, int $phase, ?int $quantity ): void {
		global $wpdb;
		$table = $this->table( 'journal' );
		$sql = $wpdb->prepare( "INSERT INTO {$table} (account_id, operation_id, owner_id, sequence, phase, operation, quantity) VALUES (%s, %s, %d, %d, %d, %s, " . ( null === $quantity ? 'NULL' : '%d' ) . ')', ...array_merge( [ $account, $op['operationId'], $op['stockOwnerWooId'], $op['sequence'], $phase, self::identity( $op ) ], null === $quantity ? [] : [ $quantity ] ) );
		if ( 1 !== $this->query( $sql ) ) {
			throw new RuntimeException();
		}
	}

	public static function identity( array $op ): string {
		return json_encode( $op, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR );
	}

	/** PostgreSQL JSONB reorders object members; transport identity must not depend on that order. */
	public static function request_identity( array $value ): string {
		$canonical = static function ( $node ) use ( &$canonical ) {
			if ( ! is_array( $node ) ) { return $node; }
			if ( ! array_is_list( $node ) ) { ksort( $node, SORT_STRING ); }
			return array_map( $canonical, $node );
		};
		return hash( 'sha256', json_encode( $canonical( $value ), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR ) );
	}

	private function begin(): void {
		$this->assert_locks();
		$this->assert_idle_connection();
		$this->query( 'START TRANSACTION' );
		$this->transaction = true;
	}

	private function commit(): void {
		$this->assert_locks();
		$this->query( 'COMMIT' );
		$this->transaction = false;
	}

	private function row( string $sql ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $sql, ARRAY_A );
		if ( $wpdb->last_error ) {
			throw new RuntimeException();
		}
		return $row;
	}

	private function query( string $sql ): int {
		global $wpdb;
		$result = $wpdb->query( $sql );
		if ( false === $result ) {
			throw new RuntimeException();
		}
		return (int) $result;
	}

	/** Always rollback before releasing locks, including partial lock acquisition. */
	public function close(): void {
		global $wpdb;
		if ( $this->transaction ) {
			$wpdb->query( 'ROLLBACK' );
			$this->transaction = false;
		}
		foreach ( array_reverse( $this->locks ) as $name ) {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
		}
		$this->locks = [];
	}
}

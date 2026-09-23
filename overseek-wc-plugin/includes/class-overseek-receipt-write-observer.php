<?php
/** Scoped evidence of native CPT stock SQL completion, never a stock writer. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

class OverSeek_Receipt_Write_Observer {
	private object $db;
	private string $expected;
	private int $owner;
	private string $method;
	private int $announcements = 0;
	private int $confirmed = 0;
	private int $writes = 0;
	private int $completed = 0;
	private bool $invalid = false;
	private bool $in_query_filter = false;
	private ?array $pending = null;
	private array $hooks = [];

	/** Reject detectable custom storage before committing applying or calling Woo. */
	public static function supported( $product ): bool {
		global $wpdb;
		if ( ! is_object( $wpdb ) || 'wpdb' !== get_class( $wpdb ) || ! class_exists( 'WC_Data_Store' ) || ! is_callable( [ $product, 'get_data_store' ] ) ) {
			return false;
		}
		foreach ( [ 'add_filter', 'remove_filter', 'has_filter' ] as $function ) {
			if ( ! function_exists( $function ) ) {
				return false;
			}
		}
		foreach ( [ 'last_query', 'last_error', 'rows_affected', 'num_queries', 'postmeta' ] as $property ) {
			if ( ! property_exists( $wpdb, $property ) ) {
				return false;
			}
		}
		// wc_update_product_stock loads 'product', even for an independent variation.
		$stock_store = WC_Data_Store::load( 'product' );
		$product_store = $product->get_data_store();
		$expected = $product instanceof WC_Product_Variation ? 'WC_Product_Variation_Data_Store_CPT'
			: ( 'variable' === $product->get_type() ? 'WC_Product_Variable_Data_Store_CPT' : 'WC_Product_Data_Store_CPT' );
		return self::native_store( $stock_store, 'WC_Product_Data_Store_CPT' ) && self::native_store( $product_store, $expected );
	}

	private static function native_store( $store, string $expected ): bool {
		return is_object( $store ) && 'WC_Data_Store' === get_class( $store ) && is_callable( [ $store, 'get_current_class_name' ] ) && $expected === $store->get_current_class_name();
	}

	public function __construct( array $op ) {
		global $wpdb;
		$this->db = $wpdb;
		$this->owner = $op['stockOwnerWooId'];
		$this->method = $op['delta'] > 0 ? 'increase' : 'decrease';
		// Exact supported CPT statement, including signed six-decimal increment/decrement.
		// This string is ONLY compared with observed SQL; it is never executed here.
		$this->expected = $wpdb->prepare(
			"UPDATE {$wpdb->postmeta} SET meta_value = meta_value %+f WHERE post_id = %d AND meta_key='_stock'",
			$op['delta'], $this->owner
		);
	}

	/** Install only inside guarded apply's try/finally, immediately around the native call. */
	public function start(): void {
		$this->hooks = [
			[ 'woocommerce_product_data_store', 'store', PHP_INT_MAX, 1 ],
			[ 'woocommerce_update_product_stock_query', 'announce', PHP_INT_MIN, 4 ],
			[ 'woocommerce_update_product_stock_query', 'confirm', PHP_INT_MAX, 4 ],
			[ 'query', 'before_query', PHP_INT_MIN, 1 ],
			[ 'query', 'issuing_query', PHP_INT_MAX, 1 ],
		];
		foreach ( $this->hooks as [ $hook, $method, $priority, $arguments ] ) {
			add_filter( $hook, [ $this, $method ], $priority, $arguments );
		}
	}

	/** Observe dynamic datastore resolution without replacing or forcing it. */
	public function store( $store ) {
		$name = is_object( $store ) ? get_class( $store ) : $store;
		if ( 'WC_Product_Data_Store_CPT' !== $name ) {
			$this->invalid = true;
		}
		return $store;
	}

	public function announce( $sql, $owner, $quantity, $method ) {
		$this->announcements++;
		if ( 1 !== $this->announcements || $this->expected !== $sql || $this->owner !== $owner || $this->method !== $method || null === OverSeek_Receipt_Validation::quantity( $quantity ) ) {
			$this->invalid = true;
		}
		return $sql;
	}

	public function confirm( $sql, $owner, $quantity, $method ) {
		$this->confirmed++;
		if ( 1 !== $this->confirmed || 1 !== $this->announcements || $this->expected !== $sql || $this->owner !== $owner || $this->method !== $method ) {
			$this->invalid = true;
		}
		return $sql;
	}

	/** WordPress applies 'query' BEFORE flushing the previous query's result/error. */
	public function before_query( $sql ) {
		$this->capture();
		if ( $this->in_query_filter ) {
			// Recursive query filters make completion/issuance attribution ambiguous.
			$this->invalid = true;
		}
		$this->in_query_filter = true;
		return $sql;
	}

	public function issuing_query( $sql ) {
		if ( ! $this->in_query_filter || ! is_string( $sql ) ) {
			$this->invalid = true;
		}
		$this->in_query_filter = false;
		$stock = $sql === $this->expected;
		if ( $stock ) {
			$this->writes++;
			if ( 1 !== $this->writes || 1 !== $this->announcements || 1 !== $this->confirmed ) {
				$this->invalid = true;
			}
		} elseif ( is_string( $sql ) && preg_match( '/\A\s*(?:UPDATE|INSERT|REPLACE|DELETE|WITH)\b/i', $sql ) && false !== stripos( $sql, $this->db->postmeta ) && preg_match( '/[\'\"]_stock[\'\"]/i', $sql ) ) {
			// Extra/altered stock writes cannot count as the one requested native delta.
			$this->invalid = true;
		}
		$this->pending = [ $sql, $this->db->num_queries, $stock ];
		return $sql;
	}

	/** No SQL here: preserve failures even when subsequent cache/lookup queries clear wpdb. */
	private function capture(): void {
		global $wpdb;
		if ( $wpdb !== $this->db ) {
			$this->invalid = true;
		}
		if ( null === $this->pending ) {
			return;
		}
		[ $sql, $count, $stock ] = $this->pending;
		$this->pending = null;
		// Also detect a later query filter rewriting SQL, hidden queries and reconnect retries.
		if ( $this->db->last_query !== $sql || $this->db->num_queries !== $count + 1 || '' !== $this->db->last_error ) {
			$this->invalid = true;
		}
		if ( $stock ) {
			if ( '' !== $this->db->last_error || 1 !== $this->db->rows_affected ) {
				$this->invalid = true;
			} else {
				$this->completed++;
			}
		}
	}

	/** Finalize before any journal queries can overwrite the last native query's evidence. */
	public function verified(): bool {
		$this->capture();
		foreach ( $this->hooks as [ $hook, $method, $priority ] ) {
			if ( $priority !== has_filter( $hook, [ $this, $method ] ) ) {
				$this->invalid = true;
			}
		}
		return ! $this->invalid && ! $this->in_query_filter && 1 === $this->announcements && 1 === $this->confirmed && 1 === $this->writes && 1 === $this->completed;
	}

	/** Remove just this observer's callbacks on success, exceptions and ambiguous traces. */
	public function close(): void {
		foreach ( $this->hooks as [ $hook, $method, $priority ] ) {
			remove_filter( $hook, [ $this, $method ], $priority );
		}
		$this->hooks = [];
	}
}

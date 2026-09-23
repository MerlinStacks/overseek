<?php
/**
 * Callable, local-only staged delivery adapter. See delivery-live-adapter.md.
 * Kept together beyond 200 lines so cart snapshot consistency, local input
 * validation and the receipt gate remain one auditable fail-closed boundary.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-overseek-delivery-input-storage.php';
require_once __DIR__ . '/class-overseek-delivery-engine.php';
require_once __DIR__ . '/class-overseek-delivery-rate-resolver.php';
require_once __DIR__ . '/class-overseek-delivery-stock-snapshot.php';

final class OverSeek_Delivery_Live_Adapter {
	private OverSeek_Delivery_Input_Storage $storage;

	/** Storage readers select the linked account internally; callers cannot select a tenant. */
	public function __construct( ?OverSeek_Delivery_Input_Storage $storage = null ) {
		$this->storage = $storage ?? new OverSeek_Delivery_Input_Storage();
	}

	/**
	 * Calculate a complete cart snapshot (Woo get_cart() rows) and actual eligible rates.
	 * All caches are scoped to this call. No hooks, network, rate calculation or writes.
	 */
	public function calculate( array $cart, array $rates, ?DateTimeImmutable $now = null ): array {
		try {
			return $this->resolve( $cart, $rates, $now ?? new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) ) );
		} catch ( InvalidArgumentException $error ) {
			return [ 'status' => 'unavailable', 'reason' => $error->getMessage() ];
		} catch ( Throwable $error ) {
			return [ 'status' => 'unavailable', 'reason' => 'local_input_unavailable' ];
		}
	}

	/** Resolve all physical lines before calculating any dates. */
	private function resolve( array $cart, array $rates, DateTimeImmutable $now ): array {
		$account = get_option( 'overseek_account_id', '' );
		self::check( is_string( $account ) && '' !== $account, 'account_missing' );
		$payload = self::payload( $this->storage->read_settings(), 'settings_missing' );
		self::check( false !== ( $payload['enabled'] ?? null ), 'feature_off' );
		self::check( true === ( $payload['enabled'] ?? null ) && is_array( $payload['settings'] ?? null ), 'invalid_settings' );
		self::check( count( $cart ) <= 200, 'input_too_large' );
		$settings = $payload['settings'];
		$products = [];
		$snapshots = [];
		$blobs = [];
		$items = [];
		$owners = [];
		$demand = [];
		$live = [];
		$held_exclusion = self::held_exclusion( $cart );
		foreach ( $cart as $line ) {
			self::check( is_array( $line ) && ( $line['data'] ?? null ) instanceof WC_Product, 'invalid_item' );
			$product = $line['data'];
			$id = $product->get_id();
			self::integer( $id, 1, PHP_INT_MAX, 'invalid_item' );
			self::remember_product( $product, $products, $snapshots );
			$virtual = $product->is_virtual();
			$shipping = $product->needs_shipping();
			self::check( is_bool( $virtual ) && is_bool( $shipping ), 'invalid_item' );
			if ( $virtual || ! $shipping ) {
				continue;
			}
			self::check( $product->is_type( [ 'simple', 'variation' ] ), 'unsupported_item' );
			$variation = $product->is_type( 'variation' );
			$parent_id = $variation ? $product->get_parent_id() : $id;
			self::integer( $parent_id, 1, PHP_INT_MAX, 'invalid_parent' );
			self::check( ( $line['product_id'] ?? null ) === $parent_id && ( $line['variation_id'] ?? null ) === ( $variation ? $id : 0 ), 'inconsistent_cart' );
			$quantity = $line['quantity'] ?? null;
			self::integer( $quantity, 1, 1000000, 'invalid_quantity' );
			self::check( true === $product->is_purchasable(), 'blocked_item' );
			$status = self::stock_status( $product->get_stock_status() );
			if ( $variation ) {
				self::check( $product instanceof WC_Product_Variation && $parent_id !== $id, 'invalid_parent' );
				$parent = self::product( $parent_id, $products, $snapshots );
				self::check( $parent->is_type( 'variable' ), 'invalid_parent' );
			}
			if ( ! isset( $blobs[ $parent_id ] ) ) {
				$production = self::payload( $this->storage->read_product( $parent_id ), 'production_missing' );
				$inbound = self::payload( $this->storage->read_inbound( $parent_id ), 'inbound_missing' );
				self::check( ( $production['wooId'] ?? null ) === $parent_id, 'production_identity_mismatch' );
				$blobs[ $parent_id ] = [
					'proof' => $inbound['receiptProof'] ?? null,
					'production' => self::production_map( $production ),
					'targets' => self::inbound_map( $inbound, $parent_id, $now ),
				];
			}
			$blob = $blobs[ $parent_id ];
			$range = $blob['production'][ $id ] ?? $blob['production'][ $parent_id ];
			self::check( null !== $range, 'missing_range' );
			$target = $blob['targets'][ $id ] ?? null;
			self::check( is_array( $target ), 'inbound_target_missing' );
			self::check( 'unsupported' !== $target['state'], 'inbound_unsupported' );
			self::check( 'integrity_error' !== $target['state'], 'inbound_integrity_error' );
			$owner_id = $product->get_stock_managed_by_id();
			self::integer( $owner_id, 1, PHP_INT_MAX, 'invalid_stock_owner' );
			self::check( in_array( $owner_id, [ $id, $parent_id ], true ) && $target['stockOwnerWooId'] === $owner_id, 'stock_owner_mismatch' );
			$owner = self::product( $owner_id, $products, $snapshots );
			$manages = $owner->managing_stock();
			$product_manages = $product->managing_stock();
			// Native variations return 'parent', not boolean true, for inherited stock.
			$inherited = 'parent' === $product_manages && $variation && $product instanceof WC_Product_Variation &&
				$owner_id === $parent_id && $owner_id !== $id && $owner->is_type( 'variable' ) && true === $manages;
			self::check( is_bool( $manages ) && ( $product_manages === $manages || $inherited ), 'invalid_stock_owner' );
			$backorders = $owner->backorders_allowed();
			self::check( is_bool( $backorders ) && is_bool( $product->backorders_allowed() ), 'invalid_stock' );
			$key = 'product:' . $owner_id;
			$demand[ $key ] = ( $demand[ $key ] ?? 0 ) + $quantity;
			self::integer( $demand[ $key ], 1, 1000000, 'invalid_quantity' );
			if ( $manages ) {
				self::check( is_array( $blob['proof'] ), 'receipt_safety_unverified' );
				if ( ! isset( $live[ $key ] ) ) {
					$snapshot = OverSeek_Delivery_Stock_Snapshot::read( $account, $owner, $blob['proof'], $held_exclusion );
					$live[ $key ] = [ 'owner' => $owner, 'proof' => $blob['proof'], 'snapshot' => $snapshot, 'target' => $target ];
					$owners[ $key ] = $snapshot + [ 'projection_status' => 'ready', 'supplier_lead' => $target['supplierLead'], 'inbound' => array_map( static fn( $b ) => [ 'date' => $b['dueDate'], 'quantity' => $b['quantity'], 'eligible' => true ], $target['batches'] ) ];
				} else {
					self::check( $live[ $key ]['target']['batches'] === $target['batches'], 'owner_pool_conflict' );
				}
				// Only physical targets in this calculation contribute; stock/batches stay pooled once.
				$fallback = $settings['fallbackSupplierLeadTimeDays'] ?? 30;
				$lead = $target['supplierLead'] ?? self::range( [ 'min' => $fallback, 'max' => $fallback ] );
				$previous = $owners[ $key ]['supplier_lead'] ?? $lead;
				$owners[ $key ]['supplier_lead'] = [ 'min' => max( $previous['min'], $lead['min'] ), 'max' => max( $previous['max'], $lead['max'] ) ];
				$status = $owners[ $key ]['stock_status'];
			} else {
				self::check( 'in_stock' === $status, 'unsupported_unmanaged_backorder' );
			}
			$items[] = [ 'virtual' => false, 'needs_shipping' => true, 'supported' => true, 'purchasable' => true,
				'stock_status' => $status, 'quantity' => $quantity, 'production' => $range,
				'managed_stock' => $manages, 'stock_owner' => $key ];
		}
		// Every managed owner already passed its proof/guard fence, even when fully stocked.
		$methods = OverSeek_Delivery_Rate_Resolver::resolve( $settings, $rates );
		self::check( $account === get_option( 'overseek_account_id', '' ), 'account_changed' );
		$result = OverSeek_Delivery_Engine::calculate( [
			'enabled' => true, 'context_status' => 'ready', 'timezone' => $settings['timezone'] ?? null,
			'now' => $now->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d\TH:i:s\Z' ),
			'cutoff' => $settings['cutoffTime'] ?? null, 'work_weekdays' => $settings['productionWeekdays'] ?? null,
			'transit_weekdays' => $settings['transitWeekdays'] ?? null, 'closures' => $settings['closures'] ?? null,
			'fallback_lead' => [ 'min' => $settings['fallbackSupplierLeadTimeDays'] ?? 30, 'max' => $settings['fallbackSupplierLeadTimeDays'] ?? 30 ],
			'items' => $items, 'stock_owners' => $owners, 'methods' => $methods,
		] );
		foreach ( $live as $entry ) {
			self::check( $entry['snapshot'] === OverSeek_Delivery_Stock_Snapshot::read( $account, $entry['owner'], $entry['proof'], $held_exclusion ), 'stock_snapshot_changed' );
		}
		return $result;
	}

	/** Exclude this cart's own reservation only for a hash-matching session order.
	 * Synthetic product-page carts must still count every existing order's held stock.
	 */
	private static function held_exclusion( array $cart ): int {
		try {
			if ( ! function_exists( 'WC' ) || ! function_exists( 'wc_get_order' ) ) { return 0; }
			$woo = WC();
			if ( ! $woo || ! $woo->session || ! $woo->cart || $cart !== $woo->cart->get_cart() ) { return 0; }
			foreach ( [ 'store_api_draft_order', 'order_awaiting_payment' ] as $key ) {
				$id = (int) $woo->session->get( $key, 0 );
				$order = $id > 0 ? wc_get_order( $id ) : null;
				if ( $order && $order->has_status( [ 'checkout-draft', 'pending', 'failed' ] ) && $order->get_cart_hash() && hash_equals( $order->get_cart_hash(), $woo->cart->get_cart_hash() ) ) { return $id; }
			}
		} catch ( Throwable $error ) { /* Missing checkout context never permits an exclusion. */ }
		return 0;
	}

	/** Cache only explicitly referenced parents/owners, never enumerate products. */
	private static function product( int $id, array &$cache, array &$snapshots ): WC_Product {
		if ( ! isset( $cache[ $id ] ) ) {
			$cache[ $id ] = wc_get_product( $id );
		}
		self::check( $cache[ $id ] instanceof WC_Product && $cache[ $id ]->get_id() === $id, 'stock_owner_missing' );
		self::remember_product( $cache[ $id ], $cache, $snapshots );
		return $cache[ $id ];
	}

	/** Equivalent Woo instances may occupy separate cart keys; compare fulfilment, not references. */
	private static function remember_product( WC_Product $product, array &$cache, array &$snapshots ): void {
		$id = $product->get_id();
		$snapshot = [
			'type' => $product->get_type(), 'parent' => $product->get_parent_id(),
			'variation' => $product instanceof WC_Product_Variation,
			'virtual' => $product->is_virtual(), 'shipping' => $product->needs_shipping(),
		];
		// Excluded items do not need stock/purchasability resolution, but cannot mask a physical clone.
		if ( true !== $snapshot['virtual'] && false !== $snapshot['shipping'] ) {
			$snapshot += [
				'purchasable' => $product->is_purchasable(), 'owner' => $product->get_stock_managed_by_id(),
				'managed' => $product->managing_stock(), 'quantity' => $product->get_stock_quantity(),
				'status' => $product->get_stock_status(), 'backorders' => $product->backorders_allowed(),
			];
		}
		self::check( ! isset( $snapshots[ $id ] ) || $snapshots[ $id ] === $snapshot, 'inconsistent_cart' );
		$snapshots[ $id ] = $snapshot;
		// Keep the first equivalent owner object; never replace stock with the last cart row.
		$cache[ $id ] = $cache[ $id ] ?? $product;
	}

	/** Reject missing/tombstoned/corrupt private rows. */
	private static function payload( ?array $row, string $reason ): array {
		self::check( is_array( $row ) && is_int( $row['revision'] ?? null ) && $row['revision'] > 0 && is_array( $row['payload'] ?? null ), $reason );
		return $row['payload'];
	}

	/** Index each complete parent blob once. Null variation pair inherits, zero does not. */
	private static function production_map( array $payload ): array {
		$map = [ $payload['wooId'] => self::production_range( $payload ) ];
		self::check( is_array( $payload['variations'] ?? null ) && count( $payload['variations'] ) <= 1000, 'invalid_production' );
		foreach ( $payload['variations'] as $row ) {
			self::check( is_array( $row ), 'invalid_production' );
			$id = $row['wooId'] ?? null;
			self::integer( $id, 1, PHP_INT_MAX, 'invalid_production' );
			self::check( ! array_key_exists( $id, $map ), 'invalid_production' );
			$map[ $id ] = self::production_range( $row );
		}
		return $map;
	}

	/** Null must be explicit on both endpoints; missing/half ranges are corrupt. */
	private static function production_range( array $row ): ?array {
		self::check( array_key_exists( 'productionMinDays', $row ) && array_key_exists( 'productionMaxDays', $row ), 'invalid_production' );
		if ( null === $row['productionMinDays'] && null === $row['productionMaxDays'] ) {
			return null;
		}
		return self::range( [ 'min' => $row['productionMinDays'], 'max' => $row['productionMaxDays'] ] );
	}

	/** Validate freshness and the entire replacement; never renew on read. */
	private static function inbound_map( array $payload, int $parent_id, DateTimeImmutable $now ): array {
		self::check( ( $payload['wooId'] ?? null ) === $parent_id && in_array( $payload['receiptSafety'] ?? null, [ 'unverified', 'verified' ], true ), 'invalid_inbound' );
		if ( 'verified' === $payload['receiptSafety'] ) { self::check( is_array( $payload['receiptProof'] ?? null ) && 1 === ( $payload['receiptProof']['version'] ?? null ), 'invalid_inbound' ); }
		$generated = self::instant( $payload['generatedAt'] ?? null );
		$expires = self::instant( $payload['expiresAt'] ?? null );
		self::check( $expires == $generated->modify( '+24 hours' ), 'invalid_inbound' );
		// Stricter than ingestion's five-minute skew allowance: wait until the recorded build instant.
		self::check( $generated <= $now && $now < $expires, 'inbound_stale' );
		self::check( is_array( $payload['targets'] ?? null ) && count( $payload['targets'] ) <= 1001, 'invalid_inbound' );
		$map = [];
		$batches = 0;
		$pools = [];
		foreach ( $payload['targets'] as $row ) {
			self::check( is_array( $row ), 'invalid_inbound' );
			$id = $row['wooId'] ?? null;
			self::integer( $id, 1, PHP_INT_MAX, 'invalid_inbound' );
			self::check( ! isset( $map[ $id ] ) && in_array( $row['state'] ?? null, [ 'pending', 'unsupported', 'integrity_error' ], true ) && array_key_exists( 'stockOwnerWooId', $row ), 'invalid_inbound' );
			if ( null !== $row['stockOwnerWooId'] ) {
				self::integer( $row['stockOwnerWooId'], 1, PHP_INT_MAX, 'invalid_inbound' );
			}
			self::check( array_key_exists( 'supplierLead', $row ), 'invalid_inbound' );
			if ( null !== $row['supplierLead'] ) {
				self::range( $row['supplierLead'] );
			}
			self::check( is_array( $row['batches'] ?? null ), 'invalid_inbound' );
			$pool = $row['stockOwnerWooId'];
			if ( null === $pool || ! isset( $pools[ $pool ] ) ) { $batches += count( $row['batches'] ); }
			if ( null !== $pool ) {
				self::check( ! isset( $pools[ $pool ] ) || $pools[ $pool ] === $row['batches'], 'owner_pool_conflict' );
				$pools[ $pool ] = $row['batches'];
			}
			self::check( $batches <= 1000, 'invalid_inbound' );
			foreach ( $row['batches'] as $batch ) {
				self::check( is_array( $batch ) && OverSeek_Delivery_Calendar::valid_date( $batch['dueDate'] ?? null ), 'invalid_inbound' );
				self::integer( $batch['quantity'] ?? null, 1, 1000000, 'invalid_inbound' );
			}
			$map[ $id ] = $row;
		}
		return $map;
	}

	/** UTC ISO instants, including server millisecond timestamps; no normalization of invalid dates. */
	private static function instant( $value ): DateTimeImmutable {
		self::check( is_string( $value ) && 1 === preg_match( '/\A\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z\z/', $value ) && OverSeek_Delivery_Calendar::valid_date( substr( $value, 0, 10 ) ), 'invalid_inbound' );
		return new DateTimeImmutable( $value, new DateTimeZone( 'UTC' ) );
	}

	/** Strict bounded range shared by production and inbound lead validation. */
	private static function range( $row ): array {
		self::check( is_array( $row ), 'invalid_range' );
		self::integer( $row['min'] ?? null, 0, 3650, 'invalid_range' );
		self::integer( $row['max'] ?? null, $row['min'], 3650, 'invalid_range' );
		return [ 'min' => $row['min'], 'max' => $row['max'] ];
	}

	/** Woo stock statuses are authoritative; backorders never override outofstock. */
	private static function stock_status( $status ): string {
		self::check( in_array( $status, [ 'instock', 'onbackorder' ], true ), 'blocked_stock' );
		return 'instock' === $status ? 'in_stock' : 'on_backorder';
	}

	/** Do not round quantities or coerce numeric strings. */
	private static function integer( $value, int $min, int $max, string $reason ): void {
		self::check( is_int( $value ) && $value >= $min && $value <= $max, $reason );
	}

	/** Internal failures carry diagnostic codes only, never partial dates. */
	private static function check( bool $valid, string $reason ): void {
		if ( ! $valid ) {
			throw new InvalidArgumentException( $reason );
		}
	}
}

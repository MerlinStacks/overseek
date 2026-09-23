<?php
/** Account-bound monotonic launch control. No network or rate calculation on reads. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/class-overseek-delivery-input-storage.php';
require_once __DIR__ . '/class-overseek-receipt-storage.php';

final class OverSeek_Delivery_Control {
	public static function state(): array {
		$row = ( new OverSeek_Delivery_Input_Storage() )->read_control();
		return $row ? $row['payload'] + [ 'revision' => $row['revision'] ] : [ 'revision' => 0, 'active' => false, 'mode' => 'legacy', 'epoch' => null ];
	}

	/** Cheap option-only fingerprint. No plugin headers or page parsing on storefront reads. */
	public static function fingerprint(): string {
		$active = (array) get_option( 'active_plugins', [] ); sort( $active, SORT_STRING );
		$network = (array) get_site_option( 'active_sitewide_plugins', [] ); ksort( $network, SORT_STRING );
		return hash( 'sha256', json_encode( [ get_option( 'overseek_account_id', '' ), $active, $network,
			get_option( 'overseek_delivery_environment_generation', '' ), get_site_option( 'overseek_delivery_environment_generation', '' ),
			defined( 'WC_VERSION' ) ? WC_VERSION : null, defined( 'OVERSEEK_WC_VERSION' ) ? OVERSEEK_WC_VERSION : null,
			get_option( 'woocommerce_cart_page_id', 0 ), get_option( 'woocommerce_checkout_page_id', 0 ), get_option( 'woocommerce_pickup_location_settings', [] ), get_option( 'woocommerce_manage_stock', 'yes' ),
		], JSON_THROW_ON_ERROR ) );
	}

	public static function register_invalidation(): void {
		add_action( 'updated_option', static function ( $name ): void {
			if ( in_array( $name, [ 'active_plugins', 'woocommerce_cart_page_id', 'woocommerce_checkout_page_id', 'woocommerce_pickup_location_settings', 'woocommerce_manage_stock' ], true ) ) { self::invalidate(); }
		}, 10, 1 );
		add_action( 'updated_site_option', static function ( $name ): void {
			if ( 'active_sitewide_plugins' === $name ) { update_site_option( 'overseek_delivery_environment_generation', wp_generate_uuid4() ); }
		}, 10, 1 );
		add_action( 'upgrader_process_complete', static function (): void { self::invalidate(); update_site_option( 'overseek_delivery_environment_generation', wp_generate_uuid4() ); }, 10, 0 );
		add_action( 'post_updated', static function ( $id, $after, $before ): void {
			if ( in_array( (int) $id, [ (int) get_option( 'woocommerce_cart_page_id', 0 ), (int) get_option( 'woocommerce_checkout_page_id', 0 ) ], true ) &&
				( $after->post_content !== $before->post_content || $after->post_status !== $before->post_status ) ) { self::invalidate(); }
		}, 10, 3 );
		add_action( 'deleted_post', static function ( $id ): void {
			if ( in_array( (int) $id, [ (int) get_option( 'woocommerce_cart_page_id', 0 ), (int) get_option( 'woocommerce_checkout_page_id', 0 ) ], true ) ) { self::invalidate(); }
		}, 10, 1 );
	}
	private static function invalidate(): void { update_option( 'overseek_delivery_environment_generation', wp_generate_uuid4(), false ); }

	/** Readiness/control only. Classic on older Woo must be explicitly present on both pages. */
	public static function presentation(): string {
		$kinds = [];
		foreach ( [ 'cart', 'checkout' ] as $kind ) {
			$id = function_exists( 'wc_get_page_id' ) ? (int) wc_get_page_id( $kind ) : (int) get_option( 'woocommerce_' . $kind . '_page_id', 0 );
			$content = $id > 0 && 'publish' === get_post_status( $id ) ? get_post_field( 'post_content', $id ) : '';
			$kinds[] = is_string( $content ) && has_block( 'woocommerce/' . $kind, $content ) ? 'blocks'
				: ( is_string( $content ) && has_shortcode( $content, 'woocommerce_' . $kind ) ? 'classic' : 'unknown' );
		}
		return in_array( 'unknown', $kinds, true ) ? 'unknown' : ( in_array( 'blocks', $kinds, true ) ? 'blocks' : 'classic' );
	}

	/** Inspect active plugin names/basenames only during authenticated validation. */
	public static function blockers(): array {
		$blockers = [];
		if ( ! defined( 'WC_VERSION' ) || version_compare( WC_VERSION, '8.0', '<' ) ) { $blockers[] = 'woocommerce_8_required'; }
		if ( 'yes' !== get_option( 'woocommerce_manage_stock', 'yes' ) ) { $blockers[] = 'woocommerce_native_stock_management_required'; }
		try {
			$stock_store = class_exists( 'WC_Data_Store' ) ? WC_Data_Store::load( 'product' ) : null;
			if ( ! is_object( $stock_store ) || 'WC_Data_Store' !== get_class( $stock_store ) || ! is_callable( [ $stock_store, 'get_current_class_name' ] ) || 'WC_Product_Data_Store_CPT' !== $stock_store->get_current_class_name() ) { $blockers[] = 'guarded_receipts_native_stock_store_required'; }
		} catch ( Throwable $error ) { $blockers[] = 'guarded_receipts_native_stock_store_required'; }
		try {
			if ( ! ( new OverSeek_Receipt_Storage() )->native_transactions() ) { $blockers[] = 'transactional_native_stock_storage_required'; }
		} catch ( Throwable $error ) { $blockers[] = 'transactional_native_stock_storage_required'; }
		if ( ! function_exists( 'get_plugins' ) && defined( 'ABSPATH' ) ) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
		$active = array_unique( array_merge( (array) get_option( 'active_plugins', [] ), array_keys( (array) get_site_option( 'active_sitewide_plugins', [] ) ) ) );
		$plugins = get_plugins();
		foreach ( $active as $file ) {
			$header = $plugins[ $file ] ?? [];
			if ( defined( 'OVERSEEK_WC_PLUGIN_FILE' ) && function_exists( 'plugin_basename' ) && $file === plugin_basename( OVERSEEK_WC_PLUGIN_FILE ) ) { continue; }
			$identity = str_replace( [ '-', '_' ], ' ', $file . ' ' . ( $header['Name'] ?? '' ) . ' ' . ( $header['TextDomain'] ?? '' ) );
			if ( preg_match( '~(?:^|/)(?:pi-edd|pi-woocommerce-order-delivery-date|pisol-estimated-delivery-date)(?:[-_][^/]*)?(?:/|\.php$)~i', $file ) || preg_match( '/\b(?:delivery|shipping)\b.{0,60}\b(?:estimated?|estimates|date|dates)\b|\b(?:estimated?|estimates|date|dates)\b.{0,60}\b(?:delivery|shipping)\b/i', $identity ) ) { $blockers[] = 'deactivate_old_delivery_plugin:' . $file; }
		}
		$presentation = self::presentation();
		if ( 'unknown' === $presentation ) { $blockers[] = 'declare_classic_or_supported_blocks_checkout_pages'; }
		if ( 'blocks' === $presentation && ( ! defined( 'WC_VERSION' ) || version_compare( WC_VERSION, '9.9', '<' ) ) ) { $blockers[] = 'blocks_woocommerce_9_9_required'; }
		elseif ( 'classic' === $presentation && ( ! defined( 'WC_VERSION' ) || version_compare( WC_VERSION, '9.7', '<' ) ) ) { $blockers[] = 'classic_woocommerce_9_7_required'; }
		elseif ( 'unknown' !== $presentation ) {
			require_once __DIR__ . '/class-overseek-delivery-session-quotes.php';
			if ( ! OverSeek_Delivery_Session_Quotes::supports_version( WC_VERSION ) ) { $blockers[] = 'woocommerce_quote_cache_version_unsupported'; }
		}
		$pickup = (array) get_option( 'woocommerce_pickup_location_settings', [] );
		if ( 'blocks' === $presentation && in_array( $pickup['enabled'] ?? false, [ true, 'yes' ], true ) ) { $blockers[] = 'blocks_pickup_requires_verified_presentation'; }
		return $blockers;
	}

	public function register_routes(): void {
		register_rest_route( 'overseek/v1', '/delivery-estimates/control', [
			'methods' => 'GET,POST', 'callback' => [ $this, 'handle' ],
			'permission_callback' => [ new OverSeek_Delivery_Input_API(), 'check_permission' ],
		] );
	}

	public function handle( WP_REST_Request $request ) {
		$permission = ( new OverSeek_Delivery_Input_API() )->check_permission( $request );
		if ( true !== $permission ) { return $permission; }
		if ( 'GET' === $request->get_method() ) { return new WP_REST_Response( [ 'schemaVersion' => 1, 'protocolVersion' => 1, 'state' => self::state(), 'blockers' => self::blockers(), 'environmentFingerprint' => self::fingerprint(), 'presentation' => self::presentation(), 'wooVersion' => defined( 'WC_VERSION' ) ? WC_VERSION : null ], 200 ); }
		$storage = new OverSeek_Receipt_Storage();
		try {
			$body = $request->get_json_params();
			if ( strlen( $request->get_body() ) > 65536 || 1 !== ( $body['schemaVersion'] ?? null ) || ! is_int( $body['revision'] ?? null ) || $body['revision'] < 1 || $body['revision'] > 9007199254740991 || ! in_array( $body['action'] ?? null, [ 'baseline', 'guarded', 'activate', 'disable' ], true ) ) { throw new InvalidArgumentException(); }
			$action = $body['action'];
			$owners = $body['owners'] ?? [];
			if ( ! is_array( $owners ) || count( $owners ) > 1001 ) { throw new InvalidArgumentException(); }
			foreach ( $owners as $owner ) { if ( ! is_int( $owner ) || $owner < 1 || $owner > 9007199254740991 ) { throw new InvalidArgumentException(); } }
			if ( ! $storage->lock_owners( array_merge( [ 0 ], $owners ) ) ) { throw new RuntimeException( 'Control busy; retry.' ); }
			$permission = ( new OverSeek_Delivery_Input_API() )->check_permission( $request );
			if ( true !== $permission ) { return $permission; }
			$current = self::state();
			if ( $body['revision'] < $current['revision'] ) { throw new DomainException( 'Control revision superseded.' ); }
			$identity = OverSeek_Receipt_Storage::request_identity( $body );
			if ( $body['revision'] === $current['revision'] ) {
				if ( ( $current['identity'] ?? null ) !== $identity ) { throw new DomainException( 'Control identity conflict.' ); }
				// An activation retry must not report success while coexistence (or
				// another current activation prerequisite) now blocks the storefront.
				if ( 'activate' === $action ) {
					$blockers = self::blockers();
					if ( $blockers ) { throw new DomainException( implode( ', ', $blockers ) ); }
				}
				return new WP_REST_Response( [ 'schemaVersion' => 1, 'revision' => $current['revision'], 'state' => $current ], 200 );
			}
			$epoch = $body['epoch'] ?? null;
			if ( 'disable' !== $action && ( ! is_string( $epoch ) || ! preg_match( '/\A[A-Za-z0-9_-]{1,64}\z/', $epoch ) ) ) { throw new InvalidArgumentException(); }
			$fingerprint = self::fingerprint();
			$blockers = 'disable' === $action ? [] : self::blockers();
			// Baseline/guarded preparation always writes active:false. Keep the old
			// display during private synchronization; activation still requires removal.
			if ( in_array( $action, [ 'baseline', 'guarded' ], true ) ) {
				$blockers = array_values( array_filter( $blockers, static fn( string $blocker ): bool => 0 !== strpos( $blocker, 'deactivate_old_delivery_plugin:' ) ) );
			}
			if ( $blockers ) { throw new DomainException( implode( ', ', $blockers ) ); }
			if ( 'disable' !== $action && $fingerprint !== self::fingerprint() ) { throw new DomainException( 'Environment changed during validation; retry.' ); }
			$next = [ 'epoch' => $current['epoch'], 'mode' => $current['mode'], 'active' => false, 'identity' => $identity ];
			if ( 'baseline' === $action ) {
				if ( $current['epoch'] && $current['epoch'] !== $epoch ) { throw new DomainException( 'Epoch conflict.' ); }
				require_once __DIR__ . '/class-overseek-receipt-write-observer.php';
				require_once __DIR__ . '/class-overseek-receipt-validation.php';
				foreach ( array_unique( $owners ) as $owner_id ) {
					$product = wc_get_product( $owner_id );
					if ( ! $product instanceof WC_Product || $product->get_stock_managed_by_id() !== $owner_id || ! OverSeek_Receipt_Write_Observer::supported( $product ) ) {
						throw new DomainException( 'inventory_native_stock_owner_unsupported:' . $owner_id . ' — update ownership or the custom stock integration before cutover.' );
					}
					if ( $product->managing_stock() && null === OverSeek_Receipt_Validation::quantity( $product->get_stock_quantity( 'edit' ) ) ) {
						throw new DomainException( 'inventory_native_stock_count_unavailable:' . $owner_id . ' — establish an integer Woo stock count before cutover.' );
					}
				}
				$storage->install();
				$storage->baseline( get_option( 'overseek_account_id', '' ), $epoch, $owners );
				$next['epoch'] = $epoch;
				$next['mode'] = 'baseline';
			} elseif ( 'disable' !== $action ) {
				if ( $current['epoch'] !== $epoch || ! in_array( $current['mode'], [ 'baseline', 'guarded' ], true ) ) { throw new DomainException( 'Baseline required.' ); }
				$next['mode'] = 'guarded';
				if ( 'activate' === $action ) {
					$settings = ( new OverSeek_Delivery_Input_Storage() )->read_settings();
					if ( ! $settings || true !== ( $settings['payload']['enabled'] ?? null ) || $settings['revision'] !== ( $body['settingsRevision'] ?? null ) ) { throw new DomainException( 'Settings synchronization required.' ); }
					$next['active'] = true;
					$next['settingsRevision'] = $settings['revision'];
					$next['environmentFingerprint'] = $fingerprint;
					$next['presentation'] = self::presentation();
				}
			}
			$result = ( new OverSeek_Delivery_Input_Storage() )->store( get_option( 'overseek_account_id', '' ), [ 'scope' => 'control', 'entityId' => 0, 'revision' => $body['revision'], 'payload' => $next ] );
			if ( is_wp_error( $result ) ) { return $result; }
			return new WP_REST_Response( [ 'schemaVersion' => 1, 'revision' => $body['revision'], 'state' => self::state() ], 200 );
		} catch ( InvalidArgumentException $error ) { return new WP_Error( 'overseek_control_invalid', 'Invalid launch control.', [ 'status' => 400 ] );
		} catch ( Throwable $error ) { return new WP_Error( 'overseek_control_conflict', $error->getMessage() ?: 'Launch control unavailable.', [ 'status' => 409 ] );
		} finally { $storage->close(); }
	}
}

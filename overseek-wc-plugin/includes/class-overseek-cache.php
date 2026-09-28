<?php
/** Storefront page-cache invalidation and plugin upgrade lifecycle. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Cache {
	private static array $reasons = [];
	private const OPTIONS = [
		'overseek_enable_tracking', 'overseek_track_pageviews', 'overseek_enable_chat',
		'overseek_enable_vitals', 'overseek_vitals_sample_rate', 'overseek_require_consent',
		'overseek_cookie_retention_days', 'overseek_storefront_chat_config',
		'overseek_storefront_pixel_config', 'overseek_storefront_review_config',
		'overseek_reviews_replace_form', 'overseek_reviews_accent_primary',
		'overseek_reviews_accent_secondary', 'overseek_reviews_accent_tertiary',
		'overseek_account_id', 'overseek_api_url',
	];

	public static function register(): void {
		add_action( 'init', [ self::class, 'maybe_upgrade' ], 20 );
		add_action( 'upgrader_process_complete', [ self::class, 'upgraded' ], 10, 2 );
		add_action( 'activated_plugin', [ self::class, 'activation_changed' ] );
		add_action( 'deactivated_plugin', [ self::class, 'activation_changed' ] );
		add_action( 'updated_option', [ self::class, 'option_updated' ], 10, 3 );
		add_action( 'added_option', [ self::class, 'option_added' ], 10, 2 );
		add_action( 'deleted_option', [ self::class, 'option_deleted' ] );
		add_action( 'template_redirect', [ self::class, 'protect_private_pages' ], -100 );
		add_action( 'shutdown', [ self::class, 'purge' ], 999 );
	}

	/** Runs with the NEW code, including ZIP replacements and deployments outside WP's upgrader. */
	public static function maybe_upgrade(): void {
		if ( get_option( 'overseek_cache_version', '' ) === OVERSEEK_WC_VERSION && ! get_option( 'overseek_cache_upgrade_pending', false ) ) {
			return;
		}
		self::refresh_config();
		update_option( 'overseek_cache_version', OVERSEEK_WC_VERSION, false );
		delete_option( 'overseek_cache_upgrade_pending' );
		self::request_purge( 'plugin_version' );
	}

	/** The upgrader may still be executing the OLD plugin code; never record its version here. */
	public static function upgraded( $upgrader, array $options ): void {
		$plugins = (array) ( $options['plugins'] ?? [] );
		if ( isset( $options['plugin'] ) ) { $plugins[] = $options['plugin']; }
		$basename = plugin_basename( OVERSEEK_WC_PLUGIN_FILE );
		$updated = 'update' === ( $options['action'] ?? '' ) && in_array( $basename, $plugins, true );
		// Upload-and-replace can be reported as an install, with no plugin key.
		$replaced = 'install' === ( $options['action'] ?? '' ) && is_object( $upgrader )
			&& dirname( $basename ) === ( $upgrader->result['destination_name'] ?? null );
		if ( 'plugin' === ( $options['type'] ?? '' ) && ( $updated || $replaced ) ) {
			update_option( 'overseek_cache_upgrade_pending', true, false );
			self::request_purge( 'plugin_update' );
		}
	}

	public static function activation_changed( string $plugin ): void {
		if ( plugin_basename( OVERSEEK_WC_PLUGIN_FILE ) === $plugin ) { self::request_purge( 'plugin_activation' ); }
	}

	public static function option_updated( string $name, $old, $value ): void {
		if ( $old === $value || ! in_array( $name, self::OPTIONS, true ) ) { return; }
		if ( in_array( $name, [ 'overseek_account_id', 'overseek_api_url' ], true ) ) {
			self::clear_config_transients( 'overseek_account_id' === $name ? (string) $old : (string) get_option( 'overseek_account_id', '' ) );
			foreach ( [ 'overseek_storefront_pixel_config', 'overseek_storefront_chat_config', 'overseek_storefront_bot_shield_config', 'overseek_storefront_review_config' ] as $key ) { delete_option( $key ); }
			self::refresh_config();
		}
		self::request_purge( 'option:' . $name );
	}

	public static function option_added( string $name, $value ): void { self::option_updated( $name, null, $value ); }
	public static function option_deleted( string $name ): void {
		if ( in_array( $name, self::OPTIONS, true ) ) { self::request_purge( 'option:' . $name ); }
	}

	/** Use the transient API so Redis/Memcached entries are removed too. Preserve retry queues. */
	public static function clear_config_transients( string $account ): void {
		if ( '' === $account ) { return; }
		$pixel_hash = OverSeek_Crypto_Utils::hash_key_fragment( $account, 32 );
		foreach ( [ 'overseek_pixels_' . $pixel_hash, 'overseek_pixels_stale_' . $pixel_hash, 'overseek_pixels_refresh_lock_' . $pixel_hash,
			'overseek_chat_config_' . md5( $account ), 'overseek_chat_config_stale_' . md5( $account ) ] as $key ) { delete_transient( $key ); }
	}

	private static function refresh_config(): void {
		$account = (string) get_option( 'overseek_account_id', '' );
		self::clear_config_transients( $account );
		// Keep last-known-good local payloads available while cron refreshes them.
		update_option( 'overseek_storefront_pixel_config_updated_at', 0, false );
		update_option( 'overseek_storefront_chat_config_updated_at', 0, false );
		if ( '' === $account || '' === (string) get_option( 'overseek_api_url', '' ) ) { return; }
		$hooks = [];
		if ( get_option( 'overseek_enable_tracking' ) ) { $hooks[] = 'overseek_refresh_pixel_config'; }
		if ( get_option( 'overseek_enable_chat' ) ) { $hooks[] = 'overseek_refresh_chat_config'; }
		foreach ( $hooks as $hook ) {
			if ( ! wp_next_scheduled( $hook, [ $account ] ) ) { wp_schedule_single_event( time(), $hook, [ $account ] ); }
		}
	}

	/** Normal WooCommerce cache exclusions still apply at the proxy/CDN layer. */
	public static function protect_private_pages(): void {
		if ( is_user_logged_in() || ( function_exists( 'is_cart' ) && is_cart() ) || ( function_exists( 'is_checkout' ) && is_checkout() ) || ( function_exists( 'is_account_page' ) && is_account_page() ) ) {
			if ( ! defined( 'DONOTCACHEPAGE' ) ) { define( 'DONOTCACHEPAGE', true ); }
			do_action( 'litespeed_control_set_nocache', 'OverSeek private WooCommerce page' );
			nocache_headers();
		}
	}

	public static function request_purge( string $reason ): void {
		$first = ! self::$reasons;
		self::$reasons[$reason] = true;
		if ( $first ) {
			// Send the LSCache tag while response headers are still open. Its generic
			// purge_all API also flushes object/opcode caches, so use page tags only.
			do_action( 'litespeed_purge', '*' );
		}
	}

	/** Coalesce settings writes; purge page HTML, never the site's entire object cache. */
	public static function purge(): void {
		if ( ! self::$reasons ) { return; }
		$reasons = array_keys( self::$reasons );
		self::$reasons = [];
		$callbacks = [
			static function (): void { if ( function_exists( 'rocket_clean_domain' ) ) { rocket_clean_domain(); } },
			static function (): void { if ( function_exists( 'w3tc_flush_posts' ) ) { w3tc_flush_posts(); } },
			static function (): void { if ( function_exists( 'wp_cache_clear_cache' ) ) { wp_cache_clear_cache(); } },
			static function () use ( $reasons ): void { do_action( 'overseek_purge_page_cache', $reasons ); },
		];
		foreach ( $callbacks as $callback ) {
			try { $callback(); } catch ( Throwable $error ) {
				// One failing integration must not prevent the others from invalidating HTML.
				error_log( 'OverSeek page cache purge failed: ' . $error->getMessage() );
			}
		}
	}
}

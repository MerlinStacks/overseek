<?php
/** Cache-safe page-view collection. Only public page context belongs in HTML. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Browser_Views {
	private OverSeek_Server_Tracking $tracker;

	public function __construct( OverSeek_Server_Tracking $tracker ) {
		$this->tracker = $tracker;
		add_action( 'wp_enqueue_scripts', [ $this, 'enqueue' ] );
		add_action( 'wc_ajax_overseek_view', [ $this, 'collect' ] );
	}

	public function enqueue(): void {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || is_cart() || is_checkout() || is_account_page() || is_feed() || is_preview() ) { return; }
		if ( ! is_product() && ! get_option( 'overseek_track_pageviews', '1' ) ) { return; }
		$context = [
			'path' => wp_parse_url( OverSeek_Tracking_Request_Utils::get_sanitized_current_url(), PHP_URL_PATH ) ?: '/',
			'page_type' => is_404() ? '404' : OverSeek_Tracking_Guard_Utils::get_page_type(),
			'product_id' => is_product() ? get_queried_object_id() : 0,
		];
		if ( is_search() ) { $context['searchQuery'] = get_search_query(); }
		if ( is_product_category() ) {
			$term = get_queried_object();
			$context['categoryId'] = $term->term_id;
			$context['categoryName'] = $term->name;
		}
		$json = wp_json_encode( $context );
		$pixel_config = get_option( 'overseek_storefront_pixel_config', [] );
		$requires_consent = empty( $pixel_config['_consent']['autoAccept'] ) && (bool) apply_filters( 'overseek_require_consent', get_option( 'overseek_require_consent', false ) );
		wp_enqueue_script( 'overseek-views', plugins_url( '../assets/js/storefront-views.js', __FILE__ ), [], OVERSEEK_WC_VERSION, true );
		$config = [
			'endpoint' => WC_AJAX::get_endpoint( 'overseek_view' ),
			'context' => $json, 'signature' => self::signature( $json ),
			'productId' => $context['product_id'], 'search' => is_search(),
			'requiresConsent' => $requires_consent,
		];
		// wp_localize_script decodes HTML entities in strings, which can alter signed context.
		wp_add_inline_script( 'overseek-views', 'window.overseekViews=' . wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';', 'before' );
	}

	/** No expiring visitor nonce in cached HTML. The signature authenticates public metadata only. */
	private static function signature( string $context ): string {
		return hash_hmac( 'sha256', get_option( 'overseek_account_id', '' ) . '|' . $context, wp_salt( 'auth' ) );
	}

	public static function same_origin( string $url ): bool {
		$a = wp_parse_url( $url );
		$b = wp_parse_url( home_url() );
		if ( ! is_array( $a ) || ! is_array( $b ) || isset( $a['user'] ) || isset( $a['pass'] ) ) { return false; }
		return strtolower( $a['scheme'] ?? '' ) === strtolower( $b['scheme'] ?? '' )
			&& strtolower( $a['host'] ?? '' ) === strtolower( $b['host'] ?? '' )
			&& ( $a['port'] ?? ( 'https' === ( $a['scheme'] ?? '' ) ? 443 : 80 ) ) === ( $b['port'] ?? ( 'https' === ( $b['scheme'] ?? '' ) ? 443 : 80 ) );
	}

	/** Validate before any visitor cookies or events are created. Public events cannot submit purchases. */
	public static function validate( array $input ): ?array {
		foreach ( [ 'context', 'signature', 'url', 'referrer', 'title', 'eventId' ] as $key ) {
			if ( ! isset( $input[$key] ) || ! is_string( $input[$key] ) || strlen( $input[$key] ) > 4096 ) { return null; }
		}
		if ( ! hash_equals( self::signature( $input['context'] ), $input['signature'] ) || ! preg_match( '/\A[a-zA-Z0-9_-]{16,100}\z/', $input['eventId'] ) ) { return null; }
		if ( ! self::same_origin( $input['url'] ) ) { return null; }
		$context = json_decode( $input['context'], true );
		if ( ! is_array( $context ) || ( $context['path'] ?? '' ) !== ( wp_parse_url( $input['url'], PHP_URL_PATH ) ?: '/' ) ) { return null; }
		return $context;
	}

	public function collect(): void {
		nocache_headers();
		header( 'Cache-Control: private, no-store, max-age=0', true );
		if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || (int) ( $_SERVER['CONTENT_LENGTH'] ?? 0 ) > 16384 ) { wp_send_json( [], 400 ); return; }
		// Same-origin fetch sends Origin; Referrer covers older browsers without it.
		$origin = (string) ( $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '' );
		if ( ! self::same_origin( $origin ) ) { wp_send_json( [], 403 ); return; }
		$input = wp_unslash( $_POST );
		$context = self::validate( $input );
		if ( null === $context ) { wp_send_json( [], 400 ); return; }
		// Full-page hits still visit this endpoint, so stale pixel config can recover
		// in the background even when WordPress never renders catalogue HTML.
		OverSeek_Pixel_Config_Provider::get_config( (string) get_option( 'overseek_api_url', '' ), (string) get_option( 'overseek_account_id', '' ) );
		if ( ! get_option( 'overseek_enable_tracking' ) || OverSeek_Tracking_Guard_Utils::is_bot_request() || ! OverSeek_Tracking_Guard_Utils::has_tracking_consent() ) { wp_send_json( [ 'tracked' => false ] ); return; }
		if ( empty( $context['product_id'] ) && ! get_option( 'overseek_track_pageviews', '1' ) ) { wp_send_json( [ 'tracked' => false ] ); return; }
		$this->tracker->track_browser_view( $context, $input );
		wp_send_json( [ 'tracked' => true ] );
	}
}

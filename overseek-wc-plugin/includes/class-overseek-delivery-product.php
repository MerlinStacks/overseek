<?php
/** Explicit product placements and hard-gated public WC AJAX. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-overseek-delivery-storefront-gate.php';

final class OverSeek_Delivery_Product {
	/** Bootstrap once during plugins_loaded, before init. No automatic placements. */
	public static function register(): void {
		static $registered = false;
		if ( $registered ) {
			return;
		}
		$registered = true;
		add_action( 'init', [ self::class, 'register_placements' ] );
		add_action( 'wc_ajax_overseek_delivery_estimates', [ self::class, 'ajax' ] );
	}

	/** Editor assets belong to the block editor only; frontend assets are lazy. */
	public static function register_placements(): void {
		wp_register_script( 'overseek-delivery-editor', plugins_url( '../blocks/delivery-estimate/editor.js', __FILE__ ), [ 'wp-blocks', 'wp-element', 'wp-i18n', 'wp-block-editor' ], self::asset_version(), true );
		register_block_type( dirname( __DIR__ ) . '/blocks/delivery-estimate', [ 'render_callback' => [ self::class, 'render_block' ] ] );
		add_shortcode( 'overseek_delivery_estimate', [ self::class, 'shortcode' ] );
	}

	/** Product collection context takes precedence over the queried/global product. */
	public static function render_block( array $attributes = [], string $content = '', $block = null ): string {
		if ( ! OverSeek_Delivery_Storefront_Gate::is_active() ) {
			return '';
		}
		$id = $attributes['productId'] ?? $block->context['woocommerce/productId'] ?? $block->context['postId'] ?? get_the_ID();
		return self::placeholder( $id );
	}

	/** Attributes are identity only; no public timing, branding or activation overrides. */
	public static function shortcode( $attributes = [] ): string {
		if ( ! OverSeek_Delivery_Storefront_Gate::is_active() ) {
			return '';
		}
		return self::placeholder( is_array( $attributes ) ? ( $attributes['product_id'] ?? get_the_ID() ) : get_the_ID() );
	}

	/** No personalised content or quantity is embedded in shared page HTML. */
	private static function placeholder( $id ): string {
		if ( ! ( is_int( $id ) || is_string( $id ) ) || ! preg_match( '/\A[1-9][0-9]{0,9}\z/', (string) $id ) || (int) $id > 2147483647 ) {
			return '';
		}
		wp_enqueue_style( 'overseek-delivery', plugins_url( '../assets/css/delivery-estimate.css', __FILE__ ), [], self::asset_version() );
		wp_enqueue_script( 'overseek-delivery', plugins_url( '../assets/js/delivery-estimate.js', __FILE__ ), [], self::asset_version(), true );
		wp_localize_script( 'overseek-delivery', 'overseekDelivery', [ 'url' => WC_AJAX::get_endpoint( 'overseek_delivery_estimates' ) ] );
		return '<span class="os-delivery-placeholder" data-product-id="' . esc_attr( (string) $id ) . '" data-request-id="' . esc_attr( wp_unique_id( 'os-delivery-' ) ) . '" aria-live="polite"></span>';
	}

	/** Plugin release cache busting, with a standalone test fallback only. */
	private static function asset_version(): string {
		return defined( 'OVERSEEK_WC_VERSION' ) ? (string) OVERSEEK_WC_VERSION : '0';
	}

	/** Gate before parsing input, Woo access, assets, settings or product lookups. */
	public static function ajax(): void {
		$active = OverSeek_Delivery_Storefront_Gate::is_active();
		nocache_headers();
		header( 'Cache-Control: private, no-store, max-age=0', true );
		if ( ! $active ) {
			wp_send_json( [ 'items' => [] ] );
			return;
		}
		if ( 'POST' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || (int) ( $_SERVER['CONTENT_LENGTH'] ?? 0 ) > 16384 ) {
			wp_send_json( [ 'items' => [] ], 400 );
			return;
		}
		if ( false !== strpos( $_SERVER['CONTENT_TYPE'] ?? '', 'application/json' ) ) {
			$body = file_get_contents( 'php://input', false, null, 0, 16385 );
			$input = is_string( $body ) && strlen( $body ) <= 16384 ? json_decode( $body, true, 8 ) : null;
			$items = is_array( $input ) ? ( $input['items'] ?? null ) : null;
		} else {
			$items = isset( $_POST['items'] ) ? wp_unslash( $_POST['items'] ) : null;
		}
		require_once __DIR__ . '/class-overseek-delivery-product-service.php';
		wp_send_json( [ 'items' => ( new OverSeek_Delivery_Product_Service() )->batch( $items ) ] );
	}
}

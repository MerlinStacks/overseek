<?php
/**
 * Main Plugin Class
 *
 * @package OverSeek
 * @since   1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Class OverSeek_Main
 *
 * The core plugin class responsible for loading dependencies and defining hooks.
 *
 * @since 1.0.0
 */
class OverSeek_Main
{
	private const HIDDEN_ORDER_ITEM_META_KEYS = [
		'estimate_details',
		'pi_item_estimate_msg',
		'pi_item_max_date',
		'pi_item_max_days',
		'pi_item_min_date',
		'pi_item_min_days',
	];

	/**
	 * Initialize the plugin classes.
	 */
	public function __construct()
	{
		$this->load_dependencies();
		$this->init_hooks();
	}

	/**
	 * Load the required dependencies for this plugin.
	 *
	 * @return void
	 */
	private function load_dependencies(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-crypto-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-http-utils.php';
	}

	/**
	 * Initialize hooks for Admin and Frontend.
	 *
	 * @return void
	 */
	private function init_hooks(): void
	{
		$this->cleanup_legacy_options();
		add_filter('woocommerce_order_item_get_formatted_meta_data', [$this, 'filter_formatted_order_item_meta'], 20, 2);
		add_filter('woocommerce_hidden_order_itemmeta', [$this, 'filter_hidden_order_item_meta_keys']);

		$is_frontend_request = ! is_admin() && ! wp_doing_ajax() && ! wp_doing_cron();
		$is_configured       = $this->is_configured();
		$tracking_enabled    = (bool) get_option('overseek_enable_tracking');
		$bot_shield_enabled  = (bool) get_option('overseek_enable_bot_shield');

		// Initialize Admin.
		if (is_admin()) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-crawler-guard.php';
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-admin.php';

			$admin = new OverSeek_Admin();
			add_action('admin_menu', [$admin, 'add_menu_page']);
			add_action('admin_init', [$admin, 'register_settings']);
			add_action('admin_enqueue_scripts', [$admin, 'enqueue_assets']);
			add_action('admin_post_overseek_sync_blocked_agents', [$admin, 'handle_sync_blocked_agents']);
			add_action('admin_post_overseek_test_bot_shield', [$admin, 'handle_test_bot_shield']);
		}

		// Initialize Frontend.
		if ($is_configured && (get_option('overseek_enable_chat') || wp_doing_cron())) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-frontend.php';

			$frontend = new OverSeek_Frontend();
			if (get_option('overseek_enable_chat') && $is_frontend_request) {
				add_action('wp_head', [$frontend, 'print_scripts']);
			}
		}

		// Initialize API.
		add_action('rest_api_init', function (): void {
			$this->load_api_dependencies();
			$api = new OverSeek_API();
			$api->register_routes();
		});
		add_filter('woocommerce_rest_prepare_product_review', function ($response, $review, $request) {
			$this->load_api_dependencies();
			$api = new OverSeek_API();
			return $api->append_review_rest_fields($response, $review, $request);
		}, 10, 3);

		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-order-invoices.php';
		new OverSeek_Order_Invoices();

		if ((! is_admin() || wp_doing_ajax()) && ! wp_doing_cron()) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-cart-recovery.php';
			new OverSeek_Cart_Recovery();
		}

		$this->register_reviews();
		$this->register_preference_center();
		$this->register_google_product_review_feed();

		// Initialize Server-Side Tracking (runs on WooCommerce hooks).
		if ($is_configured && $tracking_enabled) {
			$this->load_tracking_dependencies();
			new OverSeek_Server_Tracking();
		}

		// Initialize Client-Side Pixel Tracking (fetches config from API).
		if ($is_configured && $tracking_enabled && ($is_frontend_request || wp_doing_cron())) {
			$this->load_pixel_dependencies();
			new OverSeek_Pixels();
		}

		// Initialize Crawler Guard (blocks blacklisted bots at application level).
		if ($is_configured && $bot_shield_enabled && ($is_frontend_request || wp_doing_cron())) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-crawler-guard.php';
			new OverSeek_Crawler_Guard();
		}

		// Initialize Fingerprint Bot Detection (checkout-only, behavioral scoring).
		if ($is_configured && $bot_shield_enabled && ($is_frontend_request || wp_doing_ajax() || $this->is_rest_request() || wp_doing_cron())) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-fingerprint-utils.php';
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-fingerprint.php';
			new OverSeek_Fingerprint();
		}

		// Initialize Web Vitals Collector.
		// Not gated by tracking toggle — performance data is independent of behavioural analytics.
		if ($is_configured && $is_frontend_request && get_option('overseek_enable_vitals')) {
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-guard-utils.php';
			require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-web-vitals.php';
			new OverSeek_Web_Vitals();
		}
	}

	private function is_configured(): bool
	{
		return '' !== (string) get_option('overseek_api_url', '') && '' !== (string) get_option('overseek_account_id', '');
	}

	/**
	 * Hide delivery-estimate plugin internals from order emails and invoices.
	 *
	 * @param array<int|string, object> $formatted_meta Formatted order item meta.
	 * @return array<int|string, object>
	 */
	public function filter_formatted_order_item_meta(array $formatted_meta): array
	{
		foreach ($formatted_meta as $index => $meta) {
			if ($this->should_hide_order_item_meta($meta)) {
				unset($formatted_meta[$index]);
			}
		}

		return $formatted_meta;
	}

	/**
	 * Hide known technical order item meta keys in admin/order meta displays.
	 *
	 * @param array<int, string> $hidden_meta_keys Existing hidden meta keys.
	 * @return array<int, string>
	 */
	public function filter_hidden_order_item_meta_keys(array $hidden_meta_keys): array
	{
		return array_values(array_unique(array_merge($hidden_meta_keys, self::HIDDEN_ORDER_ITEM_META_KEYS)));
	}

	private function should_hide_order_item_meta(object $meta): bool
	{
		$key = isset($meta->key) ? $this->normalize_meta_key((string) $meta->key) : '';
		$display_key = isset($meta->display_key) ? $this->normalize_meta_key(wp_strip_all_tags((string) $meta->display_key)) : '';

		foreach ([$key, $display_key] as $candidate) {
			if ($candidate === '') {
				continue;
			}

			if (in_array($candidate, self::HIDDEN_ORDER_ITEM_META_KEYS, true)) {
				return true;
			}

			if (str_starts_with($candidate, 'pi_item_')) {
				return true;
			}
		}

		return false;
	}

	private function normalize_meta_key(string $key): string
	{
		return str_replace(' ', '_', strtolower(trim($key)));
	}

	private function is_rest_request(): bool
	{
		return defined('REST_REQUEST') && REST_REQUEST;
	}

	private function register_reviews(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-review-renderer.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-reviews.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-review-form.php';

		new OverSeek_Reviews();
		new OverSeek_Review_Form();
	}

	private function register_preference_center(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center-state.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center-request.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center.php';

		new OverSeek_Preference_Center();
	}

	private function register_google_product_review_feed(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-google-product-review-feed.php';

		new OverSeek_Google_Product_Review_Feed();
	}

	private function load_api_dependencies(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-order-invoices.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-api.php';
	}

	private function load_pixel_dependencies(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-config-provider.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-matching-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-ecommerce-events.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-payload-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixels.php';
	}

	private function load_tracking_dependencies(): void
	{
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-config-provider.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-matching-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-request-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-attribution-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-guard-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-transport.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-payload-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-event-builder.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-server-tracking.php';
	}

	private function cleanup_legacy_options(): void
	{
		if ( get_option( 'overseek_email_relay_profiles', null ) !== null ) {
			delete_option( 'overseek_email_relay_profiles' );
		}

		if ( get_option( 'overseek_email_relay_default_profile', null ) !== null ) {
			delete_option( 'overseek_email_relay_default_profile' );
		}
	}
}

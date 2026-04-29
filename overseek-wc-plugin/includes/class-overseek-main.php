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
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-admin.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-frontend.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-api.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-crypto-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-http-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-config-provider.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-matching-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixel-ecommerce-events.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-cart-recovery.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center-state.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-preference-center-request.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-request-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-attribution-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-guard-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-transport.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-payload-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-event-builder.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-server-tracking.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-pixels.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-crawler-guard.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-fingerprint-utils.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-fingerprint.php';
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-web-vitals.php';
	}

	/**
	 * Initialize hooks for Admin and Frontend.
	 *
	 * @return void
	 */
	private function init_hooks(): void
	{
		// Initialize Admin.
		$admin = new OverSeek_Admin();
		add_action('admin_menu', [$admin, 'add_menu_page']);
		add_action('admin_init', [$admin, 'register_settings']);
		add_action('admin_enqueue_scripts', [$admin, 'enqueue_assets']);

		// Initialize Frontend.
		$frontend = new OverSeek_Frontend();
		add_action('wp_head', [$frontend, 'print_scripts']);

		// Initialize API.
		$api = new OverSeek_API();
		add_action('rest_api_init', [$api, 'register_routes']);

		new OverSeek_Cart_Recovery();
		new OverSeek_Preference_Center();

		// Initialize Server-Side Tracking (runs on WooCommerce hooks).
		if (get_option('overseek_enable_tracking')) {
			new OverSeek_Server_Tracking();
		}

		// Initialize Client-Side Pixel Tracking (fetches config from API).
		new OverSeek_Pixels();

		// Initialize Crawler Guard (blocks blacklisted bots at application level).
		// Not gated by tracking toggle — admins may want bot blocking without analytics.
		new OverSeek_Crawler_Guard();

		// Initialize Fingerprint Bot Detection (checkout-only, behavioral scoring).
		// Not gated by tracking toggle — bot protection is independent of analytics.
		new OverSeek_Fingerprint();

		// Initialize Web Vitals Collector.
		// Not gated by tracking toggle — performance data is independent of behavioural analytics.
		new OverSeek_Web_Vitals();
	}
}


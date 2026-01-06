<?php

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Class OverSeek_Main
 * 
 * The core plugin class responsible for loading dependencies and defining hooks.
 */
class OverSeek_Main
{

	/**
	 * Loader for admin hooks.
	 *
	 * @var OverSeek_Admin
	 */
	protected $admin;

	/**
	 * Loader for frontend hooks.
	 *
	 * @var OverSeek_Frontend
	 */
	protected $frontend;

	/**
	 * Initialize the plugin classes.
	 */
	public function __construct()
	{
		$this->load_dependencies();
		$this->init_hooks();
		$this->declare_compatibility();
	}

	/**
	 * Load the required dependencies for this plugin.
	 */
	private function load_dependencies()
	{
		// Load Admin Class
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-admin.php';

		// Load Frontend Class
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-frontend.php';

		// Load API Class
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-api.php';

		// Load Server-Side Tracking Class (unblockable)
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-server-tracking.php';
	}

	/**
	 * Initialize hooks for Admin and Frontend.
	 */
	private function init_hooks()
	{
		// Initialize Admin
		$this->admin = new OverSeek_Admin();
		add_action('admin_menu', array($this->admin, 'add_menu_page'));
		add_action('admin_init', array($this->admin, 'register_settings'));

		// Initialize Frontend
		$this->frontend = new OverSeek_Frontend();
		add_action('wp_head', array($this->frontend, 'print_scripts'));

		// Initialize API
		$api = new OverSeek_API();
		add_action('rest_api_init', array($api, 'register_routes'));

		// Initialize Server-Side Tracking (runs on WooCommerce hooks)
		if (get_option('overseek_enable_tracking')) {
			new OverSeek_Server_Tracking();
		}
	}

	/**
	 * Declare Compatibility with HPOS
	 */
	private function declare_compatibility()
	{
		add_action('before_woocommerce_init', function () {
			if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
				\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', OVERSEEK_WC_PLUGIN_DIR . 'overseek-integration.php', true);
			}
		});
	}

	/**
	 * Run the plugin.
	 */
	public function run()
	{
		// Any post-initialization logic can go here.
	}
}

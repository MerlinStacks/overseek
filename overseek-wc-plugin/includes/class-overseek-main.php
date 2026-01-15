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
	 * Admin handler instance.
	 *
	 * @var OverSeek_Admin
	 */
	protected OverSeek_Admin $admin;

	/**
	 * Frontend handler instance.
	 *
	 * @var OverSeek_Frontend
	 */
	protected OverSeek_Frontend $frontend;

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
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-server-tracking.php';
	}

	/**
	 * Initialize hooks for Admin and Frontend.
	 *
	 * @return void
	 */
	private function init_hooks(): void
	{
		// Initialize Admin.
		$this->admin = new OverSeek_Admin();
		add_action('admin_menu', [$this->admin, 'add_menu_page']);
		add_action('admin_init', [$this->admin, 'register_settings']);

		// Initialize Frontend.
		$this->frontend = new OverSeek_Frontend();
		add_action('wp_head', [$this->frontend, 'print_scripts']);

		// Initialize API.
		$api = new OverSeek_API();
		add_action('rest_api_init', [$api, 'register_routes']);

		// Initialize Server-Side Tracking (runs on WooCommerce hooks).
		if (get_option('overseek_enable_tracking')) {
			new OverSeek_Server_Tracking();
		}
	}

	/**
	 * Run the plugin.
	 *
	 * @return void
	 */
	public function run(): void
	{
		// Post-initialization logic can go here.
	}
}


<?php
/**
 * Plugin Name: OverSeek Integration for WooCommerce
 * Plugin URI:  https://github.com/MerlinStacks/overseek
 * Description: Connects your WooCommerce store to your self-hosted OverSeek server. Server-side tracking, live chat, and full data sync. Requires OverSeek server.
 * Version:     2.7.1
 * Author:      OverSeek Contributors
 * Author URI:  https://github.com/MerlinStacks/overseek
 * Text Domain: overseek-wc
 * Domain Path: /languages
 * WC requires at least: 7.0
 * WC tested up to: 9.5
 * Requires PHP: 8.1
 * Requires at least: 6.4
 * Requires Plugins: woocommerce
 *
 * @package OverSeek
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

// Define plugin constants.
define('OVERSEEK_WC_VERSION', '2.7.1');
define('OVERSEEK_WC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('OVERSEEK_WC_PLUGIN_URL', plugin_dir_url(__FILE__));
define('OVERSEEK_WC_PLUGIN_FILE', __FILE__);

/**
 * Declare WooCommerce feature compatibility.
 * Covers HPOS, Blocks, Remote Logging, and Product Editor.
 *
 * @since 2.0.0
 */
add_action('before_woocommerce_init', static function (): void {
	if (!class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
		return;
	}

	$features = [
		'custom_order_tables',    // HPOS - High-Performance Order Storage
		'cart_checkout_blocks',   // Cart & Checkout Blocks
		'remote_logging',         // Remote Logging (WC 9.2+)
		'product_block_editor',   // Product Block Editor
	];

	foreach ($features as $feature) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
			$feature,
			__FILE__,
			true
		);
	}
});

/**
 * Clean up transients on deactivation.
 *
 * Removes cached pixel config, chat config, and failed event queue so they
 * don't sit in wp_options while the plugin is inactive. Options are preserved
 * so the user doesn't lose their configuration — full cleanup happens in
 * uninstall.php on deletion.
 *
 * @since 2.7.1
 */
function overseek_wc_deactivate(): void
{
	delete_transient('_overseek_failed_events');

	// Dynamic transients keyed by account ID hash.
	global $wpdb;
	$wpdb->query(
		"DELETE FROM {$wpdb->options}
		 WHERE option_name LIKE '_transient_overseek_pixels_%'
		    OR option_name LIKE '_transient_timeout_overseek_pixels_%'
		    OR option_name LIKE '_transient_overseek_chat_config_%'
		    OR option_name LIKE '_transient_timeout_overseek_chat_config_%'"
	);
}
register_deactivation_hook(__FILE__, 'overseek_wc_deactivate');

/**
 * Main Plugin Class Initialization.
 *
 * @since 1.0.0
 */
function overseek_wc_init(): void
{
	// Abort if WooCommerce is not active to prevent fatal errors.
	if (!class_exists('WooCommerce')) {
		add_action('admin_notices', 'overseek_wc_missing_woocommerce_notice');
		return;
	}

	if (!class_exists('OverSeek_Main')) {
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-main.php';
	}

	// Initialize the main plugin class.
	$overseek_plugin = new OverSeek_Main();
	$overseek_plugin->run();
}
add_action('plugins_loaded', 'overseek_wc_init');

/**
 * Admin notice displayed when WooCommerce is not active.
 *
 * @since 1.0.0
 */
function overseek_wc_missing_woocommerce_notice(): void
{
	?>
	<div class="notice notice-error">
		<p><strong>OverSeek Integration</strong> requires WooCommerce to be installed and active.</p>
	</div>
	<?php
}

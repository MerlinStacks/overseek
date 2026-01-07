<?php
/**
 * Plugin Name: OverSeek Integration for WooCommerce
 * Plugin URI:  https://overseek.io
 * Description: Seamlessly integrates OverSeek analytics and live chat with your WooCommerce store.
 * Version:     1.1.0
 * Author:      OverSeek
 * Author URI:  https://overseek.io
 * Text Domain: overseek-wc
 * Domain Path: /languages
 * WC requires at least: 5.0
 * WC tested up to: 9.0
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Define plugin constants.
define( 'OVERSEEK_WC_VERSION', '1.1.0' );
define( 'OVERSEEK_WC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OVERSEEK_WC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * Declare HPOS (High-Performance Order Storage) compatibility.
 * Required for WooCommerce 8.2+ to avoid admin warnings.
 */
add_action( 'before_woocommerce_init', function() {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );

/**
 * Main Plugin Class Initialization
 */
function overseek_wc_init() {
	// Abort if WooCommerce is not active to prevent fatal errors
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', 'overseek_wc_missing_woocommerce_notice' );
		return;
	}

	if ( ! class_exists( 'OverSeek_Main' ) ) {
		require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-main.php';
	}
	
	// Initialize the main plugin class.
	$overseek_plugin = new OverSeek_Main();
	$overseek_plugin->run();
}
add_action( 'plugins_loaded', 'overseek_wc_init' );

/**
 * Admin notice displayed when WooCommerce is not active.
 */
function overseek_wc_missing_woocommerce_notice() {
	?>
	<div class="notice notice-error">
		<p><strong>OverSeek Integration</strong> requires WooCommerce to be installed and active.</p>
	</div>
	<?php
}

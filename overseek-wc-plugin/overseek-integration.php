<?php
/**
 * Plugin Name: OverSeek Integration for WooCommerce
 * Plugin URI:  https://overseek.io
 * Description: Seamlessly integrates OverSeek analytics and live chat with your WooCommerce store. Server-side tracking, HPOS compatible.
 * Version:     2.2.0
 * Author:      OverSeek
 * Author URI:  https://overseek.io
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

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Define plugin constants.
define( 'OVERSEEK_WC_VERSION', '2.2.0' );
define( 'OVERSEEK_WC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'OVERSEEK_WC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'OVERSEEK_WC_PLUGIN_FILE', __FILE__ );

/**
 * Declare WooCommerce feature compatibility.
 * Covers HPOS, Blocks, Remote Logging, and Product Editor.
 *
 * @since 2.0.0
 */
add_action( 'before_woocommerce_init', static function(): void {
	if ( ! class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		return;
	}

	$features = [
		'custom_order_tables',    // HPOS - High-Performance Order Storage
		'cart_checkout_blocks',   // Cart & Checkout Blocks
		'remote_logging',         // Remote Logging (WC 9.2+)
		'product_block_editor',   // Product Block Editor
	];

	foreach ( $features as $feature ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
			$feature,
			__FILE__,
			true
		);
	}
} );

/**
 * Main Plugin Class Initialization.
 *
 * @since 1.0.0
 */
function overseek_wc_init(): void {
	// Abort if WooCommerce is not active to prevent fatal errors.
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
 *
 * @since 1.0.0
 */
function overseek_wc_missing_woocommerce_notice(): void {
	?>
	<div class="notice notice-error">
		<p><strong>OverSeek Integration</strong> requires WooCommerce to be installed and active.</p>
	</div>
	<?php
}

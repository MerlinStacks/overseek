<?php
/**
 * In-place package upgrade regression. Run with seed before replacing the plugin,
 * then verify in a fresh WP-CLI process so the new plugin actually boots.
 *
 * @package OverSeek
 */
declare(strict_types=1);

if ( ! defined( 'WP_CLI' ) || true !== WP_CLI || 'cli' !== PHP_SAPI || '1' !== getenv( 'OVERSEEK_RUN_DISPOSABLE_DB_TESTS' ) || ! defined( 'DB_NAME' ) || 'wordpress_tests' !== DB_NAME || 'local' !== wp_get_environment_type() ) {
	throw new RuntimeException( 'Requires WP-CLI and the explicitly enabled, local wordpress_tests database.' );
}
global $wpdb;
if ( 'wordpress_tests' !== $wpdb->get_var( 'SELECT DATABASE()' ) || ! class_exists( 'WooCommerce' ) || ! class_exists( 'OverSeek_Main' ) ) {
	throw new RuntimeException( 'Requires the disposable database and active WooCommerce/OverSeek.' );
}
$key = 'overseek_ci_upgrade_snapshot';
$mode = $args[0] ?? '';
if ( 'seed' === $mode ) {
	if ( get_option( $key ) ) {
		throw new RuntimeException( 'Upgrade fixture already exists.' );
	}
	$product = new WC_Product_Simple();
	$product->set_name( 'Upgrade preservation fixture' );
	$product->set_manage_stock( true );
	$product->set_stock_quantity( 17 );
	$product->save();
	$order = wc_create_order();
	$order->update_meta_data( '_overseek_tracked', 'yes' );
	$order->update_meta_data( '_overseek_event_id', 'upgrade-existing-event' );
	$order->save();
	$options = [
		'overseek_account_id' => 'upgrade-existing-account',
		'overseek_api_url' => 'https://overseek-ci.invalid',
		'overseek_enable_tracking' => '1',
		'overseek_enable_chat' => '0',
		'overseek_enable_bot_shield' => '0',
	];
	foreach ( $options as $name => $value ) {
		update_option( $name, $value );
	}
	$auto_updates = [ 'woocommerce/woocommerce.php', 'overseek-wc-plugin/overseek-integration.php' ];
	update_site_option( 'auto_update_plugins', $auto_updates );
	update_option( $key, [ 'version' => OVERSEEK_WC_VERSION, 'options' => $options, 'auto_updates' => $auto_updates,
		'product_id' => $product->get_id(), 'order_id' => $order->get_id() ] );
	echo "Seeded existing installation upgrade fixture.\n";
} elseif ( 'verify' === $mode ) {
	$fixture = get_option( $key );
	if ( ! is_array( $fixture ) || ! version_compare( OVERSEEK_WC_VERSION, $fixture['version'], '>' ) ) {
		throw new RuntimeException( 'Expected a newer plugin to boot over the existing installation.' );
	}
	foreach ( $fixture['options'] as $name => $value ) {
		if ( get_option( $name ) !== $value ) {
			throw new RuntimeException( 'Upgrade changed setting: ' . $name );
		}
	}
	if ( get_site_option( 'auto_update_plugins' ) !== $fixture['auto_updates'] || ! in_array( 'overseek-wc-plugin/overseek-integration.php', get_option( 'active_plugins' ), true ) ) {
		throw new RuntimeException( 'Upgrade changed activation or automatic-update preferences.' );
	}
	$product = wc_get_product( $fixture['product_id'] );
	$order = wc_get_order( $fixture['order_id'] );
	if ( ! $product || 17 !== $product->get_stock_quantity() || ! $order || 'yes' !== $order->get_meta( '_overseek_tracked' ) || 'upgrade-existing-event' !== $order->get_meta( '_overseek_event_id' ) ) {
		throw new RuntimeException( 'Upgrade changed stock or existing order tracking metadata.' );
	}
	$product->delete( true );
	$order->delete( true );
	delete_option( $key );
	echo "In-place upgrade preserved settings, activation, automatic updates, stock and purchase metadata.\n";
} else {
	throw new RuntimeException( 'Expected seed or verify.' );
}

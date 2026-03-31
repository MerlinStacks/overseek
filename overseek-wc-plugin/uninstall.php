<?php
/**
 * OverSeek Integration for WooCommerce — Uninstall
 *
 * Fired when the plugin is deleted via the WordPress admin.
 * Removes all options, transients, and order meta created by the plugin.
 *
 * Note: This file is called by WordPress core, not by the plugin itself.
 * It only runs on full deletion (not deactivation) to preserve config
 * if the user is temporarily disabling the plugin.
 *
 * @package OverSeek
 */

// Abort if not called by WordPress uninstall.
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// ─── Options ────────────────────────────────────────────────────────────────
// All wp_options rows created by the plugin.
$options = array(
    'overseek_api_url',
    'overseek_account_id',
    'overseek_connection_config',
    'overseek_enable_tracking',
    'overseek_enable_chat',
    'overseek_require_consent',
    'overseek_cookie_retention_days',
    'overseek_relay_api_key',
);

foreach ($options as $option) {
    delete_option($option);
}

// ─── Transients ─────────────────────────────────────────────────────────────
// Static transient key used for failed event retry queue.
delete_transient('_overseek_failed_events');

// Dynamic transients keyed by account ID hash. We can't know the exact hash,
// so query wp_options for any matching transient rows.
global $wpdb;
$wpdb->query(
    "DELETE FROM {$wpdb->options}
     WHERE option_name LIKE '_transient_overseek_pixels_%'
        OR option_name LIKE '_transient_timeout_overseek_pixels_%'
        OR option_name LIKE '_transient_overseek_chat_config_%'
        OR option_name LIKE '_transient_timeout_overseek_chat_config_%'"
);

// ─── Order Meta ─────────────────────────────────────────────────────────────
// Remove deduplication flags and event IDs stored on WooCommerce orders.
// Uses the WC HPOS meta table if available, falls back to postmeta.
if (class_exists('Automattic\WooCommerce\Utilities\OrderUtil')
    && Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_enabled()
) {
    // HPOS: meta stored in wc_orders_meta
    $orders_meta_table = $wpdb->prefix . 'wc_orders_meta';
    if ($wpdb->get_var("SHOW TABLES LIKE '{$orders_meta_table}'") === $orders_meta_table) {
        $wpdb->query(
            "DELETE FROM {$orders_meta_table}
             WHERE meta_key IN ('_overseek_tracked', '_overseek_pixel_tracked', '_overseek_event_id')"
        );
    }
} else {
    // Legacy: meta stored in postmeta
    $wpdb->query(
        "DELETE FROM {$wpdb->postmeta}
         WHERE meta_key IN ('_overseek_tracked', '_overseek_pixel_tracked', '_overseek_event_id')"
    );
}

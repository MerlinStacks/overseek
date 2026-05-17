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

/**
 * Recursively remove a directory and its contents.
 */
function overseek_uninstall_remove_dir(string $dir): void
{
    if ($dir === '' || !is_dir($dir)) {
        return;
    }

    $items = scandir($dir);
    if (!is_array($items)) {
        return;
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }

        $path = trailingslashit($dir) . $item;
        if (is_dir($path)) {
            overseek_uninstall_remove_dir($path);
            continue;
        }

        if (file_exists($path)) {
            wp_delete_file($path);
        }
    }

    @rmdir($dir);
}

// ─── Options ────────────────────────────────────────────────────────────────
// All wp_options rows created by the plugin.
$options = array(
    'overseek_api_url',
    'overseek_account_id',
    'overseek_connection_config',
    'overseek_enable_tracking',
    'overseek_enable_chat',
    'overseek_enable_vitals',
    'overseek_vitals_sample_rate',
    'overseek_require_consent',
    'overseek_cookie_retention_days',
    'overseek_relay_api_key',
    'overseek_webhook_auth_token',
    'overseek_enable_processing_invoice_sync',
    'overseek_invoice_retention_days',
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
        OR option_name LIKE '_transient_timeout_overseek_chat_config_%'
        OR option_name LIKE '_transient__os_fp_nonce_%'
        OR option_name LIKE '_transient_timeout__os_fp_nonce_%'"
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
             WHERE meta_key IN ('_overseek_tracked', '_overseek_pixel_tracked', '_overseek_event_id', '_overseek_invoice_private_path', '_overseek_invoice_file_name', '_overseek_invoice_ref', '_overseek_invoice_generated_at', '_overseek_invoice_status', '_overseek_invoice_error', '_overseek_invoice_renderer', '_overseek_invoice_diagnostic_reason', '_overseek_invoice_retry_count')"
        );
    }
} else {
    // Legacy: meta stored in postmeta
    $wpdb->query(
        "DELETE FROM {$wpdb->postmeta}
         WHERE meta_key IN ('_overseek_tracked', '_overseek_pixel_tracked', '_overseek_event_id', '_overseek_invoice_private_path', '_overseek_invoice_file_name', '_overseek_invoice_ref', '_overseek_invoice_generated_at', '_overseek_invoice_status', '_overseek_invoice_error', '_overseek_invoice_renderer', '_overseek_invoice_diagnostic_reason', '_overseek_invoice_retry_count')"
    );
}

// Remove retained private invoice files created by this plugin.
$uploads = wp_upload_dir();
$basedir = isset($uploads['basedir']) ? (string) $uploads['basedir'] : '';
if ($basedir !== '') {
    $invoice_dir = trailingslashit($basedir) . 'overseek-private/invoices';
    overseek_uninstall_remove_dir($invoice_dir);

    $parent_dir = trailingslashit($basedir) . 'overseek-private';
    if (is_dir($parent_dir)) {
        $remaining = scandir($parent_dir);
        if (is_array($remaining) && count($remaining) <= 2) {
            @rmdir($parent_dir);
        }
    }
}

<?php

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Class OverSeek_Frontend
 *
 * Handles frontend script injection based on settings.
 * 
 * NOTE: Analytics tracking is now 100% server-side via class-overseek-server-tracking.php
 * This class only handles the optional Live Chat widget.
 */
class OverSeek_Frontend
{

	/**
	 * Print scripts to the head if enabled.
	 * Only outputs chat widget - analytics is handled server-side.
	 */
	public function print_scripts()
	{
		$chat_enabled = get_option('overseek_enable_chat');
		$api_url = get_option('overseek_api_url', 'https://api.overseek.com');
		$account_id = get_option('overseek_account_id');

		// Remove trailing slash from API URL if present
		$api_url = untrailingslashit($api_url);

		// Analytics tracking is now 100% server-side - no JavaScript needed
		// See class-overseek-server-tracking.php for server-side tracking

		if ($chat_enabled && !empty($account_id)) {
			echo "<!-- OverSeek Live Chat Widget Start -->\n";
			echo "<script src='" . esc_url($api_url) . "/api/chat/widget.js?id=" . esc_js($account_id) . "' defer></script>\n";
			echo "<!-- OverSeek Live Chat Widget End -->\n";
		}
	}
}

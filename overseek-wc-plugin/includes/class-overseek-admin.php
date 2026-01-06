<?php

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Class OverSeek_Admin
 *
 * Handles the admin settings page and menu registration.
 */
class OverSeek_Admin
{

	/**
	 * Register the OverSeek submenu under WooCommerce.
	 */
	public function add_menu_page()
	{
		add_submenu_page(
			'woocommerce',           // Parent slug
			'OverSeek Settings',     // Page title
			'OverSeek',              // Menu title
			'manage_options',        // Capability
			'overseek',              // Menu slug
			array($this, 'render_settings_page') // Callback
		);
	}

	/**
	 * Register plugin settings with sanitization callback.
	 */
	public function register_settings()
	{
		// We register a dummy "config" field that parses into the real options
		register_setting('overseek_options_group', 'overseek_connection_config', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_connection_config'),
		));


		register_setting('overseek_options_group', 'overseek_enable_tracking');
		register_setting('overseek_options_group', 'overseek_enable_chat');
	}

	/**
	 * Sanitize and parse the JSON config.
	 *
	 * @param string $input JSON string.
	 * @return string Original input if invalid, or empty string if parsed successfully (to keep the field clean, or keep it for reference).
	 */
	public function sanitize_connection_config($input)
	{
		if (empty($input)) {
			return '';
		}

		// Try to decode JSON
		$data = json_decode(stripslashes($input), true);

		if (json_last_error() === JSON_ERROR_NONE && isset($data['apiUrl']) && isset($data['accountId'])) {
			// Update the real options
			update_option('overseek_api_url', esc_url_raw($data['apiUrl']));
			update_option('overseek_account_id', sanitize_text_field($data['accountId']));

			// Return input to show in the box, or clear it to indicate success? 
			// Let's keep it so they can see what they pasted.
			return $input;
		} else {
			add_settings_error('overseek_connection_config', 'invalid_json', 'Invalid Configuration JSON. Please copy exactly from Overseek Dashboard.');
			return $input;
		}
	}

	/**
	 * Render the settings page HTML.
	 */
	public function render_settings_page()
	{
		?>
		<div class="wrap">
			<h1>OverSeek Integration Settings</h1>
			<form method="post" action="options.php">
				<?php settings_fields('overseek_options_group'); ?>
				<?php do_settings_sections('overseek_options_group'); ?>
				<table class="form-table">
					<tr valign="top">
						<th scope="row">Configuration Status</th>
						<td>
							<?php
							$api_url = get_option('overseek_api_url');
							$account_id = get_option('overseek_account_id');

							if ($api_url && $account_id) {
								echo '<div style="color: green; font-weight: bold; margin-bottom: 5px;">&#10003; Settings Saved</div>';
								echo '<div style="font-size: 12px; color: #666;">Account ID: ' . esc_html($account_id) . '</div>';
								echo '<div style="font-size: 12px; color: #666;">Use the Overseek Dashboard to verify live connectivity.</div>';
							} else {
								echo '<span style="color: red; font-weight: bold;">&#10007; Not Configured</span>';
							}
							?>
						</td>
					</tr>
					<tr valign="top">
						<th scope="row">Connection Config (JSON)</th>
						<td>
							<textarea name="overseek_connection_config" rows="5" cols="50"
								style="font-family: monospace; width: 100%;"><?php echo esc_textarea(get_option('overseek_connection_config')); ?></textarea>
							<p class="description">Paste the "Connection Configuration" JSON blob from your Overseek Dashboard
								here.</p>
						</td>
					</tr>

					<!-- Hidden fields removed as they overwrite the parsed JSON values -->

					<tr valign="top">
						<th scope="row">Enable Global Tracking</th>
						<td>
							<input type="checkbox" name="overseek_enable_tracking" value="1" <?php checked(1, get_option('overseek_enable_tracking'), true); ?> />
							<p class="description">Enable OverSeek analytics tracking on the storefront.</p>
						</td>
					</tr>
					<tr valign="top">
						<th scope="row">Enable Live Chat Widget</th>
						<td>
							<input type="checkbox" name="overseek_enable_chat" value="1" <?php checked(1, get_option('overseek_enable_chat'), true); ?> />
							<p class="description">Show the OverSeek live chat widget to visitors.</p>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}

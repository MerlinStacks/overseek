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
	 * Normalize checkbox-style values into a stored string flag.
	 *
	 * @param mixed $value Raw submitted value.
	 * @return string
	 */
	public function sanitize_checkbox($value)
	{
		return empty($value) ? '' : '1';
	}

	/**
	 * Enqueue admin-only assets for the OverSeek settings screen.
	 *
	 * @param string $hook_suffix Current admin page hook.
	 * @return void
	 */
	public function enqueue_assets($hook_suffix)
	{
		if ($hook_suffix !== 'woocommerce_page_overseek') {
			return;
		}

		wp_enqueue_style(
			'overseek-admin',
			OVERSEEK_WC_PLUGIN_URL . 'assets/admin.css',
			array(),
			OVERSEEK_WC_VERSION
		);
	}

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

		register_setting('overseek_options_group', 'overseek_enable_tracking', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		register_setting('overseek_options_group', 'overseek_enable_chat', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		
		// Privacy settings
		register_setting('overseek_options_group', 'overseek_require_consent', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		register_setting('overseek_options_group', 'overseek_cookie_retention_days', array(
			'type' => 'integer',
			'default' => 365,
			'sanitize_callback' => 'absint',
		));

		// Email relay settings
		register_setting('overseek_options_group', 'overseek_relay_api_key', array(
			'type' => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		));

		// Web Vitals settings
		register_setting('overseek_options_group', 'overseek_enable_vitals', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		register_setting('overseek_options_group', 'overseek_vitals_sample_rate', array(
			'type'              => 'integer',
			'default'           => 100,
			'sanitize_callback' => function($val) {
				$val = absint($val);
				return max(1, min(100, $val));
			},
		));
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
		$data = json_decode(wp_unslash((string) $input), true);

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
		if (!current_user_can('manage_options')) {
			wp_die(esc_html__('You do not have permission to access this page.', 'overseek-wc'));
		}

		$api_url            = (string) get_option('overseek_api_url', '');
		$account_id         = (string) get_option('overseek_account_id', '');
		$connection_config  = (string) get_option('overseek_connection_config', '');
		$relay_api_key      = (string) get_option('overseek_relay_api_key', '');
		$retention          = (int) get_option('overseek_cookie_retention_days', 365);
		$sample_rate        = (int) get_option('overseek_vitals_sample_rate', 100);
		$relay_endpoint     = home_url('/wp-json/overseek/v1/email-relay');
		$is_configured      = !empty($api_url) && !empty($account_id);
		$enabled_features   = array_filter(array(
			get_option('overseek_enable_tracking'),
			get_option('overseek_enable_chat'),
			get_option('overseek_enable_vitals', '1'),
		));
		$status_label       = $is_configured ? 'Connected' : 'Needs setup';
		$status_description = $is_configured
			? 'Your store is linked. Save updates here and verify activity from the OverSeek dashboard.'
			: 'Paste the connection JSON from your OverSeek dashboard to finish linking this store.';
		?>
		<div class="wrap overseek-admin">
			<div class="overseek-admin__hero">
				<div>
					<span class="overseek-admin__eyebrow">WooCommerce Command Center</span>
					<h1>OverSeek Plugin Settings</h1>
					<p class="overseek-admin__intro">A cleaner place to manage connection, storefront collection, privacy controls, and relay settings for your store.</p>
				</div>
				<div class="overseek-admin__hero-meta">
					<span class="overseek-admin__status <?php echo $is_configured ? 'is-connected' : 'is-warning'; ?>">
						<?php echo esc_html($status_label); ?>
					</span>
					<p><?php echo esc_html($status_description); ?></p>
				</div>
			</div>

			<div class="overseek-admin__stats">
				<div class="overseek-admin__stat-card">
					<span class="overseek-admin__stat-label">Connection</span>
					<strong><?php echo esc_html($is_configured ? 'Ready' : 'Pending'); ?></strong>
					<p><?php echo esc_html($is_configured ? $account_id : 'Awaiting dashboard config'); ?></p>
				</div>
				<div class="overseek-admin__stat-card">
					<span class="overseek-admin__stat-label">Enabled features</span>
					<strong><?php echo esc_html((string) count($enabled_features)); ?>/3</strong>
					<p>Tracking, chat, and vitals can be toggled independently.</p>
				</div>
				<div class="overseek-admin__stat-card">
					<span class="overseek-admin__stat-label">Privacy retention</span>
					<strong><?php echo esc_html((string) $retention); ?> days</strong>
					<p><?php echo esc_html(get_option('overseek_require_consent') ? 'Consent gate enabled' : 'Consent gate disabled'); ?></p>
				</div>
			</div>

			<?php settings_errors('overseek_connection_config'); ?>

			<form method="post" action="options.php" class="overseek-admin__form">
				<?php settings_fields('overseek_options_group'); ?>
				<?php do_settings_sections('overseek_options_group'); ?>

				<div class="overseek-admin__grid">
					<section class="overseek-admin__card">
						<div class="overseek-admin__card-header">
							<div>
								<h2>Connection</h2>
								<p>Link this store with your OverSeek workspace using the dashboard-issued configuration JSON.</p>
							</div>
							<span class="overseek-admin__status <?php echo $is_configured ? 'is-connected' : 'is-warning'; ?>">
								<?php echo esc_html($status_label); ?>
							</span>
						</div>

						<div class="overseek-admin__callout">
							<strong><?php echo esc_html($is_configured ? 'Store linked successfully.' : 'Configuration still required.'); ?></strong>
							<p><?php echo esc_html($status_description); ?></p>
						</div>

						<label class="overseek-admin__field" for="overseek_connection_config">
							<span class="overseek-admin__label">Connection config JSON</span>
							<textarea id="overseek_connection_config" name="overseek_connection_config" rows="8" spellcheck="false"><?php echo esc_textarea($connection_config); ?></textarea>
							<span class="overseek-admin__hint">Paste the exact <strong>Connection Configuration</strong> blob from your OverSeek dashboard.</span>
						</label>

						<div class="overseek-admin__keyvals">
							<div>
								<span class="overseek-admin__key">Account ID</span>
								<code><?php echo esc_html($account_id ?: 'Not set yet'); ?></code>
							</div>
							<div>
								<span class="overseek-admin__key">API URL</span>
								<code><?php echo esc_html($api_url ?: 'Not set yet'); ?></code>
							</div>
						</div>
					</section>

					<section class="overseek-admin__card">
						<div class="overseek-admin__card-header">
							<div>
								<h2>Storefront Features</h2>
								<p>Turn visitor-facing capabilities on or off without touching code.</p>
							</div>
						</div>

						<?php $this->render_toggle_field('overseek_enable_tracking', 'Enable global tracking', 'Send storefront analytics and behavioral events to OverSeek.'); ?>
						<?php $this->render_toggle_field('overseek_enable_chat', 'Enable live chat widget', 'Show the OverSeek chat widget to visitors across your storefront.'); ?>
						<?php $this->render_toggle_field('overseek_enable_vitals', 'Enable Web Vitals collection', 'Collect LCP, CLS, INP, FCP, and TTFB with near-zero impact using beacon delivery.', '1', 'overseek_enable_vitals'); ?>

						<label class="overseek-admin__field" for="overseek_vitals_sample_rate">
							<span class="overseek-admin__label">Web Vitals sampling rate</span>
							<select id="overseek_vitals_sample_rate" name="overseek_vitals_sample_rate">
								<option value="100" <?php selected($sample_rate, 100); ?>>100% - All page loads</option>
								<option value="50" <?php selected($sample_rate, 50); ?>>50% - Every other page load</option>
								<option value="25" <?php selected($sample_rate, 25); ?>>25% - 1 in 4 page loads</option>
								<option value="10" <?php selected($sample_rate, 10); ?>>10% - High-traffic stores</option>
							</select>
							<span class="overseek-admin__hint">Use 100% for lower-traffic stores. Reduce the rate if you want to limit data volume on very busy storefronts.</span>
						</label>
					</section>

					<section class="overseek-admin__card">
						<div class="overseek-admin__card-header">
							<div>
								<h2>Email Relay</h2>
								<p>Let OverSeek send campaign and automation email through this WordPress installation.</p>
							</div>
						</div>

						<label class="overseek-admin__field" for="overseek_relay_api_key">
							<span class="overseek-admin__label">Relay API key</span>
							<input id="overseek_relay_api_key" type="text" name="overseek_relay_api_key" value="<?php echo esc_attr($relay_api_key); ?>" spellcheck="false" />
							<span class="overseek-admin__hint">Use the same secure key configured in OverSeek email settings.</span>
						</label>

						<div class="overseek-admin__code-block">
							<span class="overseek-admin__key">Relay endpoint</span>
							<code><?php echo esc_html($relay_endpoint); ?></code>
							<p>Copy this URL into OverSeek so outbound mail can be posted to this store.</p>
						</div>
					</section>

					<section class="overseek-admin__card">
						<div class="overseek-admin__card-header">
							<div>
								<h2>Privacy Controls</h2>
								<p>Choose how long identifiers live and whether consent is required before tracking runs.</p>
							</div>
						</div>

						<label class="overseek-admin__field" for="overseek_cookie_retention_days">
							<span class="overseek-admin__label">Cookie retention</span>
							<select id="overseek_cookie_retention_days" name="overseek_cookie_retention_days">
								<option value="30" <?php selected($retention, 30); ?>>30 days</option>
								<option value="90" <?php selected($retention, 90); ?>>90 days</option>
								<option value="180" <?php selected($retention, 180); ?>>180 days</option>
								<option value="365" <?php selected($retention, 365); ?>>1 year</option>
								<option value="730" <?php selected($retention, 730); ?>>2 years</option>
							</select>
							<span class="overseek-admin__hint">Shorter retention improves privacy posture and may better fit regional compliance needs.</span>
						</label>

						<?php $this->render_toggle_field('overseek_require_consent', 'Require cookie consent', 'Only track visitors after consent is granted through a WP Consent API-compatible plugin.'); ?>
					</section>
				</div>

				<div class="overseek-admin__footer">
					<?php submit_button('Save OverSeek Settings', 'primary', 'submit', false); ?>
					<p>Changes apply to this WooCommerce store only.</p>
				</div>
			</form>
		</div>
		<?php
	}

	/**
	 * Render a toggle row with consistent styling.
	 *
	 * @param string $option_name Option storage key.
	 * @param string $label Toggle label.
	 * @param string $description Supporting copy.
	 * @param string $default Default option value.
	 * @param string $id Optional input id.
	 * @return void
	 */
	private function render_toggle_field($option_name, $label, $description, $default = '0', $id = '')
	{
		$field_id = $id ?: $option_name;
		?>
		<label class="overseek-admin__toggle" for="<?php echo esc_attr($field_id); ?>">
			<span class="overseek-admin__toggle-input">
				<input type="hidden" name="<?php echo esc_attr($option_name); ?>" value="" />
				<input
					id="<?php echo esc_attr($field_id); ?>"
					type="checkbox"
					name="<?php echo esc_attr($option_name); ?>"
					value="1"
					<?php checked(1, get_option($option_name, $default), true); ?>
				/>
			</span>
			<span class="overseek-admin__toggle-copy">
				<span class="overseek-admin__label"><?php echo esc_html($label); ?></span>
				<span class="overseek-admin__hint"><?php echo esc_html($description); ?></span>
			</span>
		</label>
		<?php
	}
}

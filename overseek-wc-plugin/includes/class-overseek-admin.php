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
		if ($hook_suffix !== 'toplevel_page_overseek') {
			return;
		}

		wp_enqueue_style(
			'overseek-admin',
			OVERSEEK_WC_PLUGIN_URL . 'assets/admin.css',
			array(),
			OVERSEEK_WC_VERSION
		);

		wp_enqueue_script(
			'overseek-admin-tabs',
			OVERSEEK_WC_PLUGIN_URL . 'assets/admin-tabs.js',
			array(),
			OVERSEEK_WC_VERSION,
			true
		);
	}

	/**
	 * Register the OverSeek top-level admin page.
	 */
	public function add_menu_page()
	{
		add_menu_page(
			'OverSeek Settings',     // Page title
			'OverSeek',              // Menu title
			'manage_options',        // Capability
			'overseek',              // Menu slug
			array($this, 'render_settings_page'), // Callback
			'dashicons-chart-area',
			56
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
		register_setting('overseek_options_group', 'overseek_webhook_auth_token', array(
			'type' => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		));
		register_setting('overseek_options_group', 'overseek_email_relay_profiles', array(
			'type' => 'string',
			'sanitize_callback' => array('OverSeek_Email_Relay_Profiles', 'sanitize_profiles_option'),
		));
		register_setting('overseek_options_group', 'overseek_email_relay_default_profile', array(
			'type' => 'string',
			'sanitize_callback' => array('OverSeek_Email_Relay_Profiles', 'sanitize_default_profile_option'),
		));
		register_setting('overseek_options_group', 'overseek_enable_processing_invoice_sync', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		register_setting('overseek_options_group', 'overseek_invoice_retention_days', array(
			'type' => 'integer',
			'default' => 30,
			'sanitize_callback' => 'absint',
		));

		// Web Vitals settings
		register_setting('overseek_options_group', 'overseek_enable_vitals', array(
			'type' => 'string',
			'sanitize_callback' => array($this, 'sanitize_checkbox'),
		));
		register_setting('overseek_options_group', 'overseek_vitals_sample_rate', array(
			'type'              => 'integer',
			'default'           => 25,
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
		$webhook_auth_token = (string) get_option('overseek_webhook_auth_token', '');
		$email_relay_profiles = OverSeek_Email_Relay_Profiles::get_profiles_json_for_admin();
		$email_relay_profiles_pretty = $email_relay_profiles !== '' ? $email_relay_profiles : '[]';
		$email_relay_default_profile = (string) get_option('overseek_email_relay_default_profile', '');
		$retention          = (int) get_option('overseek_cookie_retention_days', 365);
		$invoice_retention  = (int) get_option('overseek_invoice_retention_days', 30);
		$sample_rate        = (int) get_option('overseek_vitals_sample_rate', 25);
		$relay_endpoint     = home_url('/wp-json/overseek/v1/email-relay');
		$tracking_events_endpoint = home_url('/wp-json/overseek/v1/tracking-email-events');
		$artwork_events_endpoint  = home_url('/wp-json/overseek/v1/artwork-events');
		$is_configured      = !empty($api_url) && !empty($account_id);
		$enabled_features   = array_filter(array(
			get_option('overseek_enable_tracking'),
			get_option('overseek_enable_chat'),
			get_option('overseek_enable_vitals', '1'),
			get_option('overseek_enable_processing_invoice_sync', '1'),
		));
		$status_label       = $is_configured ? 'Connected' : 'Needs setup';
		$status_description = $is_configured
			? 'Your store is linked. Save updates here and verify activity from the OverSeek dashboard.'
			: 'Paste the connection JSON from your OverSeek dashboard to finish linking this store.';
		$bot_shield_health  = $this->get_bot_shield_health($account_id, $is_configured);
		$sync_notice        = isset($_GET['overseek_bot_shield_notice'])
			? sanitize_text_field(wp_unslash((string) $_GET['overseek_bot_shield_notice']))
			: '';
		$test_notice        = isset($_GET['overseek_bot_shield_test'])
			? sanitize_text_field(wp_unslash((string) $_GET['overseek_bot_shield_test']))
			: '';
		$email_profile_test = isset($_GET['overseek_email_profile_test'])
			? sanitize_text_field(wp_unslash((string) $_GET['overseek_email_profile_test']))
			: '';
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
					<strong><?php echo esc_html((string) count($enabled_features)); ?>/4</strong>
					<p>Tracking, chat, vitals, and invoice sync can be toggled independently.</p>
				</div>
				<div class="overseek-admin__stat-card">
					<span class="overseek-admin__stat-label">Privacy retention</span>
					<strong><?php echo esc_html((string) $retention); ?> days</strong>
					<p><?php echo esc_html(get_option('overseek_require_consent') ? 'Consent gate enabled' : 'Consent gate disabled'); ?></p>
				</div>
			</div>

			<?php settings_errors('overseek_connection_config'); ?>
			<?php settings_errors('overseek_email_relay_profiles'); ?>
			<?php if ($sync_notice === 'success') : ?>
				<div class="notice notice-success is-dismissible"><p>Bot Shield sync completed successfully.</p></div>
			<?php elseif ($sync_notice === 'failed') : ?>
				<div class="notice notice-error is-dismissible"><p>Bot Shield sync failed. Verify account connection, API URL, and outbound connectivity.</p></div>
			<?php endif; ?>
			<?php if ($test_notice === 'pass') : ?>
				<div class="notice notice-success is-dismissible"><p>Bot Shield test passed: cached patterns are available and matcher is operational.</p></div>
			<?php elseif ($test_notice === 'warn') : ?>
				<div class="notice notice-warning is-dismissible"><p>Bot Shield test warning: no cached patterns available yet.</p></div>
			<?php endif; ?>
			<?php if ($email_profile_test === 'pass') : ?>
				<div class="notice notice-success is-dismissible"><p>Email sender profile test sent successfully.</p></div>
			<?php elseif ($email_profile_test === 'failed') : ?>
				<div class="notice notice-error is-dismissible"><p>Email sender profile test failed. Verify profile ID, SMTP credentials, and recipient email.</p></div>
			<?php endif; ?>

			<form method="post" action="options.php" class="overseek-admin__form">
				<?php settings_fields('overseek_options_group'); ?>
				<?php do_settings_sections('overseek_options_group'); ?>

				<div class="overseek-admin__tabs" role="tablist" aria-label="OverSeek settings sections">
					<button type="button" class="overseek-admin__tab is-active" role="tab" aria-selected="true" data-tab-target="connection">Connection</button>
					<button type="button" class="overseek-admin__tab" role="tab" aria-selected="false" data-tab-target="bot-shield">Bot Shield</button>
					<button type="button" class="overseek-admin__tab" role="tab" aria-selected="false" data-tab-target="storefront">Storefront</button>
					<button type="button" class="overseek-admin__tab" role="tab" aria-selected="false" data-tab-target="invoices">Invoices</button>
					<button type="button" class="overseek-admin__tab" role="tab" aria-selected="false" data-tab-target="email-relay">Email Relay</button>
					<button type="button" class="overseek-admin__tab" role="tab" aria-selected="false" data-tab-target="privacy">Privacy</button>
				</div>

				<div class="overseek-admin__grid">
					<section class="overseek-admin__card <?php echo !$is_configured ? 'overseek-admin__card--muted' : ''; ?> overseek-admin__tab-panel" data-tab-panel="connection">
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

					<section class="overseek-admin__card overseek-admin__tab-panel" data-tab-panel="bot-shield" hidden>
						<div class="overseek-admin__card-header">
							<div>
								<h2>Bot Shield Health</h2>
								<p>Quick visibility into crawler block-list sync status on this store.</p>
							</div>
							<span class="overseek-admin__status <?php echo esc_attr($bot_shield_health['statusClass']); ?>">
								<?php echo esc_html($bot_shield_health['statusLabel']); ?>
							</span>
						</div>

						<div class="overseek-admin__callout">
							<strong><?php echo esc_html($bot_shield_health['headline']); ?></strong>
							<p><?php echo esc_html($bot_shield_health['message']); ?></p>
						</div>
						<?php if (!empty($bot_shield_health['syncError'])) : ?>
							<div class="notice notice-warning inline"><p><strong>Last sync error:</strong> <?php echo esc_html($bot_shield_health['syncError']); ?></p></div>
						<?php endif; ?>
						<?php if (!empty($bot_shield_health['cronWarning'])) : ?>
							<div class="notice notice-warning inline"><p><strong>Cron warning:</strong> <?php echo esc_html($bot_shield_health['cronWarning']); ?></p></div>
						<?php endif; ?>

						<div class="overseek-admin__keyvals">
							<div>
								<span class="overseek-admin__key">Last successful sync</span>
								<code><?php echo esc_html($bot_shield_health['lastSyncLabel']); ?></code>
							</div>
							<div>
								<span class="overseek-admin__key">Blocked patterns cached</span>
								<code><?php echo esc_html((string) $bot_shield_health['patternCount']); ?></code>
							</div>
						</div>

						<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top: 10px;">
							<input type="hidden" name="action" value="overseek_sync_blocked_agents" />
							<?php wp_nonce_field('overseek_sync_blocked_agents', 'overseek_sync_nonce'); ?>
							<?php submit_button(
								'Sync Bot Shield now',
								'secondary',
								'submit',
								false,
								array(
									'disabled' => !$is_configured,
									'title'    => $is_configured ? 'Fetch latest blocked crawler list from OverSeek.' : 'Connect your OverSeek account to enable Bot Shield sync.',
								)
							); ?>
						</form>

						<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top: 8px;">
							<input type="hidden" name="action" value="overseek_test_bot_shield" />
							<?php wp_nonce_field('overseek_test_bot_shield', 'overseek_test_nonce'); ?>
							<?php submit_button(
								'Test Bot Shield',
								'secondary',
								'submit',
								false,
								array(
									'disabled' => !$is_configured,
									'title'    => $is_configured ? 'Run a local health test against cached bot patterns.' : 'Connect your OverSeek account to enable Bot Shield tests.',
								)
							); ?>
						</form>

						<p class="overseek-admin__hint">If this remains stale, check WP-Cron and run a real server cron for <code>wp-cron.php</code> every 5 minutes.</p>
					</section>

					<section class="overseek-admin__card overseek-admin__tab-panel" data-tab-panel="storefront" hidden>
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

					<section class="overseek-admin__card overseek-admin__tab-panel" data-tab-panel="invoices" hidden>
						<div class="overseek-admin__card-header">
							<div>
								<h2>Order Invoices</h2>
								<p>Generate and attach private invoice PDFs when WooCommerce orders enter processing.</p>
							</div>
						</div>

					<?php $this->render_toggle_field('overseek_enable_processing_invoice_sync', 'Enable processing-order invoice sync', 'Calls OverSeek when an order enters processing, stores PDF in private uploads, and attaches it to processing emails.', '1'); ?>

						<label class="overseek-admin__field" for="overseek_invoice_retention_days">
							<span class="overseek-admin__label">Private invoice retention</span>
							<select id="overseek_invoice_retention_days" name="overseek_invoice_retention_days">
								<option value="7" <?php selected($invoice_retention, 7); ?>>7 days</option>
								<option value="14" <?php selected($invoice_retention, 14); ?>>14 days</option>
								<option value="30" <?php selected($invoice_retention, 30); ?>>30 days</option>
								<option value="60" <?php selected($invoice_retention, 60); ?>>60 days</option>
								<option value="90" <?php selected($invoice_retention, 90); ?>>90 days</option>
							</select>
							<span class="overseek-admin__hint">Files older than this are deleted daily from <code>uploads/overseek-private/invoices</code>.</span>
						</label>
					</section>

					<section class="overseek-admin__card overseek-admin__tab-panel" data-tab-panel="email-relay" hidden>
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

						<label class="overseek-admin__field" for="overseek_webhook_auth_token">
							<span class="overseek-admin__label">Webhook auth token (optional)</span>
							<input id="overseek_webhook_auth_token" type="text" name="overseek_webhook_auth_token" value="<?php echo esc_attr($webhook_auth_token); ?>" spellcheck="false" />
							<span class="overseek-admin__hint">If set, third-party plugins can use <code>Authorization: Bearer {token}</code>. This same token is also sent when forwarding tracking events to the OverSeek API.</span>
						</label>

						<div class="overseek-admin__code-block">
							<span class="overseek-admin__key">Email platform webhook URL</span>
							<code><?php echo esc_html($relay_endpoint); ?></code>
							<p>Copy this URL into OverSeek so outbound mail can be posted to this store.</p>
						</div>

						<div class="overseek-admin__code-block">
							<span class="overseek-admin__key">Tracking events webhook URL</span>
							<code><?php echo esc_html($tracking_events_endpoint); ?></code>
							<p>Use this URL in CK Order Workflow for tracking lifecycle forwarding.</p>
						</div>

						<div class="overseek-admin__code-block">
							<span class="overseek-admin__key">Artwork events webhook URL</span>
							<code><?php echo esc_html($artwork_events_endpoint); ?></code>
							<p>Use this URL in CK Order Workflow for artwork proof lifecycle forwarding.</p>
						</div>

						<label class="overseek-admin__field" for="overseek_email_relay_default_profile">
							<span class="overseek-admin__label">Default sender profile ID (optional)</span>
							<input id="overseek_email_relay_default_profile" type="text" name="overseek_email_relay_default_profile" value="<?php echo esc_attr($email_relay_default_profile); ?>" spellcheck="false" placeholder="support-team" />
							<span class="overseek-admin__hint">Used when payload does not include <code>relay_profile_id</code>. Leave empty to keep WooCommerce/plugin defaults.</span>
						</label>

						<label class="overseek-admin__field" for="overseek_email_relay_profiles">
							<span class="overseek-admin__label">Sender profiles JSON (optional)</span>
							<textarea id="overseek_email_relay_profiles" name="overseek_email_relay_profiles" rows="10" spellcheck="false" class="overseek-admin__textarea--hidden" placeholder='[{"id":"support-team","name":"Support Team","from_name":"Support Team","from_email":"support@example.com","reply_to":"help@example.com","smtp_host":"smtp.example.com","smtp_port":587,"smtp_secure":"tls","smtp_auth":true,"smtp_username":"support@example.com","smtp_password":"app-password","smtp_from_force":true}]'><?php echo esc_textarea($email_relay_profiles_pretty); ?></textarea>
							<span class="overseek-admin__hint">Profiles apply only to OverSeek relay requests. Normal WooCommerce and other plugin email flows are unchanged unless they call this relay endpoint and select a profile.</span>
						</label>

						<div class="overseek-admin__profiles" data-relay-profiles-editor>
							<div class="overseek-admin__profiles-header">
								<strong>Sender Profiles</strong>
								<button type="button" class="button button-secondary" data-add-profile>Add profile</button>
							</div>
							<div class="overseek-admin__profiles-list" data-profiles-list></div>
							<details>
								<summary>Advanced: edit JSON directly</summary>
								<textarea rows="8" spellcheck="false" data-profiles-json-editor><?php echo esc_textarea($email_relay_profiles_pretty); ?></textarea>
							</details>
						</div>

						<div class="overseek-admin__test-form">
							<?php wp_nonce_field('overseek_test_email_relay_profile', 'overseek_test_email_relay_profile_nonce'); ?>
							<label class="overseek-admin__field" for="overseek_test_profile_id">
								<span class="overseek-admin__label">Test profile ID</span>
								<input id="overseek_test_profile_id" type="text" name="overseek_test_profile_id" value="<?php echo esc_attr($email_relay_default_profile); ?>" spellcheck="false" placeholder="support-team" />
							</label>
							<label class="overseek-admin__field" for="overseek_test_profile_to">
								<span class="overseek-admin__label">Test recipient email</span>
								<input id="overseek_test_profile_to" type="text" name="overseek_test_profile_to" value="<?php echo esc_attr((string) wp_get_current_user()->user_email); ?>" spellcheck="false" />
							</label>
							<p>
								<button
									type="submit"
									class="button button-secondary"
									name="action"
									value="overseek_test_email_relay_profile"
									formaction="<?php echo esc_url(admin_url('admin-post.php')); ?>"
								>
									Send Test With Profile
								</button>
							</p>
						</div>
					</section>

					<section class="overseek-admin__card overseek-admin__tab-panel" data-tab-panel="privacy" hidden>
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

	/**
	 * Build Bot Shield health snapshot for admin UI.
	 *
	 * @param string $account_id Account ID from settings.
	 * @param bool   $is_configured Whether connection is configured.
	 * @return array<string, mixed>
	 */
	private function get_bot_shield_health($account_id, $is_configured)
	{
		if (!$is_configured || empty($account_id)) {
			return array(
				'statusClass'   => 'is-warning',
				'statusLabel'   => 'Not available',
				'headline'      => 'Connect this store first.',
				'message'       => 'Bot Shield health appears after connection settings are saved.',
				'lastSyncLabel' => 'Not available',
				'patternCount'  => 0,
				'syncError'     => '',
				'cronWarning'   => '',
			);
		}

		$transient_key = 'overseek_blocked_agents_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 8);
		$cached = get_transient($transient_key);
		$sync_error = (string) get_transient($transient_key . '_last_error');
		$last_attempt = (int) get_transient($transient_key . '_last_attempt');
		$cron_warning = '';
		if ((defined('DISABLE_WP_CRON') && DISABLE_WP_CRON) && $last_attempt === 0) {
			$cron_warning = 'DISABLE_WP_CRON is enabled and no Bot Shield sync attempt has been recorded yet.';
		} elseif ($last_attempt > 0 && (time() - $last_attempt) > (2 * HOUR_IN_SECONDS)) {
			$cron_warning = 'Last Bot Shield sync attempt is older than 2 hours. WP-Cron may be delayed.';
		}

		if (!is_array($cached)) {
			return array(
				'statusClass'   => 'is-warning',
				'statusLabel'   => 'Sync needed',
				'headline'      => 'No Bot Shield cache found yet.',
				'message'       => 'The plugin will fail-open until blocked agents are synced from OverSeek.',
				'lastSyncLabel' => 'Never',
				'patternCount'  => 0,
				'syncError'     => $sync_error,
				'cronWarning'   => $cron_warning,
			);
		}

		$patterns = isset($cached['patterns']) && is_array($cached['patterns']) ? $cached['patterns'] : array();
		$fetched_at = isset($cached['fetchedAt']) && is_numeric($cached['fetchedAt']) ? (int) $cached['fetchedAt'] : 0;
		$age_seconds = $fetched_at > 0 ? (time() - $fetched_at) : PHP_INT_MAX;

		if ($fetched_at > 0) {
			$last_sync_label = sprintf(
				'%s (%s ago)',
				wp_date('Y-m-d H:i:s', $fetched_at),
				human_time_diff($fetched_at, time())
			);
		} else {
			$last_sync_label = 'Unknown (legacy cache payload)';
		}

		$is_stale = $age_seconds > (3 * HOUR_IN_SECONDS);
		if ($is_stale) {
			return array(
				'statusClass'   => 'is-warning',
				'statusLabel'   => 'Stale',
				'headline'      => 'Bot Shield cache is stale.',
				'message'       => 'Crawler rules may be out of date. Verify WP-Cron execution and OverSeek API reachability.',
				'lastSyncLabel' => $last_sync_label,
				'patternCount'  => count($patterns),
				'syncError'     => $sync_error,
				'cronWarning'   => $cron_warning,
			);
		}

		return array(
			'statusClass'   => 'is-connected',
			'statusLabel'   => 'Healthy',
			'headline'      => 'Bot Shield sync is healthy.',
			'message'       => 'Blocked crawler patterns are cached and actively enforceable on this store.',
			'lastSyncLabel' => $last_sync_label,
			'patternCount'  => count($patterns),
			'syncError'     => $sync_error,
			'cronWarning'   => $cron_warning,
		);
	}

	/**
	 * Handle manual Bot Shield sync action from admin settings.
	 *
	 * @return void
	 */
	public function handle_sync_blocked_agents()
	{
		if (!current_user_can('manage_options')) {
			wp_die(esc_html__('You do not have permission to access this page.', 'overseek-wc'));
		}

		check_admin_referer('overseek_sync_blocked_agents', 'overseek_sync_nonce');

		$guard = new OverSeek_Crawler_Guard();
		$guard->sync_blocked_list();

		$account_id = (string) get_option('overseek_account_id', '');
		$transient_key = '';
		if (!empty($account_id)) {
			$transient_key = 'overseek_blocked_agents_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 8);
		}

		$cached = !empty($transient_key) ? get_transient($transient_key) : false;
		$notice = is_array($cached) ? 'success' : 'failed';

		$redirect = add_query_arg(
			array(
				'page' => 'overseek',
				'overseek_bot_shield_notice' => $notice,
			),
			admin_url('admin.php')
		);

		wp_safe_redirect($redirect);
		exit;
	}

	/**
	 * Run a local Bot Shield operational test against cached patterns.
	 *
	 * @return void
	 */
	public function handle_test_bot_shield()
	{
		if (!current_user_can('manage_options')) {
			wp_die(esc_html__('You do not have permission to access this page.', 'overseek-wc'));
		}

		check_admin_referer('overseek_test_bot_shield', 'overseek_test_nonce');

		$account_id = (string) get_option('overseek_account_id', '');
		$test_result = 'warn';

		if (!empty($account_id)) {
			$transient_key = 'overseek_blocked_agents_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 8);
			$cached = get_transient($transient_key);
			$patterns = is_array($cached) && isset($cached['patterns']) && is_array($cached['patterns'])
				? $cached['patterns']
				: array();

			if (!empty($patterns)) {
				$first_pattern = strtolower((string) $patterns[0]);
				$ua = 'OverSeek-Health-Check/' . $first_pattern;
				$test_result = (strpos(strtolower($ua), $first_pattern) !== false) ? 'pass' : 'warn';
			}
		}

		$redirect = add_query_arg(
			array(
				'page' => 'overseek',
				'overseek_bot_shield_test' => $test_result,
			),
			admin_url('admin.php')
		);

		wp_safe_redirect($redirect);
		exit;
	}

	/**
	 * Send a scoped test email using selected relay profile.
	 *
	 * @return void
	 */
	public function handle_test_email_relay_profile()
	{
		if (!current_user_can('manage_options')) {
			wp_die(esc_html__('You do not have permission to access this page.', 'overseek-wc'));
		}

		check_admin_referer('overseek_test_email_relay_profile', 'overseek_test_email_relay_profile_nonce');

		$profile_id = isset($_POST['overseek_test_profile_id']) ? sanitize_key((string) wp_unslash($_POST['overseek_test_profile_id'])) : '';
		$to = isset($_POST['overseek_test_profile_to']) ? sanitize_email((string) wp_unslash($_POST['overseek_test_profile_to'])) : '';
		$result = 'failed';

		if ($profile_id !== '' && is_email($to)) {
			$cleanup_scope = OverSeek_Email_Relay_Profiles::begin_relay_scope(array('relay_profile_id' => $profile_id));
			try {
				$result = wp_mail(
					$to,
					'[OverSeek] Sender Profile Test',
					'<p>This is a sender profile test from OverSeek WooCommerce plugin.</p>',
					array('Content-Type: text/html; charset=UTF-8')
				) ? 'pass' : 'failed';
			} finally {
				$cleanup_scope();
			}
		}

		$redirect = add_query_arg(
			array(
				'page' => 'overseek',
				'overseek_email_profile_test' => $result,
			),
			admin_url('admin.php')
		);

		wp_safe_redirect($redirect);
		exit;
	}
}

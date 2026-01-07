<?php
/**
 * Plugin Name: OverSeek Integration for WooCommerce (Single File)
 * Plugin URI:  https://overseek.io
 * Description: Seamlessly integrates OverSeek analytics and live chat with your WooCommerce store.
 * Version:     1.0.0
 * Author:      OverSeek
 * Author URI:  https://overseek.io
 * Text Domain: overseek-wc
 * Domain Path: /languages
 * WC requires at least: 5.0
 * WC tested up to: 8.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
	exit;
}

// Define plugin constants.
define('OVERSEEK_WC_VERSION', '1.0.0');
define('OVERSEEK_WC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('OVERSEEK_WC_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * Class OverSeek_Frontend
 *
 * Handles frontend script injection based on settings.
 */
class OverSeek_Frontend
{

	/**
	 * Print scripts to the head if enabled.
	 * NOTE: Analytics tracking is now 100% server-side - no JavaScript needed.
	 */
	public function print_scripts()
	{
		$chat_enabled = get_option('overseek_enable_chat');
		$api_url = get_option('overseek_api_url', 'https://api.overseek.com');
		$account_id = get_option('overseek_account_id');

		$api_url = untrailingslashit($api_url);

		// Analytics is 100% server-side now - see OverSeek_Server_Tracking class

		if ($chat_enabled && !empty($account_id)) {
			echo "<!-- OverSeek Live Chat Widget Start -->\n";
			echo "<script src='" . esc_url($api_url) . "/api/chat/widget.js?id=" . esc_js($account_id) . "' async defer></script>\n";
			echo "<!-- OverSeek Live Chat Widget End -->\n";
		}
	}
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
	 * @return string Original input if invalid, or empty string if parsed successfully.
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

/**
 * Class OverSeek_Main
 * 
 * The core plugin class responsible for loading dependencies and defining hooks.
 */
class OverSeek_Main
{

	/**
	 * Loader for admin hooks.
	 *
	 * @var OverSeek_Admin
	 */
	protected $admin;

	/**
	 * Loader for frontend hooks.
	 *
	 * @var OverSeek_Frontend
	 */
	protected $frontend;

	/**
	 * Initialize the plugin classes.
	 */
	public function __construct()
	{
		// Dependencies are inline now
		$this->init_hooks();
	}

	/**
	 * Initialize hooks for Admin and Frontend.
	 */
	private function init_hooks()
	{
		// Initialize Admin
		$this->admin = new OverSeek_Admin();
		add_action('admin_menu', array($this->admin, 'add_menu_page'));
		add_action('admin_init', array($this->admin, 'register_settings'));

		// Initialize Frontend
		$this->frontend = new OverSeek_Frontend();
		add_action('wp_head', array($this->frontend, 'print_scripts'));
	}

	/**
	 * Run the plugin.
	 */
	public function run()
	{
		// Any post-initialization logic can go here.
	}
}

/**
 * Main Plugin Class Initialization
 */
function overseek_wc_init()
{
	// Initialize the main plugin class.
	$overseek_plugin = new OverSeek_Main();
	$overseek_plugin->run();
}
add_action('plugins_loaded', 'overseek_wc_init');

/**
 * Declare HPOS Compatibility
 */
add_action('before_woocommerce_init', function () {
	if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
	}
});

/**
 * Register REST API Endpoint for Auto-Configuration
 */
add_action('rest_api_init', function () {
	register_rest_route('overseek/v1', '/settings', array(
		'methods' => 'POST',
		'callback' => 'overseek_update_settings_callback',
		'permission_callback' => function () {
			return current_user_can('manage_woocommerce') || current_user_can('manage_options');
		}
	));

	// Public health check endpoint - no auth required
	// Used by Overseek dashboard to verify plugin installation
	register_rest_route('overseek/v1', '/health', array(
		'methods' => 'GET',
		'callback' => 'overseek_health_check_callback',
		'permission_callback' => '__return_true' // Public endpoint
	));
});

function overseek_update_settings_callback($request)
{
	$params = $request->get_json_params();

	if (isset($params['account_id'])) {
		update_option('overseek_account_id', sanitize_text_field($params['account_id']));
	}

	if (isset($params['api_url'])) {
		update_option('overseek_api_url', esc_url_raw($params['api_url']));
	}

	// Auto-enable tracking/chat if configured remotely
	update_option('overseek_enable_tracking', '1');
	update_option('overseek_enable_chat', '1');

	return new WP_REST_Response(array('success' => true, 'message' => 'Settings updated successfully'), 200);
}

/**
 * Health check callback - returns plugin status for dashboard verification.
 */
function overseek_health_check_callback($request)
{
	$account_id = get_option('overseek_account_id');
	$api_url = get_option('overseek_api_url');
	$tracking_enabled = get_option('overseek_enable_tracking');
	$chat_enabled = get_option('overseek_enable_chat');

	// Optionally verify the account ID matches the query param
	$query_account_id = $request->get_param('account_id');
	$account_match = empty($query_account_id) || $query_account_id === $account_id;

	return new WP_REST_Response(array(
		'success' => true,
		'plugin' => 'overseek-wc',
		'version' => OVERSEEK_WC_VERSION,
		'configured' => !empty($account_id) && !empty($api_url),
		'accountId' => $account_id ?: null,
		'accountMatch' => $account_match,
		'trackingEnabled' => (bool) $tracking_enabled,
		'chatEnabled' => (bool) $chat_enabled,
		'woocommerceActive' => class_exists('WooCommerce'),
		'woocommerceVersion' => defined('WC_VERSION') ? WC_VERSION : null,
		'siteUrl' => home_url(),
		'timestamp' => gmdate('c'),
	), 200);
}

/**
 * Class OverSeek_Server_Tracking
 *
 * Handles 100% server-side tracking via WooCommerce/WordPress hooks.
 * This is UNBLOCKABLE by ad blockers since it runs entirely on the server.
 * NO JAVASCRIPT REQUIRED.
 */
class OverSeek_Server_Tracking
{
	private $api_url;
	private $account_id;
	
	/**
	 * Cached visitor ID to avoid repeated cookie operations.
	 * @var string|null
	 */
	private $visitor_id = null;
	
	/**
	 * Event queue for deferred sending at shutdown.
	 * @var array
	 */
	private $event_queue = array();

	/**
	 * Initialize hooks.
	 */
	public function __construct()
	{
		$this->api_url = untrailingslashit(get_option('overseek_api_url', 'https://api.overseek.com'));
		$this->account_id = get_option('overseek_account_id');

		if (empty($this->account_id)) {
			return;
		}

		// CRITICAL: Initialize visitor cookie BEFORE any output is sent.
		// 'init' hook fires early enough that headers haven't been sent yet.
		// This ensures the cookie is properly set and persisted across requests.
		add_action('init', array($this, 'init_visitor_cookie'), 1);
		
		// Flush event queue at shutdown (non-blocking for performance)
		add_action('shutdown', array($this, 'flush_event_queue'));

		// Pageview - fires on every page load
		add_action('template_redirect', array($this, 'track_pageview'));

		// Add to cart
		add_action('woocommerce_add_to_cart', array($this, 'track_add_to_cart'), 10, 6);

		// Remove from cart
		add_action('woocommerce_remove_cart_item', array($this, 'track_remove_from_cart'), 10, 2);

		// Checkout start
		add_action('woocommerce_checkout_process', array($this, 'track_checkout_start'));

		// Purchase completed
		add_action('woocommerce_thankyou', array($this, 'track_purchase'), 10, 1);

		// Session Stitching: Link visitor to customer on login
		add_action('wp_login', array($this, 'track_identify'), 10, 2);
		add_action('woocommerce_created_customer', array($this, 'track_new_customer'), 10, 3);

		// Product View - detailed product tracking
		add_action('woocommerce_after_single_product', array($this, 'track_product_view'));

		// Cart View - track when cart page is viewed
		add_action('woocommerce_before_cart', array($this, 'track_cart_view'));

		// Checkout View - track when checkout page is viewed (not processing)
		add_action('woocommerce_before_checkout_form', array($this, 'track_checkout_view'));

		// Review Tracking
		add_action('comment_post', array($this, 'track_review'), 10, 3);
	}
	
	/**
	 * Initialize the visitor cookie early, before any output is sent.
	 * This MUST run before headers are sent to ensure cookies work.
	 * Also persists UTM parameters in a session cookie for attribution tracking.
	 */
	public function init_visitor_cookie()
	{
		// Skip admin, AJAX, cron, and REST API requests
		if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
			return;
		}
		
		$cookie_name = '_os_vid';
		
		// Check if cookie already exists
		if (isset($_COOKIE[$cookie_name]) && !empty($_COOKIE[$cookie_name])) {
			$this->visitor_id = sanitize_text_field($_COOKIE[$cookie_name]);
		} else {
			// Generate new visitor ID
			$this->visitor_id = $this->generate_uuid();
			
			// Set cookie for 1 year
			setcookie(
				$cookie_name,
				$this->visitor_id,
				time() + (365 * 24 * 60 * 60),
				'/',
				'',
				is_ssl(),
				false
			);
			$_COOKIE[$cookie_name] = $this->visitor_id;
		}
		
		// Persist UTM parameters in session cookie
		$this->persist_utm_parameters();
	}
	
	/**
	 * Persist UTM parameters from URL into a session cookie.
	 */
	private function persist_utm_parameters()
	{
		$utm_cookie = '_os_utm';
		
		$has_new_utm = isset($_GET['utm_source']) || isset($_GET['utm_medium']) || 
					   isset($_GET['utm_campaign']);
		
		if ($has_new_utm) {
			$utm_params = array();
			if (isset($_GET['utm_source'])) {
				$utm_params['source'] = sanitize_text_field($_GET['utm_source']);
			}
			if (isset($_GET['utm_medium'])) {
				$utm_params['medium'] = sanitize_text_field($_GET['utm_medium']);
			}
			if (isset($_GET['utm_campaign'])) {
				$utm_params['campaign'] = sanitize_text_field($_GET['utm_campaign']);
			}
			
			$utm_json = wp_json_encode($utm_params);
			setcookie($utm_cookie, $utm_json, 0, '/', '', is_ssl(), false);
			$_COOKIE[$utm_cookie] = $utm_json;
		}
	}
	
	/**
	 * Get persisted UTM parameters from cookie or URL.
	 */
	private function get_utm_parameters()
	{
		$utm_cookie = '_os_utm';
		
		// URL takes precedence
		if (isset($_GET['utm_source']) || isset($_GET['utm_campaign'])) {
			return array(
				'source' => isset($_GET['utm_source']) ? sanitize_text_field($_GET['utm_source']) : null,
				'medium' => isset($_GET['utm_medium']) ? sanitize_text_field($_GET['utm_medium']) : null,
				'campaign' => isset($_GET['utm_campaign']) ? sanitize_text_field($_GET['utm_campaign']) : null,
			);
		}
		
		// Fall back to cookie
		if (isset($_COOKIE[$utm_cookie]) && !empty($_COOKIE[$utm_cookie])) {
			$utm_data = json_decode(stripslashes($_COOKIE[$utm_cookie]), true);
			if (is_array($utm_data)) {
				return $utm_data;
			}
		}
		
		return array();
	}

	/**
	 * Get or create visitor ID from cookie.
	 * Uses cached value if available, falls back to cookie or generates new.
	 */
	private function get_visitor_id()
	{
		// Return cached value if we have it (from init_visitor_cookie)
		if ($this->visitor_id !== null) {
			return $this->visitor_id;
		}
		
		$cookie_name = '_os_vid';

		if (isset($_COOKIE[$cookie_name]) && !empty($_COOKIE[$cookie_name])) {
			$this->visitor_id = sanitize_text_field($_COOKIE[$cookie_name]);
			return $this->visitor_id;
		}

		// Fallback: Generate new visitor ID (cookie may have failed to set)
		// This should rarely happen now that we set in init hook
		$this->visitor_id = $this->generate_uuid();
		
		// Attempt to set cookie - may fail if headers already sent
		if (!headers_sent()) {
			setcookie($cookie_name, $this->visitor_id, time() + (365 * 24 * 60 * 60), '/', '', is_ssl(), false);
			$_COOKIE[$cookie_name] = $this->visitor_id;
		}

		return $this->visitor_id;
	}

	/**
	 * Generate a UUID v4.
	 */
	private function generate_uuid()
	{
		return sprintf(
			'%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
			mt_rand(0, 0xffff),
			mt_rand(0, 0xffff),
			mt_rand(0, 0xffff),
			mt_rand(0, 0x0fff) | 0x4000,
			mt_rand(0, 0x3fff) | 0x8000,
			mt_rand(0, 0xffff),
			mt_rand(0, 0xffff),
			mt_rand(0, 0xffff)
		);
	}
	/**
	 * Get the real visitor IP address.
	 * Handles proxies and load balancers.
	 */
	private function get_visitor_ip()
	{
		$ip = '';
		
		// Check for proxied IP first
		if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
			// X-Forwarded-For can contain multiple IPs, get the first one
			$ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
			$ip = trim($ips[0]);
		} elseif (!empty($_SERVER['HTTP_X_REAL_IP'])) {
			$ip = $_SERVER['HTTP_X_REAL_IP'];
		} elseif (!empty($_SERVER['HTTP_CLIENT_IP'])) {
			$ip = $_SERVER['HTTP_CLIENT_IP'];
		} elseif (!empty($_SERVER['REMOTE_ADDR'])) {
			$ip = $_SERVER['REMOTE_ADDR'];
		}
		
		// Validate IP
		if (filter_var($ip, FILTER_VALIDATE_IP)) {
			return $ip;
		}
		
		return '';
	}

	/**
	 * Queue tracking event for deferred sending at shutdown.
	 * Collects event data now, sends non-blocking at request end.
	 *
	 * @param string $type Event type (pageview, add_to_cart, etc.)
	 * @param array $payload Event-specific data
	 * @param bool $is_404 Whether this is a 404 error page
	 */
	private function queue_event($type, $payload = array(), $is_404 = false)
	{
		$visitor_id = $this->get_visitor_id();
		$visitor_ip = $this->get_visitor_ip();

		$data = array(
			'accountId' => $this->account_id,
			'visitorId' => $visitor_id,
			'type' => $type,
			'url' => home_url(add_query_arg(array())),
			'pageTitle' => wp_get_document_title(),
			'referrer' => isset($_SERVER['HTTP_REFERER']) ? esc_url_raw($_SERVER['HTTP_REFERER']) : '',
			'payload' => $payload,
			'serverSide' => true,
			'userAgent' => isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field($_SERVER['HTTP_USER_AGENT']) : '',
			'visitorIp' => $visitor_ip,
		);

		// Add 404 flag if this is an error page
		if ($is_404) {
			$data['is404'] = true;
		}

		// Add UTM parameters from URL or persisted cookie
		$utm = $this->get_utm_parameters();
		if (!empty($utm['source'])) {
			$data['utmSource'] = $utm['source'];
		}
		if (!empty($utm['medium'])) {
			$data['utmMedium'] = $utm['medium'];
		}
		if (!empty($utm['campaign'])) {
			$data['utmCampaign'] = $utm['campaign'];
		}

		$this->event_queue[] = $data;
	}

	/**
	 * Flush all queued events at shutdown.
	 * Uses non-blocking requests for performance on VPS,
	 * with 500ms timeout for shared hosting compatibility.
	 */
	public function flush_event_queue()
	{
		if (empty($this->event_queue)) {
			return;
		}

		foreach ($this->event_queue as $data) {
			$visitor_ip = $data['visitorIp'] ?? '';
			unset($data['visitorIp']); // Don't send in body, use headers

			$response = wp_remote_post($this->api_url . '/api/t/e', array(
				'timeout' => 0.5, // 500ms - fast for shared hosting
				'blocking' => false, // Non-blocking on VPS
				'headers' => array(
					'Content-Type' => 'application/json',
					'X-Forwarded-For' => $visitor_ip,
					'X-Real-IP' => $visitor_ip,
				),
				'body' => wp_json_encode($data),
			));

			// Log errors for debugging (only if WP_DEBUG is enabled)
			if (is_wp_error($response) && defined('WP_DEBUG') && WP_DEBUG) {
				error_log('OverSeek Tracking Error: ' . $response->get_error_message() . ' | Event: ' . $data['type']);
			}
		}

		// Clear queue after sending
		$this->event_queue = array();
	}

	public function track_pageview()
	{
		if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
			return;
		}

		// Skip pages where more specific events will fire
		// product_view, cart_view, checkout_view provide richer data
		if (is_product() || (function_exists('is_cart') && is_cart()) || (function_exists('is_checkout') && is_checkout())) {
			return;
		}

		// Detect 404 error pages
		$is_404 = is_404();

		$payload = array('page_type' => $is_404 ? '404' : $this->get_page_type());

		if (is_product()) {
			global $product;
			// Ensure $product is a valid WC_Product object (can be ID on some themes)
			if ($product && !is_object($product)) {
				$product = wc_get_product($product);
			}
			if ($product && is_object($product)) {
				$payload['productId'] = $product->get_id();
				$payload['productName'] = $product->get_name();
				$payload['productPrice'] = floatval($product->get_price());
			}
		}

		if (is_product_category()) {
			$term = get_queried_object();
			if ($term) {
				$payload['categoryId'] = $term->term_id;
				$payload['categoryName'] = $term->name;
			}
		}

		if (is_search()) {
			$payload['searchQuery'] = get_search_query();
		}

		$this->queue_event('pageview', $payload, $is_404);
	}

	private function get_page_type()
	{
		if (is_front_page())
			return 'home';
		if (is_product())
			return 'product';
		if (is_product_category())
			return 'category';
		if (is_cart())
			return 'cart';
		if (is_checkout())
			return 'checkout';
		if (is_account_page())
			return 'account';
		if (is_search())
			return 'search';
		if (is_shop())
			return 'shop';
		return 'other';
	}

	public function track_add_to_cart($cart_item_key, $product_id, $quantity, $variation_id, $variation, $cart_item_data)
	{
		$product = wc_get_product($product_id);
		$payload = array(
			'productId' => $product_id,
			'variationId' => $variation_id,
			'quantity' => $quantity,
			'name' => $product ? $product->get_name() : '',
			'price' => $product ? floatval($product->get_price()) : 0,
		);
		if (WC()->cart) {
			$payload['total'] = floatval(WC()->cart->get_cart_contents_total());
			$payload['itemCount'] = WC()->cart->get_cart_contents_count();
		}
		$this->queue_event('add_to_cart', $payload);
	}

	public function track_remove_from_cart($cart_item_key, $cart)
	{
		$removed_item = $cart->removed_cart_contents[$cart_item_key] ?? null;
		$payload = array();
		if ($removed_item) {
			$payload['productId'] = $removed_item['product_id'];
			$payload['quantity'] = $removed_item['quantity'];
		}
		if (WC()->cart) {
			$payload['total'] = floatval(WC()->cart->get_cart_contents_total());
			$payload['itemCount'] = WC()->cart->get_cart_contents_count();
		}
		$this->queue_event('remove_from_cart', $payload);
	}

	public function track_checkout_start()
	{
		$email = isset($_POST['billing_email']) ? sanitize_email($_POST['billing_email']) : '';
		$payload = array('email' => $email);
		if (WC()->cart) {
			$payload['total'] = floatval(WC()->cart->get_cart_contents_total());
			$payload['itemCount'] = WC()->cart->get_cart_contents_count();
		}
		$this->queue_event('checkout_start', $payload);
	}

	public function track_purchase($order_id)
	{
		if (!$order_id)
			return;
		$order = wc_get_order($order_id);
		if (!$order || $order->get_meta('_overseek_tracked'))
			return;

		$items = array();
		foreach ($order->get_items() as $item) {
			$product = $item->get_product();
			$items[] = array(
				'id' => $product ? $product->get_id() : 0,
				'sku' => $product ? $product->get_sku() : '',
				'name' => $item->get_name(),
				'quantity' => $item->get_quantity(),
				'price' => floatval($item->get_total()),
			);
		}

		$payload = array(
			'orderId' => $order_id,
			'total' => floatval($order->get_total()),
			'subtotal' => floatval($order->get_subtotal()),
			'tax' => floatval($order->get_total_tax()),
			'shipping' => floatval($order->get_shipping_total()),
			'currency' => $order->get_currency(),
			'items' => $items,
			'itemCount' => count($items),
			'email' => $order->get_billing_email(),
			'customerId' => $order->get_customer_id(),
			'paymentMethod' => $order->get_payment_method(),
			'couponCodes' => $order->get_coupon_codes(),
		);

		$this->queue_event('purchase', $payload);
		$order->update_meta_data('_overseek_tracked', true);
		$order->save();
	}

	/**
	 * Session Stitching: Track user login.
	 */
	public function track_identify($user_login, $user)
	{
		$payload = array(
			'customerId' => $user->ID,
			'email' => $user->user_email,
			'firstName' => get_user_meta($user->ID, 'first_name', true),
			'lastName' => get_user_meta($user->ID, 'last_name', true),
		);
		$this->queue_event('identify', $payload);
	}

	/**
	 * Track new customer registration.
	 */
	public function track_new_customer($customer_id, $new_customer_data, $password_generated)
	{
		$user = get_user_by('id', $customer_id);
		if (!$user)
			return;

		$payload = array(
			'customerId' => $customer_id,
			'email' => $user->user_email,
			'firstName' => get_user_meta($customer_id, 'first_name', true),
			'lastName' => get_user_meta($customer_id, 'last_name', true),
			'isNewCustomer' => true,
		);
		$this->queue_event('identify', $payload);
	}

	/**
	 * Track detailed product view.
	 */
	public function track_product_view()
	{
		global $product;

		// Ensure $product is a valid WC_Product object
		if (!$product) {
			return;
		}

		// If $product is an ID (int or string), convert to product object
		if (!is_object($product)) {
			$product = wc_get_product($product);
			if (!$product) {
				return;
			}
		}

		$categories = array();
		$terms = get_the_terms($product->get_id(), 'product_cat');
		if ($terms && !is_wp_error($terms)) {
			foreach ($terms as $term) {
				$categories[] = $term->name;
			}
		}

		$payload = array(
			'productId' => $product->get_id(),
			'productName' => $product->get_name(),
			'sku' => $product->get_sku(),
			'price' => floatval($product->get_price()),
			'regularPrice' => floatval($product->get_regular_price()),
			'salePrice' => $product->get_sale_price() ? floatval($product->get_sale_price()) : null,
			'inStock' => $product->is_in_stock(),
			'categories' => $categories,
			'productType' => $product->get_type(),
		);
		$this->queue_event('product_view', $payload);
	}

	/**
	 * Track cart page view with cart details.
	 */
	public function track_cart_view()
	{
		$payload = array();

		if (WC()->cart) {
			$payload['total'] = floatval(WC()->cart->get_cart_contents_total());
			$payload['itemCount'] = WC()->cart->get_cart_contents_count();
			$payload['currency'] = get_woocommerce_currency();

			// Include cart items summary
			$items = array();
			foreach (WC()->cart->get_cart() as $cart_item) {
				$product = $cart_item['data'];
				$items[] = array(
					'productId' => $cart_item['product_id'],
					'name' => $product ? $product->get_name() : '',
					'quantity' => $cart_item['quantity'],
					'price' => floatval($cart_item['line_total']),
				);
			}
			$payload['items'] = $items;
		}

		$this->queue_event('cart_view', $payload);
	}

	/**
	 * Track checkout page view (not processing, just viewing).
	 */
	public function track_checkout_view()
	{
		$payload = array();

		if (WC()->cart) {
			$payload['total'] = floatval(WC()->cart->get_cart_contents_total());
			$payload['itemCount'] = WC()->cart->get_cart_contents_count();
			$payload['currency'] = get_woocommerce_currency();
		}

		$this->queue_event('checkout_view', $payload);
	}

	/**
	 * Track A/B test experiment assignment.
	 */
	public static function track_experiment($experiment_id, $variation_id)
	{
		$instance = new self();
		$payload = array(
			'experimentId' => $experiment_id,
			'variationId' => $variation_id,
		);
		$instance->queue_event('experiment', $payload);
		$instance->flush_event_queue(); // Flush immediately for static calls
	}

	/**
	 * Track product review submission.
	 */
	public function track_review($comment_id, $comment_approved, $commentdata)
	{
		if ($comment_approved !== 1 && $comment_approved !== '1')
			return;

		$comment = get_comment($comment_id);
		if (!$comment)
			return;

		$post = get_post($comment->comment_post_ID);
		if (!$post || $post->post_type !== 'product')
			return;

		$product = wc_get_product($comment->comment_post_ID);
		$rating = get_comment_meta($comment_id, 'rating', true);

		$payload = array(
			'reviewId' => $comment_id,
			'productId' => $comment->comment_post_ID,
			'productName' => $product ? $product->get_name() : $post->post_title,
			'rating' => $rating ? intval($rating) : null,
			'reviewContent' => wp_trim_words($comment->comment_content, 50),
			'reviewerEmail' => $comment->comment_author_email,
			'reviewerName' => $comment->comment_author,
		);
		$this->queue_event('review', $payload);
	}
}

// Initialize Server-Side Tracking
if (get_option('overseek_enable_tracking')) {
	new OverSeek_Server_Tracking();
}


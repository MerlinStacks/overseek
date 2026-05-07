<?php
/**
 * Server-Side Analytics Tracking
 *
 * 100% server-side tracking via WooCommerce/WordPress hooks.
 * Unblockable by ad blockers since it runs entirely on the server.
 *
 * CACHING PLUGIN COMPATIBILITY (EDGE CASE FIX):
 * Some caching plugins may serve cached pages before the visitor ID cookie is set,
 * causing missed or fragmented visitor sessions. To prevent this:
 *
 * 1. Exclude "_os_vid" cookie from page cache key
 * 2. Exclude cart/checkout pages from full-page cache
 * 3. For LiteSpeed Cache, add to "Do Not Cache Cookies": _os_vid
 * 4. For WP Rocket, add to "Never Cache Cookies": _os_vid
 * 5. For W3 Total Cache, add to "Rejected cookies": _os_vid
 * 6. For WP Super Cache, enable "Don't cache pages with GET parameters"
 *
 * Alternatively, use the 'overseek_skip_tracking' filter to disable tracking
 * on specific cached pages:
 * add_filter('overseek_skip_tracking', function($skip) {
 *     return defined('DOING_CRON') || defined('LSCACHE_NO_CACHE');
 * });
 *
 * @package OverSeek
 * @since   1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Class OverSeek_Server_Tracking
 *
 * Handles server-side analytics tracking for WooCommerce events.
 * NO JAVASCRIPT REQUIRED - completely ad-blocker proof.
 *
 * @since 1.0.0
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
     * Guard flags to prevent duplicate event tracking per request.
     * Some WooCommerce hooks can fire multiple times per page load.
     */
    private $cart_view_tracked = false;
    private $checkout_view_tracked = false;
    private $last_rest_checkout_email = '';

    /**
     * Click ID parameter mapping for major ad platforms.
     * Key = URL parameter name, Value = platform identifier.
     */
    private static $click_id_params = array(
        'gclid' => 'google',    // Google Ads
        'gbraid' => 'google',    // Google Ads (iOS App campaigns)
        'wbraid' => 'google',    // Google Ads (web-to-app)
        'dclid' => 'google',    // Google Display & Video 360
        'fbclid' => 'facebook',  // Facebook/Meta Ads
        'msclkid' => 'microsoft', // Microsoft/Bing Ads
        'ttclid' => 'tiktok',    // TikTok Ads
        'twclid' => 'twitter',   // Twitter/X Ads
        'li_fat_id' => 'linkedin',  // LinkedIn Ads
        'epik' => 'pinterest', // Pinterest Ads
    );

    /**
     * Initialize hooks.
     */
    public function __construct()
    {
        $this->api_url = untrailingslashit(get_option('overseek_api_url', ''));
        $this->account_id = get_option('overseek_account_id');

        if (empty($this->account_id) || empty($this->api_url)) {
            return;
        }

        // CRITICAL: Initialize visitor cookie BEFORE any output is sent.
        // 'init' hook fires early enough that headers haven't been sent yet.
        // This ensures the cookie is properly set and persisted across requests.
        add_action('init', array($this, 'init_visitor_cookie'), 1);

        // Auto-configure cache plugin exclusions (LiteSpeed, WP Rocket, W3TC, etc.)
        add_action('init', array($this, 'configure_cache_exclusions'), 0);

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

        // Purchase completed - most important event (classic checkout)
        add_action('woocommerce_thankyou', array($this, 'track_purchase'), 10, 1);

        // WooCommerce Blocks checkout support (block-based checkout)
        // This hook fires when an order is placed via the Store API (Blocks checkout)
        add_action('woocommerce_store_api_checkout_order_processed', array($this, 'track_purchase_blocks'), 10, 1);

        // Session Stitching: Link visitor to customer on login
        add_action('wp_login', array($this, 'track_identify'), 10, 2);
        add_action('woocommerce_created_customer', array($this, 'track_new_customer'), 10, 3);

        // Cart View - track when cart page is viewed
        add_action('woocommerce_before_cart', array($this, 'track_cart_view'));

        // Checkout View - track when checkout page is viewed (not processing)
        add_action('woocommerce_before_checkout_form', array($this, 'track_checkout_view'));

        // Product View - detailed product tracking
        add_action('woocommerce_after_single_product', array($this, 'track_product_view'));

        // Review Tracking - when customers leave product reviews
        add_action('comment_post', array($this, 'track_review'), 10, 3);

        // WooCommerce Store API (Blocks) cart update support
        // The shutdown hook may not fire reliably for REST API requests,
        // so we hook into cart response to ensure events are sent
        add_filter('woocommerce_store_api_cart_response', array($this, 'flush_on_store_api_response'), 999, 2);

        // Capture checkout/customer email from WooCommerce Blocks Store API requests.
        add_filter('rest_pre_dispatch', array($this, 'maybe_capture_rest_checkout'), 5, 3);

        // Earlier checkout email capture for both classic and block checkout flows.
        add_action('wp_footer', array($this, 'inject_checkout_email_capture'), 20);
    }

    /**
     * Initialize the visitor cookie early, before any output is sent.
     * This MUST run before headers are sent to ensure cookies work.
     * Also persists UTM parameters in a session cookie for attribution tracking.
     */
    public function init_visitor_cookie()
    {
        // Skip admin, AJAX, and cron
        if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
            return;
        }

        // For REST requests: only allow WooCommerce Store API through (Blocks checkout).
        // Other REST endpoints (health check, settings) should be skipped.
        // During Store API requests, read existing cookies but don't set new ones
        // because response headers may already be committed.
        if (defined('REST_REQUEST') && REST_REQUEST) {
            if (!OverSeek_Tracking_Attribution_Utils::is_wc_store_api_request()) {
                return;
            }
            $cookie_name = '_os_vid';
            if (isset($_COOKIE[$cookie_name]) && !empty($_COOKIE[$cookie_name])) {
                $this->visitor_id = sanitize_text_field($_COOKIE[$cookie_name]);
            }
            return;
        }

        // Check consent before setting any cookies
        if (!$this->has_tracking_consent()) {
            return;
        }

        $cookie_name = '_os_vid';

        // Check if cookie already exists
        if (isset($_COOKIE[$cookie_name]) && !empty($_COOKIE[$cookie_name])) {
            $this->visitor_id = sanitize_text_field($_COOKIE[$cookie_name]);
        } else {
            // Generate new visitor ID
            $this->visitor_id = OverSeek_Tracking_Request_Utils::generate_uuid();

            // Set cookie with admin-configured retention period
        $expires = time() + OverSeek_Tracking_Guard_Utils::get_cookie_retention_seconds();
            OverSeek_Tracking_Request_Utils::set_cookie_safe($cookie_name, $this->visitor_id, $expires);
        }

        // Persist UTM parameters in session cookie if present in URL
        // This ensures attribution survives page navigation
        OverSeek_Tracking_Attribution_Utils::persist_utm_parameters();

        // Persist click ID from ad platforms (gclid, fbclid, etc.)
        OverSeek_Tracking_Attribution_Utils::persist_click_id(self::$click_id_params);

        // Persist landing page referrer (only if external)
        OverSeek_Tracking_Attribution_Utils::persist_landing_referrer();
    }


    /**
     * Auto-configure cache exclusions for popular caching plugins.
     * Ensures the _os_vid cookie isn't stripped and tracking pages aren't cached.
     *
     * Supports: LiteSpeed Cache, WP Rocket, W3 Total Cache, WP Super Cache,
     * WP Fastest Cache, SG Optimizer.
     */
    public function configure_cache_exclusions()
    {
        // LiteSpeed Cache: vary by our tracking cookie so each visitor
        // gets their own cached version
        if (defined('LSCWP_V')) {
            add_action('litespeed_vary_add', function () {
                if (function_exists('do_action')) {
                    do_action('litespeed_vary_append', '_os_vid');
                }
            });
        }

        // WP Rocket: add cookie to "Don't cache pages with these cookies"
        add_filter('rocket_cache_reject_cookies', function ($cookies) {
            $cookies[] = '_os_vid';
            $cookies[] = '_os_utm';
            $cookies[] = '_os_click';
            return $cookies;
        });

        // W3 Total Cache: add cookie to rejected cookies list
        add_filter('w3tc_rejected_cookies', function ($cookies) {
            if (!is_array($cookies)) {
                $cookies = array();
            }
            $cookies[] = '_os_vid';
            return $cookies;
        });

        // General: send Vary header so CDN/proxies vary cache by cookie
        if (!headers_sent() && !is_admin()) {
            header('Vary: Cookie', false);
        }
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
        $this->visitor_id = OverSeek_Tracking_Request_Utils::generate_uuid();

        // Attempt to set cookie - may fail if headers already sent
        if (!headers_sent()) {
            OverSeek_Tracking_Request_Utils::set_cookie_safe($cookie_name, $this->visitor_id, time() + OverSeek_Tracking_Guard_Utils::get_cookie_retention_seconds());
        }

        return $this->visitor_id;
    }

    /**
     * Safely get the WC cart instance.
     * Prevents fatal errors if WC is not fully loaded.
     *
     * @return WC_Cart|null Cart instance or null if unavailable
     */
    private function get_cart_safely()
    {
        if (!function_exists('WC') || !WC() || !WC()->cart) {
            return null;
        }
        return WC()->cart;
    }

    /**
     * Safely get a product by ID.
     * Returns null if product doesn't exist or WC is not loaded.
     *
     * @param int $product_id Product ID
     * @return WC_Product|null Product instance or null
     */
    private function get_product_safely($product_id)
    {
        if (!function_exists('wc_get_product')) {
            return null;
        }
        $product = wc_get_product($product_id);
        return ($product && is_object($product)) ? $product : null;
    }

    /**
     * Collects event data now, sends non-blocking at request end.
     *
     * @param string $type Event type (pageview, add_to_cart, etc.)
     * @param array $payload Event-specific data
     * @param bool $is_404 Whether this is a 404 error page
     */
    private function queue_event($type, $payload = array(), $is_404 = false)
    {
        // Skip if no consent
        if (!OverSeek_Tracking_Guard_Utils::has_tracking_consent()) {
            return;
        }

        // Skip wp-admin/wp-login referrer traffic (crawler bots probing admin endpoints)
        $http_referrer = isset($_SERVER['HTTP_REFERER']) ? strtolower($_SERVER['HTTP_REFERER']) : '';
        if (strpos($http_referrer, '/wp-admin/') !== false || strpos($http_referrer, '/wp-login.php') !== false) {
            return;
        }

        $visitor_id = $this->get_visitor_id();
        $visitor_ip = OverSeek_Tracking_Request_Utils::resolve_visitor_ip();
        $referrer_data = OverSeek_Tracking_Request_Utils::get_referrer_data();

        $data = array(
            'accountId' => $this->account_id,
            'visitorId' => $visitor_id,
            'type' => $type,
            'url' => OverSeek_Tracking_Request_Utils::get_sanitized_current_url(),
            'pageTitle' => wp_get_document_title(),
            'referrer' => $referrer_data['referrer'],
            'referrerDomain' => $referrer_data['referrerDomain'],
            'referrerType' => $referrer_data['referrerType'],
            'payload' => $payload,
            'serverSide' => true,
            'userAgent' => isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field($_SERVER['HTTP_USER_AGENT']) : '',
            'visitorIp' => $visitor_ip,
        );

        // Add 404 flag if this is an error page
        if ($is_404) {
            $data['is404'] = true;
        }

        // Enrich with logged-in user data for session stitching
        $user_data = OverSeek_Tracking_Request_Utils::get_logged_in_user_data();
        if (!empty($user_data)) {
            $data = array_merge($data, $user_data);
        }

        // Add UTM parameters from URL or persisted cookie
        $utm = OverSeek_Tracking_Attribution_Utils::get_utm_parameters();
        if (!empty($utm['source'])) {
            $data['utmSource'] = $utm['source'];
        }
        if (!empty($utm['medium'])) {
            $data['utmMedium'] = $utm['medium'];
        }
        if (!empty($utm['campaign'])) {
            $data['utmCampaign'] = $utm['campaign'];
        }

        // Add click ID from ad platforms (gclid, fbclid, msclkid, etc.)
        $click_data = OverSeek_Tracking_Attribution_Utils::get_click_data(self::$click_id_params);
        if (!empty($click_data['id'])) {
            $data['clickId'] = $click_data['id'];
            $data['clickPlatform'] = $click_data['platform'];
        }

        // Add persisted landing referrer (original external referrer)
        $landing_referrer = OverSeek_Tracking_Attribution_Utils::get_landing_referrer();
        if (!empty($landing_referrer)) {
            $data['landingReferrer'] = $landing_referrer;
        }

        $this->event_queue[] = $data;
    }

    /**
     * Flush all queued events at shutdown.
     * Uses blocking requests during AJAX (where shutdown may not complete),
     * and non-blocking for regular page loads.
     */
    public function flush_event_queue()
    {
        // Get any failed events from previous requests to retry
        $retry_events = OverSeek_Tracking_Transport::get_failed_events_for_retry();

        // Merge retry events with current queue
        $all_events = array_merge($retry_events, $this->event_queue);

        if (empty($all_events)) {
            return;
        }

        OverSeek_Tracking_Transport::flush_events($this->api_url, $all_events);

        // Clear queue after sending
        $this->event_queue = array();
    }

    /**
     * Flush events when WooCommerce Store API responds.
     * This ensures events are sent during REST API requests (WooCommerce Blocks)
     * where the shutdown hook may not fire reliably.
     *
     * @param array $response The Store API cart response
     * @param WC_Cart $cart The cart instance
     * @return array The unmodified response
     */
    public function flush_on_store_api_response($response, $cart)
    {
        // Only flush if there are queued events
        if (!empty($this->event_queue)) {
            // Debug logging
            if (defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
                error_log('OverSeek: Store API response intercepted, flushing ' . count($this->event_queue) . ' events');
            }

            $this->flush_event_queue();
        }

        return $response;
    }

    public function maybe_capture_rest_checkout($result, $server, $request)
    {
        if (!$request || !method_exists($request, 'get_route')) {
            return $result;
        }

        $route = $request->get_route();
        $is_checkout_route = (
            strpos($route, '/wc/store/v1/checkout') !== false ||
            strpos($route, '/wc/store/checkout') !== false ||
            strpos($route, '/wc/store/v1/cart/update-customer') !== false ||
            strpos($route, '/wc/store/cart/update-customer') !== false
        );

        if (!$is_checkout_route) {
            return $result;
        }

        $params = $request->get_json_params();
        if (!is_array($params)) {
            return $result;
        }

        $email = OverSeek_Tracking_Payload_Utils::extract_checkout_email_from_rest_params($params);
        if (empty($email) || $email === $this->last_rest_checkout_email) {
            return $result;
        }

        $cart = $this->get_cart_safely();
        if (!$cart || $cart->is_empty()) {
            return $result;
        }

        $this->last_rest_checkout_email = $email;

        $payload = OverSeek_Tracking_Event_Builder::build_checkout_start_payload(
            $email,
            $cart,
            'os_store_api_' . time() . '_' . wp_generate_password(6, false, false),
            null,
            'store_api_checkout'
        );
        $this->queue_event('checkout_start', $payload);

        return $result;
    }

    /**
     * Track pageview on every page load.
     */
    public function track_pageview()
    {
        // Skip admin pages
        if (is_admin()) {
            return;
        }

        // Skip AJAX requests
        if (wp_doing_ajax()) {
            return;
        }

        // Skip cron
        if (wp_doing_cron()) {
            return;
        }

        // Skip REST API requests
        if (defined('REST_REQUEST') && REST_REQUEST) {
            return;
        }

        // Skip bot/crawler requests to improve data quality
        if (OverSeek_Tracking_Guard_Utils::is_bot_request()) {
            return;
        }

        // Skip static resource requests (JS, CSS, images, etc.)
        if (OverSeek_Tracking_Guard_Utils::is_static_resource()) {
            return;
        }

        // Skip pages where more specific events will fire
        // product_view, cart_view, checkout_view, purchase provide richer data
        if (is_product() || (function_exists('is_cart') && is_cart()) || (function_exists('is_checkout') && is_checkout())) {
            return;
        }

        // Skip order-received (thank-you) page - the 'purchase' event already tracks this
        if (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received')) {
            return;
        }

        // Detect 404 error pages
        $is_404 = is_404();

        $payload = array(
            'page_type' => $is_404 ? '404' : OverSeek_Tracking_Guard_Utils::get_page_type(),
        );

        // Add product info if on product page
        if (is_product()) {
            global $product;
            if ($product) {
                $payload['productId'] = $product->get_id();
                $payload['productName'] = $product->get_name();
                $payload['productPrice'] = floatval($product->get_price());
            }
        }

        // Add category info
        if (is_product_category()) {
            $term = get_queried_object();
            if ($term) {
                $payload['categoryId'] = $term->term_id;
                $payload['categoryName'] = $term->name;
            }
        }

        // Add search query
        if (is_search()) {
            $payload['searchQuery'] = get_search_query();
        }

        $this->queue_event('pageview', $payload, $is_404);
    }

    /**
     * Track add to cart.
     */
    public function track_add_to_cart($cart_item_key, $product_id, $quantity, $variation_id, $variation, $cart_item_data)
    {
        $product = $this->get_product_safely($product_id);
        $request_event_id = $this->get_request_event_id();

        $payload = OverSeek_Tracking_Event_Builder::build_add_to_cart_payload(
            (int) $product_id,
            (int) $variation_id,
            (int) $quantity,
            $product,
            $this->get_cart_safely(),
            $request_event_id ?: wp_generate_uuid4()
        );

        $this->queue_event('add_to_cart', $payload);
    }

    /**
     * Track remove from cart.
     */
    public function track_remove_from_cart($cart_item_key, $cart)
    {
        $removed_item = $cart->removed_cart_contents[$cart_item_key] ?? null;

        $product = $removed_item ? $this->get_product_safely($removed_item['product_id']) : null;
        $payload = OverSeek_Tracking_Event_Builder::build_remove_from_cart_payload($removed_item, $product, $this->get_cart_safely());

        $this->queue_event('remove_from_cart', $payload);
    }

    /**
     * Track checkout start.
     */
    public function track_checkout_start()
    {
        $email = isset($_POST['billing_email']) ? sanitize_email($_POST['billing_email']) : '';
        $request_event_id = $this->get_request_event_id();

        $cart = $this->get_cart_safely();
        $fp_score = null;
        if (class_exists('OverSeek_Fingerprint')) {
            $fp_score = OverSeek_Fingerprint::get_score();
        }

        $payload = OverSeek_Tracking_Event_Builder::build_checkout_start_payload(
            $email,
            $cart,
            $request_event_id ?: wp_generate_uuid4(),
            $fp_score
        );

        $this->queue_event('checkout_start', $payload);
    }

    public function inject_checkout_email_capture()
    {
        if (!function_exists('is_checkout') || !is_checkout() || is_order_received_page()) {
            return;
        }

        $visitor_id = $this->get_visitor_id();
        if (empty($visitor_id)) {
            return;
        }

        $cart = $this->get_cart_safely();
        if (!$cart || $cart->is_empty()) {
            return;
        }

        $payload = OverSeek_Tracking_Event_Builder::build_checkout_capture_event(
            $this->account_id,
            $visitor_id,
            function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : home_url('/checkout/'),
            $cart
        );

        ?>
        <script>
        (function(){
            const endpoint = <?php echo wp_json_encode($this->api_url . '/api/t/e'); ?>;
            const basePayload = <?php echo wp_json_encode($payload); ?>;
            const selectors = [
                'input[name="billing_email"]',
                '#billing_email',
                'input[type="email"][name="email"]',
                'input[type="email"][autocomplete="email"]',
                'input[type="email"]'
            ];
            const sentEmails = new Set();
            let debounceTimer = null;

            function isValidEmail(email) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            }

            function sendEmailCapture(email) {
                const normalized = String(email || '').trim().toLowerCase();
                if (!isValidEmail(normalized) || sentEmails.has(normalized)) {
                    return;
                }

                sentEmails.add(normalized);
                const body = JSON.stringify({
                    ...basePayload,
                    payload: {
                        ...basePayload.payload,
                        email: normalized,
                        eventId: `os_checkout_capture_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
                    }
                });

                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                    credentials: 'omit'
                }).catch(function(){});
            }

            function scheduleSend(value) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() {
                    sendEmailCapture(value);
                }, 800);
            }

            function bindInput(input) {
                if (!input || input.dataset.overseekEmailBound === '1') {
                    return;
                }

                input.dataset.overseekEmailBound = '1';
                input.addEventListener('input', function(e) {
                    scheduleSend(e.target && e.target.value ? e.target.value : '');
                });
                input.addEventListener('change', function(e) {
                    sendEmailCapture(e.target && e.target.value ? e.target.value : '');
                });
                input.addEventListener('blur', function(e) {
                    sendEmailCapture(e.target && e.target.value ? e.target.value : '');
                });

                if (input.value) {
                    scheduleSend(input.value);
                }
            }

            function bindKnownInputs(root) {
                selectors.forEach(function(selector) {
                    (root || document).querySelectorAll(selector).forEach(bindInput);
                });
            }

            bindKnownInputs(document);

            const observer = new MutationObserver(function() {
                bindKnownInputs(document);
            });
            observer.observe(document.body, { childList: true, subtree: true });
        })();
        </script>
        <?php
    }

    /**
     * Track purchase completion.
     */
    public function track_purchase($order_id)
    {
        if (!$order_id) {
            return;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        // Prevent duplicate tracking
        if ($order->get_meta('_overseek_tracked')) {
            return;
        }

        $event_id = OverSeek_Tracking_Event_Builder::ensure_order_event_id($order);
        $payload = OverSeek_Tracking_Event_Builder::build_purchase_payload($order, (int) $order_id, $event_id);

        $this->queue_event('purchase', $payload);

        // Mark as tracked to prevent duplicates
        $order->update_meta_data('_overseek_tracked', true);
        $order->save();
    }

    /**
     * Track purchase completion via WooCommerce Blocks Store API.
     * This hook receives an order object directly, not an order ID.
     *
     * @param WC_Order $order The order object from Store API checkout
     */
    public function track_purchase_blocks($order)
    {
        if (!$order || !is_object($order)) {
            return;
        }

        // Delegate to standard purchase tracking using order ID
        $this->track_purchase($order->get_id());
    }

    /**
     * Session Stitching: Track user login to link visitor ID with customer.
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
        if (!$user) {
            return;
        }

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

        // Validate product object - may be null or an ID on some themes
        if (!$product) {
            return;
        }

        // If $product is an ID, convert to product object
        if (!is_object($product)) {
            $product = $this->get_product_safely($product);
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

        $payload = OverSeek_Tracking_Event_Builder::build_product_view_payload($product, $categories, $this->get_visitor_id());

        $this->queue_event('product_view', $payload);
    }

    /**
     * Track cart page view with cart details.
     */
    public function track_cart_view()
    {
        // Guard: Prevent duplicate tracking if hook fires multiple times
        if ($this->cart_view_tracked) {
            return;
        }
        $this->cart_view_tracked = true;

        // Signal to CDN/reverse proxy not to cache this page
        if (!headers_sent()) {
            header('Cache-Control: no-cache, no-store, must-revalidate', false);
            header('X-OverSeek-NoCache: 1', false);
        }

        $payload = OverSeek_Tracking_Event_Builder::build_cart_view_payload($this->get_cart_safely());

        $this->queue_event('cart_view', $payload);
    }


    /**
     * Track checkout page view (not processing, just viewing).
     */
    public function track_checkout_view()
    {
        // Guard: Prevent duplicate tracking if hook fires multiple times
        if ($this->checkout_view_tracked) {
            return;
        }
        $this->checkout_view_tracked = true;

        // Signal to CDN/reverse proxy not to cache this page
        if (!headers_sent()) {
            header('Cache-Control: no-cache, no-store, must-revalidate', false);
            header('X-OverSeek-NoCache: 1', false);
        }

        $payload = OverSeek_Tracking_Event_Builder::build_checkout_view_payload($this->get_cart_safely());

        $this->queue_event('checkout_view', $payload);
    }

    /**
     * Track A/B test experiment assignment.
     * Call this from your theme/plugin when assigning a user to a variation.
     *
     * Example: OverSeek_Server_Tracking::track_experiment('header_test', 'variation_b');
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
        // Only track approved product reviews
        if ($comment_approved !== 1 && $comment_approved !== '1') {
            return;
        }

        $comment = get_comment($comment_id);
        if (!$comment) {
            return;
        }

        // Check if this is a product review (comment type = 'review' or on a product post)
        $post = get_post($comment->comment_post_ID);
        if (!$post || $post->post_type !== 'product') {
            return;
        }

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


    /**
     * Parse and validate inbound event ID from checkout/add-to-cart request params.
     */
    private function get_request_event_id()
    {
        $raw = OverSeek_Tracking_Request_Utils::get_request_param_value('overseek_event_id');

        if (empty($raw)) {
            $raw = OverSeek_Tracking_Request_Utils::get_request_param_value('os_eid');
        }

        if (empty($raw)) {
            return '';
        }

        // Allow UUID or prefixed hash IDs (e.g. os_xxx) up to 100 chars.
        if (preg_match('/^[A-Za-z0-9_-]{8,100}$/', $raw)) {
            return $raw;
        }

        return '';
    }

}


<?php
/**
 * Server-Side Analytics Tracking
 *
 * 100% server-side tracking via WooCommerce/WordPress hooks.
 * Unblockable by ad blockers since it runs entirely on the server.
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
            $this->visitor_id = $this->generate_uuid();

            // Set cookie with admin-configured retention period
            $expires = time() + $this->get_cookie_retention_seconds();
            $this->set_cookie_safe($cookie_name, $this->visitor_id, $expires);
        }

        // Persist UTM parameters in session cookie if present in URL
        // This ensures attribution survives page navigation
        $this->persist_utm_parameters();

        // Persist click ID from ad platforms (gclid, fbclid, etc.)
        $this->persist_click_id();

        // Persist landing page referrer (only if external)
        $this->persist_landing_referrer();
    }

    /**
     * Persist UTM/MTM parameters from URL into a session cookie.
     * Only updates if new params are present in the URL (first-touch on landing).
     * MTM (Matomo Tracking Manager) parameters are treated as aliases for UTM.
     */
    private function persist_utm_parameters()
    {
        $utm_cookie = '_os_utm';
        $utm_params = array();

        // Check if new UTM or MTM parameters are in the current URL
        // MTM is Matomo's rename of UTM parameters
        $has_new_utm = isset($_GET['utm_source']) || isset($_GET['utm_medium']) ||
            isset($_GET['utm_campaign']) || isset($_GET['utm_content']) ||
            isset($_GET['utm_term']) ||
            isset($_GET['mtm_source']) || isset($_GET['mtm_medium']) ||
            isset($_GET['mtm_campaign']) || isset($_GET['mtm_content']) ||
            isset($_GET['mtm_cid']);

        if ($has_new_utm) {
            // Capture parameters from URL (UTM takes precedence over MTM)
            // Source
            if (isset($_GET['utm_source'])) {
                $utm_params['source'] = sanitize_text_field($_GET['utm_source']);
            } elseif (isset($_GET['mtm_source'])) {
                $utm_params['source'] = sanitize_text_field($_GET['mtm_source']);
            }
            // Medium
            if (isset($_GET['utm_medium'])) {
                $utm_params['medium'] = sanitize_text_field($_GET['utm_medium']);
            } elseif (isset($_GET['mtm_medium'])) {
                $utm_params['medium'] = sanitize_text_field($_GET['mtm_medium']);
            }
            // Campaign
            if (isset($_GET['utm_campaign'])) {
                $utm_params['campaign'] = sanitize_text_field($_GET['utm_campaign']);
            } elseif (isset($_GET['mtm_campaign'])) {
                $utm_params['campaign'] = sanitize_text_field($_GET['mtm_campaign']);
            }
            // Content
            if (isset($_GET['utm_content'])) {
                $utm_params['content'] = sanitize_text_field($_GET['utm_content']);
            } elseif (isset($_GET['mtm_content'])) {
                $utm_params['content'] = sanitize_text_field($_GET['mtm_content']);
            }
            // Term (MTM uses mtm_cid for this)
            if (isset($_GET['utm_term'])) {
                $utm_params['term'] = sanitize_text_field($_GET['utm_term']);
            } elseif (isset($_GET['mtm_cid'])) {
                $utm_params['term'] = sanitize_text_field($_GET['mtm_cid']);
            }

            // Store in session cookie with SameSite=Lax
            $utm_json = wp_json_encode($utm_params);
            $this->set_cookie_safe($utm_cookie, $utm_json, 0);
        }
    }

    /**
     * Persist click ID from ad platforms (gclid, fbclid, etc.) into session cookie.
     */
    private function persist_click_id()
    {
        $click_cookie = '_os_click';

        // Check for any known click ID parameter
        foreach (self::$click_id_params as $param => $platform) {
            if (isset($_GET[$param]) && !empty($_GET[$param])) {
                $click_data = array(
                    'id' => sanitize_text_field($_GET[$param]),
                    'platform' => $platform,
                    'param' => $param,
                );
                $click_json = wp_json_encode($click_data);
                $this->set_cookie_safe($click_cookie, $click_json, 0);
                return; // Only capture first match
            }
        }
    }

    /**
     * Persist landing page referrer if it's from an external domain.
     */
    private function persist_landing_referrer()
    {
        $ref_cookie = '_os_lref';

        // Only set if cookie doesn't exist (first visit in session)
        if (isset($_COOKIE[$ref_cookie]) && !empty($_COOKIE[$ref_cookie])) {
            return;
        }

        $referrer = isset($_SERVER['HTTP_REFERER']) ? esc_url_raw($_SERVER['HTTP_REFERER']) : '';
        if (empty($referrer)) {
            return;
        }

        // Check if referrer is external (different domain)
        $site_host = wp_parse_url(home_url(), PHP_URL_HOST);
        $ref_host = wp_parse_url($referrer, PHP_URL_HOST);

        if ($ref_host && $ref_host !== $site_host) {
            $this->set_cookie_safe($ref_cookie, $referrer, 0);
        }
    }

    /**
     * Get persisted click ID data from cookie or URL.
     * @return array{id: string, platform: string}|array Empty array if none found.
     */
    private function get_click_data()
    {
        // URL takes precedence
        foreach (self::$click_id_params as $param => $platform) {
            if (isset($_GET[$param]) && !empty($_GET[$param])) {
                return array(
                    'id' => sanitize_text_field($_GET[$param]),
                    'platform' => $platform,
                );
            }
        }

        // Fall back to cookie
        $click_cookie = '_os_click';
        if (isset($_COOKIE[$click_cookie]) && !empty($_COOKIE[$click_cookie])) {
            $click_data = json_decode(stripslashes($_COOKIE[$click_cookie]), true);
            if (is_array($click_data) && !empty($click_data['id'])) {
                return array(
                    'id' => $click_data['id'],
                    'platform' => $click_data['platform'] ?? 'unknown',
                );
            }
        }

        return array();
    }

    /**
     * Get persisted landing page referrer from cookie.
     * @return string The original external referrer, or empty string.
     */
    private function get_landing_referrer()
    {
        $ref_cookie = '_os_lref';
        if (isset($_COOKIE[$ref_cookie]) && !empty($_COOKIE[$ref_cookie])) {
            return esc_url_raw(stripslashes($_COOKIE[$ref_cookie]));
        }
        return '';
    }

    /**
     * Get persisted UTM/MTM parameters from cookie or URL.
     * Returns array with source, medium, campaign, content, term keys (if set).
     * MTM (Matomo Tracking Manager) parameters are treated as aliases for UTM.
     */
    private function get_utm_parameters()
    {
        $utm_cookie = '_os_utm';

        // First check URL (takes precedence) - check both UTM and MTM
        $has_url_params = isset($_GET['utm_source']) || isset($_GET['utm_campaign']) ||
            isset($_GET['mtm_source']) || isset($_GET['mtm_campaign']);

        if ($has_url_params) {
            return array(
                'source' => isset($_GET['utm_source']) ? sanitize_text_field($_GET['utm_source'])
                    : (isset($_GET['mtm_source']) ? sanitize_text_field($_GET['mtm_source']) : null),
                'medium' => isset($_GET['utm_medium']) ? sanitize_text_field($_GET['utm_medium'])
                    : (isset($_GET['mtm_medium']) ? sanitize_text_field($_GET['mtm_medium']) : null),
                'campaign' => isset($_GET['utm_campaign']) ? sanitize_text_field($_GET['utm_campaign'])
                    : (isset($_GET['mtm_campaign']) ? sanitize_text_field($_GET['mtm_campaign']) : null),
                'content' => isset($_GET['utm_content']) ? sanitize_text_field($_GET['utm_content'])
                    : (isset($_GET['mtm_content']) ? sanitize_text_field($_GET['mtm_content']) : null),
                'term' => isset($_GET['utm_term']) ? sanitize_text_field($_GET['utm_term'])
                    : (isset($_GET['mtm_cid']) ? sanitize_text_field($_GET['mtm_cid']) : null),
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
     * Generate a cryptographically secure UUID v4.
     * Uses random_bytes() for security (PHP 7+).
     */
    private function generate_uuid()
    {
        // Use cryptographically secure random bytes
        $data = random_bytes(16);

        // Set version to 0100 (UUID v4)
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        // Set variant to 10xx
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
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
     * Check if the current request is from a known bot/crawler.
     * Skips tracking for bots to improve data quality.
     *
     * @return bool True if request is from a bot
     */
    private function is_bot_request()
    {
        $user_agent = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower($_SERVER['HTTP_USER_AGENT']) : '';

        if (empty($user_agent)) {
            return true; // No user agent = likely a bot
        }

        // Common bot patterns
        $bot_patterns = array(
            'googlebot',
            'bingbot',
            'slurp',
            'duckduckbot',
            'baiduspider',
            'yandexbot',
            'sogou',
            'exabot',
            'facebot',
            'ia_archiver',
            'mj12bot',
            'ahrefsbot',
            'semrushbot',
            'dotbot',
            'rogerbot',
            'screaming frog',
            'gtmetrix',
            'pingdom',
            'uptimerobot',
            'crawler',
            'spider',
            'bot/',
            '/bot',
            'headless',
            'phantomjs',
            'wget',
            'curl',
            'python-requests',
            'go-http-client',
            'apache-httpclient'
        );

        foreach ($bot_patterns as $pattern) {
            if (strpos($user_agent, $pattern) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if the current request is for a static resource.
     * These should not be tracked as pageviews.
     *
     * @return bool True if request is for a static resource
     */
    private function is_static_resource()
    {
        $request_uri = isset($_SERVER['REQUEST_URI']) ? strtolower($_SERVER['REQUEST_URI']) : '';

        // Remove query string for extension check
        $path = strtok($request_uri, '?');

        // Static file extensions to ignore
        $static_extensions = array(
            '.js',
            '.css',
            '.map',
            '.json',
            '.xml',
            '.jpg',
            '.jpeg',
            '.png',
            '.gif',
            '.svg',
            '.webp',
            '.ico',
            '.bmp',
            '.avif',
            '.woff',
            '.woff2',
            '.ttf',
            '.eot',
            '.otf',
            '.mp4',
            '.webm',
            '.mp3',
            '.ogg',
            '.wav',
            '.pdf',
            '.doc',
            '.docx',
            '.xls',
            '.xlsx',
            '.zip',
            '.tar',
            '.gz',
            '.rar'
        );

        foreach ($static_extensions as $ext) {
            if (substr($path, -strlen($ext)) === $ext) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the current page URL with sanitization.
     * Strips out data URI fragments and invalid path segments that can corrupt tracking.
     *
     * Data URIs (e.g. "image/svg+xml,%3...") can appear in REQUEST_URI when plugins
     * or themes improperly handle image loading, causing malformed URLs like:
     * "/order-confirmed/image/svg+xml,%3..."
     *
     * @return string Sanitized current page URL
     */
    private function get_sanitized_current_url()
    {
        $url = home_url(add_query_arg(array()));

        // Detect and strip data URI fragments in the path
        // Pattern: "image/" followed by mime-type indicators (svg+xml, png, jpeg, etc.)
        // These appear when image sources leak into the URL path
        $data_uri_patterns = array(
            '/\/image\/svg\+xml[,%].*$/i',           // SVG data URIs
            '/\/image\/png[,%].*$/i',                 // PNG data URIs
            '/\/image\/jpeg[,%].*$/i',                // JPEG data URIs
            '/\/image\/gif[,%].*$/i',                 // GIF data URIs
            '/\/image\/webp[,%].*$/i',                // WebP data URIs
            '/\/data:[^\/]*;base64[,%].*$/i',         // General base64 data URIs
        );

        foreach ($data_uri_patterns as $pattern) {
            $cleaned = preg_replace($pattern, '', $url);
            if ($cleaned !== $url) {
                // URL was cleaned - return the sanitized version
                return rtrim($cleaned, '/');
            }
        }

        return $url;
    }

    /**
     * Get logged-in user data for event enrichment.
     * Enables session stitching for authenticated users.
     *
     * @return array User data array (empty if not logged in)
     */
    private function get_logged_in_user_data()
    {
        if (!is_user_logged_in()) {
            return array();
        }

        $user = wp_get_current_user();
        if (!$user || !$user->ID) {
            return array();
        }

        return array(
            'customerId' => $user->ID,
            'email' => $user->user_email,
        );
    }

    /**
     * Parse and classify the referrer domain.
     * Helps with traffic source attribution.
     *
     * @return array Referrer data with domain and type
     */
    private function get_referrer_data()
    {
        $referrer = isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '';

        if (empty($referrer)) {
            return array('referrer' => '', 'referrerDomain' => '', 'referrerType' => 'direct');
        }

        $parsed = wp_parse_url($referrer);
        $domain = isset($parsed['host']) ? strtolower($parsed['host']) : '';

        // Classify referrer type
        $type = 'referral';
        $site_host = strtolower(wp_parse_url(home_url(), PHP_URL_HOST));

        if ($domain === $site_host || strpos($domain, $site_host) !== false) {
            $type = 'internal';
        } elseif (
            strpos($domain, 'google') !== false || strpos($domain, 'bing') !== false ||
            strpos($domain, 'yahoo') !== false || strpos($domain, 'duckduckgo') !== false
        ) {
            $type = 'organic';
        } elseif (
            strpos($domain, 'facebook') !== false || strpos($domain, 'instagram') !== false ||
            strpos($domain, 'twitter') !== false || strpos($domain, 'linkedin') !== false ||
            strpos($domain, 'pinterest') !== false || strpos($domain, 'tiktok') !== false
        ) {
            $type = 'social';
        }

        return array(
            'referrer' => esc_url_raw($referrer),
            'referrerDomain' => $domain,
            'referrerType' => $type,
        );
    }

    /**
     * Set a cookie with modern attributes including SameSite.
     * Provides better cross-browser compatibility.
     *
     * @param string $name Cookie name
     * @param string $value Cookie value
     * @param int $expires Expiration timestamp (0 for session)
     */
    private function set_cookie_safe($name, $value, $expires = 0)
    {
        if (headers_sent()) {
            return;
        }

        $secure = is_ssl();
        $samesite = 'Lax';

        // PHP 7.3+ supports options array with SameSite
        if (PHP_VERSION_ID >= 70300) {
            setcookie($name, $value, array(
                'expires' => $expires,
                'path' => '/',
                'domain' => '',
                'secure' => $secure,
                'httponly' => false,
                'samesite' => $samesite,
            ));
        } else {
            // Fallback for older PHP - SameSite via header hack
            setcookie($name, $value, $expires, '/; SameSite=' . $samesite, '', $secure, false);
        }

        $_COOKIE[$name] = $value;
    }

    /**
     * Check if we have consent to track the visitor.
     * Integrates with WP Consent API for GDPR compliance.
     *
     * @return bool True if tracking is allowed
     */
    private function has_tracking_consent()
    {
        // Allow filter to override consent check entirely
        if (!apply_filters('overseek_require_consent', get_option('overseek_require_consent', false))) {
            return true; // Consent not required
        }

        // Check WP Consent API if available
        if (function_exists('wp_has_consent')) {
            return wp_has_consent('statistics');
        }

        // If consent is required but WP Consent API is not installed,
        // default to no consent (safe approach for GDPR)
        return false;
    }

    /**
     * Get cookie retention period in seconds from admin settings.
     *
     * @return int Retention period in seconds
     */
    private function get_cookie_retention_seconds()
    {
        $days = absint(get_option('overseek_cookie_retention_days', 365));
        return $days * 24 * 60 * 60;
    }

    /**
     * Store a failed event in transient for retry on next page load.
     *
     * @param array $data Event data to store
     */
    private function store_failed_event($data)
    {
        $transient_key = '_overseek_failed_events';
        $failed_events = get_transient($transient_key);

        if (!is_array($failed_events)) {
            $failed_events = array();
        }

        // Add retry count to event
        if (!isset($data['_retry_count'])) {
            $data['_retry_count'] = 0;
        }

        // Only store if under max retries (3)
        if ($data['_retry_count'] < 3) {
            $data['_retry_count']++;
            $failed_events[] = $data;

            // Limit queue size to prevent memory issues
            if (count($failed_events) > 50) {
                $failed_events = array_slice($failed_events, -50);
            }

            set_transient($transient_key, $failed_events, HOUR_IN_SECONDS);
        }
    }

    /**
     * Retry sending failed events from previous requests.
     * Called during event flush to piggyback on current request.
     *
     * @return array Array of failed events to retry (removed from transient)
     */
    private function get_failed_events_for_retry()
    {
        $transient_key = '_overseek_failed_events';
        $failed_events = get_transient($transient_key);

        if (!is_array($failed_events) || empty($failed_events)) {
            return array();
        }

        // Clear the transient - we'll re-add any that fail again
        delete_transient($transient_key);

        return $failed_events;
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
        // Skip if no consent
        if (!$this->has_tracking_consent()) {
            return;
        }

        $visitor_id = $this->get_visitor_id();
        $visitor_ip = $this->get_visitor_ip();
        $referrer_data = $this->get_referrer_data();

        $data = array(
            'accountId' => $this->account_id,
            'visitorId' => $visitor_id,
            'type' => $type,
            'url' => $this->get_sanitized_current_url(),
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
        $user_data = $this->get_logged_in_user_data();
        if (!empty($user_data)) {
            $data = array_merge($data, $user_data);
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

        // Add click ID from ad platforms (gclid, fbclid, msclkid, etc.)
        $click_data = $this->get_click_data();
        if (!empty($click_data['id'])) {
            $data['clickId'] = $click_data['id'];
            $data['clickPlatform'] = $click_data['platform'];
        }

        // Add persisted landing referrer (original external referrer)
        $landing_referrer = $this->get_landing_referrer();
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
        $retry_events = $this->get_failed_events_for_retry();

        // Merge retry events with current queue
        $all_events = array_merge($retry_events, $this->event_queue);

        if (empty($all_events)) {
            return;
        }

        // During AJAX, use blocking with short timeout to ensure delivery
        // before wp_die() terminates the request
        $is_ajax = wp_doing_ajax();
        $is_rest = defined('REST_REQUEST') && REST_REQUEST;

        // RELIABILITY FIX: Always use blocking requests with reasonable timeout
        // Non-blocking wp_remote_post is unreliable - requests can be dropped
        // before the HTTP connection is established. The shutdown hook runs
        // AFTER output is sent, so blocking here doesn't affect user experience.
        $timeout = 2; // 2 seconds is enough for local/fast connections
        $blocking = true; // Always blocking for reliable delivery

        // Debug: Log queue flush attempt
        if (defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
            error_log('OverSeek: Flushing ' . count($all_events) . ' events (AJAX: ' . ($is_ajax ? 'yes' : 'no') . ', REST: ' . ($is_rest ? 'yes' : 'no') . ')');
        }

        foreach ($all_events as $data) {
            $visitor_ip = $data['visitorIp'] ?? '';
            $retry_count = $data['_retry_count'] ?? 0;
            $event_type = $data['type'] ?? 'unknown';
            unset($data['visitorIp']); // Don't send in body, use headers
            unset($data['_retry_count']); // Don't send retry metadata

            $response = wp_remote_post($this->api_url . '/api/t/e', array(
                'timeout' => $timeout,
                'blocking' => $blocking,
                'httpversion' => '1.1',
                'headers' => array(
                    'Content-Type' => 'application/json',
                    'X-Forwarded-For' => $visitor_ip,
                    'X-Real-IP' => $visitor_ip,
                    'Expect' => '', // CRITICAL: Prevents cURL from dropping large payloads (>1024 bytes)
                ),
                'body' => wp_json_encode($data),
            ));

            // Debug: Log result for blocking requests
            if ($blocking && defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
                if (is_wp_error($response)) {
                    error_log('OverSeek FAILED: ' . $event_type . ' - ' . $response->get_error_message());
                } else {
                    $code = wp_remote_retrieve_response_code($response);
                    $body = wp_remote_retrieve_body($response);
                    error_log('OverSeek OK: ' . $event_type . ' - HTTP ' . $code . ' - ' . substr($body, 0, 100));
                }
            }

            // On failure, store for retry (only for blocking requests where we can check)
            if ($blocking && is_wp_error($response)) {
                $data['visitorIp'] = $visitor_ip;
                $data['_retry_count'] = $retry_count;
                $this->store_failed_event($data);

                // Log errors for debugging (only if WP_DEBUG is enabled)
                if (defined('WP_DEBUG') && WP_DEBUG) {
                    error_log('OverSeek Tracking Error: ' . $response->get_error_message() . ' | Event: ' . $event_type . ' | Retry: ' . ($retry_count + 1));
                }
            }
        }

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
        if ($this->is_bot_request()) {
            return;
        }

        // Skip static resource requests (JS, CSS, images, etc.)
        if ($this->is_static_resource()) {
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
            'page_type' => $is_404 ? '404' : $this->get_page_type(),
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
     * Get the type of page being viewed.
     */
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

    /**
     * Track add to cart.
     */
    public function track_add_to_cart($cart_item_key, $product_id, $quantity, $variation_id, $variation, $cart_item_data)
    {
        $product = $this->get_product_safely($product_id);

        $payload = array(
            'productId' => $product_id,
            'variationId' => $variation_id,
            'quantity' => $quantity,
            'name' => $product ? $product->get_name() : '',
            'price' => $product ? floatval($product->get_price()) : 0,
        );

        // Get cart total using safe wrapper
        $cart = $this->get_cart_safely();
        if ($cart) {
            $payload['total'] = floatval($cart->get_cart_contents_total());
            $payload['itemCount'] = $cart->get_cart_contents_count();
        }

        $this->queue_event('add_to_cart', $payload);
    }

    /**
     * Track remove from cart.
     */
    public function track_remove_from_cart($cart_item_key, $cart)
    {
        $removed_item = $cart->removed_cart_contents[$cart_item_key] ?? null;

        $payload = array();

        if ($removed_item) {
            $product = $this->get_product_safely($removed_item['product_id']);

            $payload['productId'] = $removed_item['product_id'];
            $payload['variationId'] = $removed_item['variation_id'] ?? 0;
            $payload['quantity'] = $removed_item['quantity'];
            $payload['name'] = $product ? $product->get_name() : '';
            $payload['sku'] = $product ? $product->get_sku() : '';
            $payload['price'] = $product ? floatval($product->get_price()) : 0;
        }

        // Use safe cart wrapper
        $wc_cart = $this->get_cart_safely();
        if ($wc_cart) {
            $payload['total'] = floatval($wc_cart->get_cart_contents_total());
            $payload['itemCount'] = $wc_cart->get_cart_contents_count();
        }

        $this->queue_event('remove_from_cart', $payload);
    }

    /**
     * Track checkout start.
     */
    public function track_checkout_start()
    {
        $email = isset($_POST['billing_email']) ? sanitize_email($_POST['billing_email']) : '';

        $payload = array(
            'email' => $email,
        );

        // Use safe cart wrapper
        $cart = $this->get_cart_safely();
        if ($cart) {
            $payload['total'] = floatval($cart->get_cart_contents_total());
            $payload['itemCount'] = $cart->get_cart_contents_count();
        }

        $this->queue_event('checkout_start', $payload);
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
        // Guard: Prevent duplicate tracking if hook fires multiple times
        if ($this->cart_view_tracked) {
            return;
        }
        $this->cart_view_tracked = true;

        $payload = array();

        $cart = $this->get_cart_safely();
        if ($cart) {
            $payload['total'] = floatval($cart->get_cart_contents_total());
            $payload['itemCount'] = $cart->get_cart_contents_count();
            $payload['currency'] = function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : 'USD';

            // Include cart items summary
            $items = array();
            foreach ($cart->get_cart() as $cart_item) {
                $product = $cart_item['data'];
                $items[] = array(
                    'productId' => $cart_item['product_id'],
                    'name' => ($product && is_object($product)) ? $product->get_name() : '',
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
        // Guard: Prevent duplicate tracking if hook fires multiple times
        if ($this->checkout_view_tracked) {
            return;
        }
        $this->checkout_view_tracked = true;

        $payload = array();

        $cart = $this->get_cart_safely();
        if ($cart) {
            $payload['total'] = floatval($cart->get_cart_contents_total());
            $payload['itemCount'] = $cart->get_cart_contents_count();
            $payload['currency'] = function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : 'USD';
        }

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
}


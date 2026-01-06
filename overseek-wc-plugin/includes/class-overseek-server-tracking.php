<?php

if (!defined('ABSPATH')) {
    exit;
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

        // Pageview - fires on every page load
        add_action('template_redirect', array($this, 'track_pageview'));

        // Add to cart
        add_action('woocommerce_add_to_cart', array($this, 'track_add_to_cart'), 10, 6);

        // Remove from cart
        add_action('woocommerce_remove_cart_item', array($this, 'track_remove_from_cart'), 10, 2);

        // Checkout start
        add_action('woocommerce_checkout_process', array($this, 'track_checkout_start'));

        // Purchase completed - most important event
        add_action('woocommerce_thankyou', array($this, 'track_purchase'), 10, 1);

        // Session Stitching: Link visitor to customer on login
        add_action('wp_login', array($this, 'track_identify'), 10, 2);
        add_action('woocommerce_created_customer', array($this, 'track_new_customer'), 10, 3);

        // Product View - detailed product tracking
        add_action('woocommerce_after_single_product', array($this, 'track_product_view'));

        // Review Tracking - when customers leave product reviews
        add_action('comment_post', array($this, 'track_review'), 10, 3);
    }
    
    /**
     * Initialize the visitor cookie early, before any output is sent.
     * This MUST run before headers are sent to ensure cookies work.
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
            return;
        }
        
        // Generate new visitor ID
        $this->visitor_id = $this->generate_uuid();
        
        // Set cookie for 1 year - this works because we're in the 'init' hook
        // BEFORE any output has been sent
        setcookie(
            $cookie_name,
            $this->visitor_id,
            time() + (365 * 24 * 60 * 60),
            '/',
            '',
            is_ssl(),
            false  // httpOnly = false so JS can read it too
        );
        
        // Also set in $_COOKIE superglobal for immediate availability in this request
        $_COOKIE[$cookie_name] = $this->visitor_id;
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
     * Send tracking event to Overseek API (non-blocking).
     */
    private function send_event($type, $payload = array())
    {
        $visitor_id = $this->get_visitor_id();

        $data = array(
            'accountId' => $this->account_id,
            'visitorId' => $visitor_id,
            'type' => $type,
            'url' => home_url(add_query_arg(array())),
            'pageTitle' => wp_get_document_title(),
            'referrer' => isset($_SERVER['HTTP_REFERER']) ? esc_url_raw($_SERVER['HTTP_REFERER']) : '',
            'payload' => $payload,
            'serverSide' => true,
        );

        // Add UTM parameters if present
        if (isset($_GET['utm_source']))
            $data['utmSource'] = sanitize_text_field($_GET['utm_source']);
        if (isset($_GET['utm_medium']))
            $data['utmMedium'] = sanitize_text_field($_GET['utm_medium']);
        if (isset($_GET['utm_campaign']))
            $data['utmCampaign'] = sanitize_text_field($_GET['utm_campaign']);

        // Non-blocking request (fire and forget)
        wp_remote_post($this->api_url . '/api/t/e', array(
            'timeout' => 0.01, // Near-instant timeout for non-blocking
            'blocking' => false,
            'headers' => array('Content-Type' => 'application/json'),
            'body' => wp_json_encode($data),
        ));
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

        $payload = array(
            'page_type' => $this->get_page_type(),
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

        $this->send_event('pageview', $payload);
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
        $product = wc_get_product($product_id);

        $payload = array(
            'productId' => $product_id,
            'variationId' => $variation_id,
            'quantity' => $quantity,
            'name' => $product ? $product->get_name() : '',
            'price' => $product ? floatval($product->get_price()) : 0,
        );

        // Get cart total
        if (WC()->cart) {
            $payload['total'] = floatval(WC()->cart->get_cart_contents_total());
            $payload['itemCount'] = WC()->cart->get_cart_contents_count();
        }

        $this->send_event('add_to_cart', $payload);
    }

    /**
     * Track remove from cart.
     */
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

        $this->send_event('remove_from_cart', $payload);
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

        if (WC()->cart) {
            $payload['total'] = floatval(WC()->cart->get_cart_contents_total());
            $payload['itemCount'] = WC()->cart->get_cart_contents_count();
        }

        $this->send_event('checkout_start', $payload);
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

        $this->send_event('purchase', $payload);

        // Mark as tracked to prevent duplicates
        $order->update_meta_data('_overseek_tracked', true);
        $order->save();
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

        $this->send_event('identify', $payload);
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

        $this->send_event('identify', $payload);
    }

    /**
     * Track detailed product view.
     */
    public function track_product_view()
    {
        global $product;
        if (!$product) {
            return;
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

        $this->send_event('product_view', $payload);
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

        $instance->send_event('experiment', $payload);
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

        $this->send_event('review', $payload);
    }
}


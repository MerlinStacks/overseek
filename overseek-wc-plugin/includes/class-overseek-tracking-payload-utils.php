<?php
/**
 * Payload-building helpers for OverSeek server-side tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Payload_Utils
{
    /**
     * @param object $cart WooCommerce cart instance.
     * @return array<int, array<string, mixed>>
     */
    public static function get_cart_items_snapshot($cart, array $meta_config = array()): array
    {
        $items = array();

        foreach ($cart->get_cart() as $cart_item) {
            $product = $cart_item['data'] ?? null;
            $product_id = isset($cart_item['product_id']) ? absint($cart_item['product_id']) : 0;
            $variation_id = isset($cart_item['variation_id']) ? absint($cart_item['variation_id']) : 0;
            $quantity = isset($cart_item['quantity']) ? max(1, absint($cart_item['quantity'])) : 1;
            $line_total = isset($cart_item['line_total']) ? floatval($cart_item['line_total']) : 0;
            $unit_price = $quantity > 0 ? $line_total / $quantity : 0;
            $items[] = array(
                'id' => $variation_id ?: $product_id,
                'productId' => $product_id,
                'variationId' => $variation_id,
                'contentId' => ($product instanceof WC_Product) ? OverSeek_Pixel_Matching_Utils::get_content_id($product, array('meta' => $meta_config)) : (string) ($variation_id ?: $product_id),
                'name' => ($product && is_object($product)) ? $product->get_name() : '',
                'sku' => ($product && is_object($product) && method_exists($product, 'get_sku')) ? $product->get_sku() : '',
                'quantity' => $quantity,
                'price' => $unit_price,
                'total' => $line_total,
            );
        }

        return $items;
    }

    /**
     * @param array<string, mixed> $params
     */
    public static function extract_checkout_email_from_rest_params(array $params): string
    {
        $candidates = array(
            $params['email'] ?? null,
            $params['billing_email'] ?? null,
            $params['billingAddress']['email'] ?? null,
            $params['billing_address']['email'] ?? null,
            $params['customer']['billing_address']['email'] ?? null,
        );

        foreach ($candidates as $candidate) {
            $email = is_string($candidate) ? sanitize_email($candidate) : '';
            if (!empty($email) && is_email($email)) {
                return strtolower($email);
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function attach_platform_cookies(array $payload): array
    {
        $cookie_map = array(
            '_fbc' => 'fbc',
            '_fbp' => 'fbp',
            '_ttp' => 'ttp',
            '_epq' => 'epq',
            '_ga' => 'gaClientId',
            '_scid' => 'sclid',
            '_uetmsclkid' => 'msclkid',
            'twclid' => 'twclid',
        );

        foreach ($cookie_map as $cookie_name => $payload_key) {
            if (!isset($_COOKIE[$cookie_name])) {
                continue;
            }

            $payload[$payload_key] = sanitize_text_field((string) $_COOKIE[$cookie_name]);
        }

        return $payload;
    }

    /**
     * Attach available WooCommerce customer identity to a server event.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function attach_customer_identity(array $payload): array
    {
        $user = wp_get_current_user();
        $customer = function_exists('WC') && WC() ? WC()->customer : null;
        $email = ($user && $user->ID > 0) ? (string) $user->user_email : '';
        if ($email === '' && $customer) {
            $email = (string) $customer->get_billing_email();
        }

        $payload['email'] = strtolower(trim($email));
        $payload['billingPhone'] = $customer ? trim((string) $customer->get_billing_phone()) : '';
        $payload['billingFirst'] = $customer ? trim((string) $customer->get_billing_first_name()) : '';
        $payload['billingLast'] = $customer ? trim((string) $customer->get_billing_last_name()) : '';
        $payload['billingCity'] = $customer ? trim((string) $customer->get_billing_city()) : '';
        $payload['billingState'] = $customer ? trim((string) $customer->get_billing_state()) : '';
        $payload['billingZip'] = $customer ? trim((string) $customer->get_billing_postcode()) : '';
        $payload['billingCountry'] = $customer ? strtoupper(trim((string) $customer->get_billing_country())) : '';

        return $payload;
    }

    public static function issue_product_view_event_id(int $product_id): string
    {
        static $request_ids = array();
        if (isset($request_ids[$product_id])) {
            return $request_ids[$product_id];
        }

        $event_id = 'os_pv_' . str_replace('-', '', wp_generate_uuid4());
        $request_ids[$product_id] = $event_id;

        if (!headers_sent()) {
            OverSeek_Tracking_Request_Utils::set_cookie_safe('_os_pv_eid', $product_id . '|' . $event_id, time() + 300);
        }

        return $event_id;
    }

    public static function issue_search_event_id(string $query): string
    {
        static $request_ids = array();
        $query_key = md5(strtolower(trim($query)));
        if (isset($request_ids[$query_key])) {
            return $request_ids[$query_key];
        }

        $event_id = 'os_search_' . str_replace('-', '', wp_generate_uuid4());
        $request_ids[$query_key] = $event_id;
        if (!headers_sent()) {
            OverSeek_Tracking_Request_Utils::set_cookie_safe('_os_search_eid', $query_key . '|' . $event_id, time() + 300);
        }
        return $event_id;
    }
}

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
    public static function get_cart_items_snapshot($cart): array
    {
        $items = array();

        foreach ($cart->get_cart() as $cart_item) {
            $product = $cart_item['data'] ?? null;
            $items[] = array(
                'productId' => isset($cart_item['product_id']) ? absint($cart_item['product_id']) : 0,
                'variationId' => isset($cart_item['variation_id']) ? absint($cart_item['variation_id']) : 0,
                'name' => ($product && is_object($product)) ? $product->get_name() : '',
                'sku' => ($product && is_object($product) && method_exists($product, 'get_sku')) ? $product->get_sku() : '',
                'quantity' => isset($cart_item['quantity']) ? absint($cart_item['quantity']) : 1,
                'price' => isset($cart_item['line_total']) ? floatval($cart_item['line_total']) : 0,
                'total' => isset($cart_item['line_total']) ? floatval($cart_item['line_total']) : 0,
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

    public static function get_shared_product_view_event_id(int $product_id, ?string $visitor_id): string
    {
        $material = implode('|', array('overseek', 'product_view', (string) $product_id, (string) $visitor_id));

        return 'os_pv_' . substr(hash('sha256', $material), 0, 32);
    }
}

<?php
/**
 * Event payload builders for OverSeek tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Event_Builder
{
    public static function get_currency(): string
    {
        return function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : 'USD';
    }

    /**
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_add_to_cart_payload(int $product_id, int $variation_id, int $quantity, $product, $cart, string $event_id): array
    {
        $payload = array(
            'productId' => $product_id,
            'variationId' => $variation_id,
            'quantity' => $quantity,
            'name' => ($product && is_object($product)) ? $product->get_name() : '',
            'price' => ($product && is_object($product)) ? floatval($product->get_price()) : 0,
            'currency' => self::get_currency(),
            'eventId' => $event_id,
        );

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies(self::add_cart_totals($payload, $cart));
    }

    /**
     * @param array<string, mixed>|null $removed_item
     * @param object|null $product WooCommerce product instance.
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_remove_from_cart_payload(?array $removed_item, $product, $cart): array
    {
        $payload = array();

        if (is_array($removed_item)) {
            $payload['productId'] = isset($removed_item['product_id']) ? absint($removed_item['product_id']) : 0;
            $payload['variationId'] = isset($removed_item['variation_id']) ? absint($removed_item['variation_id']) : 0;
            $payload['quantity'] = isset($removed_item['quantity']) ? absint($removed_item['quantity']) : 1;
            $payload['name'] = ($product && is_object($product)) ? $product->get_name() : '';
            $payload['sku'] = ($product && is_object($product) && method_exists($product, 'get_sku')) ? $product->get_sku() : '';
            $payload['price'] = ($product && is_object($product)) ? floatval($product->get_price()) : 0;
            $payload['currency'] = self::get_currency();
        }

        return self::add_cart_totals($payload, $cart);
    }

    /**
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_checkout_start_payload(string $email, $cart, string $event_id, ?float $fp_score = null, string $source = ''): array
    {
        $payload = array(
            'email' => $email,
            'currency' => self::get_currency(),
            'eventId' => $event_id,
        );

        if ($source !== '') {
            $payload['source'] = $source;
        }

        $payload = self::add_cart_totals($payload, $cart, true);

        if ($fp_score !== null) {
            $payload['fpScore'] = $fp_score;
        }

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload);
    }

    /**
     * @param object $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_checkout_capture_event(string $account_id, string $visitor_id, string $checkout_url, $cart): array
    {
        return array(
            'accountId' => $account_id,
            'visitorId' => $visitor_id,
            'type' => 'checkout_start',
            'url' => $checkout_url,
            'payload' => array(
                'currency' => self::get_currency(),
                'total' => floatval($cart->get_cart_contents_total()),
                'itemCount' => $cart->get_cart_contents_count(),
                'items' => OverSeek_Tracking_Payload_Utils::get_cart_items_snapshot($cart),
                'source' => 'checkout_email_capture',
                'eventId' => wp_generate_uuid4(),
            ),
        );
    }

    /**
     * @param object $order WooCommerce order instance.
     */
    public static function ensure_order_event_id($order): string
    {
        $event_id = (string) $order->get_meta('_overseek_event_id');

        if ($event_id === '') {
            $event_id = wp_generate_uuid4();
            $order->update_meta_data('_overseek_event_id', $event_id);
            $order->save();
        }

        return $event_id;
    }

    /**
     * @param object $order WooCommerce order instance.
     * @return array<string, mixed>
     */
    public static function build_purchase_payload($order, int $order_id, string $event_id): array
    {
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
            'eventId' => $event_id,
            'billingPhone' => $order->get_billing_phone(),
            'billingCity' => $order->get_billing_city(),
            'billingState' => $order->get_billing_state(),
            'billingZip' => $order->get_billing_postcode(),
            'billingCountry' => $order->get_billing_country(),
            'billingFirst' => $order->get_billing_first_name(),
            'billingLast' => $order->get_billing_last_name(),
        );

        $recovery_enrollment_id = $order->get_meta('_overseek_recovery_enrollment_id');
        $recovery_session_id = $order->get_meta('_overseek_recovery_session_id');

        if (!empty($recovery_enrollment_id)) {
            $payload['recoveryEnrollmentId'] = (string) $recovery_enrollment_id;
            $payload['recoveredCart'] = true;
        }

        if (!empty($recovery_session_id)) {
            $payload['recoverySessionId'] = (string) $recovery_session_id;
        }

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload);
    }

    /**
     * @param object $product WooCommerce product instance.
     * @return array<string, mixed>
     */
    public static function build_product_view_payload($product, array $categories, ?string $visitor_id): array
    {
        $payload = array(
            'productId' => $product->get_id(),
            'productName' => $product->get_name(),
            'sku' => $product->get_sku(),
            'price' => floatval($product->get_price()),
            'regularPrice' => floatval($product->get_regular_price()),
            'salePrice' => $product->get_sale_price() ? floatval($product->get_sale_price()) : null,
            'currency' => self::get_currency(),
            'inStock' => $product->is_in_stock(),
            'categories' => $categories,
            'productType' => $product->get_type(),
            'eventId' => OverSeek_Tracking_Payload_Utils::get_shared_product_view_event_id((int) $product->get_id(), $visitor_id),
        );

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload);
    }

    /**
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_cart_view_payload($cart): array
    {
        $payload = array();

        if (!$cart) {
            return $payload;
        }

        $payload = self::add_cart_totals($payload, $cart);
        $items = array();

        foreach ($cart->get_cart() as $cart_item) {
            $product = $cart_item['data'] ?? null;
            $items[] = array(
                'productId' => isset($cart_item['product_id']) ? absint($cart_item['product_id']) : 0,
                'name' => ($product && is_object($product)) ? $product->get_name() : '',
                'quantity' => isset($cart_item['quantity']) ? absint($cart_item['quantity']) : 1,
                'price' => isset($cart_item['line_total']) ? floatval($cart_item['line_total']) : 0,
            );
        }

        $payload['items'] = $items;

        return $payload;
    }

    /**
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_checkout_view_payload($cart): array
    {
        return self::add_cart_totals(array(), $cart);
    }

    /**
     * @param array<string, mixed> $payload
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    private static function add_cart_totals(array $payload, $cart, bool $include_snapshot = false): array
    {
        if (!$cart) {
            return $payload;
        }

        $payload['total'] = floatval($cart->get_cart_contents_total());
        $payload['itemCount'] = $cart->get_cart_contents_count();
        $payload['currency'] = self::get_currency();

        if ($include_snapshot) {
            $payload['items'] = OverSeek_Tracking_Payload_Utils::get_cart_items_snapshot($cart);
        }

        return $payload;
    }
}

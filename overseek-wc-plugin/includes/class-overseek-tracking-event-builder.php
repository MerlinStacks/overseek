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
    public static function build_add_to_cart_payload(int $product_id, int $variation_id, int $quantity, $product, $cart, string $event_id, array $meta_config = array()): array
    {
        $payload = array(
            'productId' => $product_id,
            'variationId' => $variation_id,
            'quantity' => $quantity,
            'name' => ($product && is_object($product)) ? $product->get_name() : '',
            'price' => ($product && is_object($product)) ? floatval($product->get_price()) : 0,
            'currency' => self::get_currency(),
            'eventId' => $event_id,
            'contentId' => ($product instanceof WC_Product) ? OverSeek_Pixel_Matching_Utils::get_content_id($product, array('meta' => $meta_config)) : (string) ($variation_id ?: $product_id),
            'externalId' => OverSeek_Pixel_Matching_Utils::get_external_id(),
        );

        $payload = OverSeek_Tracking_Payload_Utils::attach_customer_identity($payload);
        $payload = OverSeek_Tracking_Payload_Utils::attach_platform_cookies(self::add_cart_totals($payload, $cart));

        // Include items array for CAPI services
        $payload['items'] = array(
            array(
                'id' => $variation_id ?: $product_id,
                'productId' => $product_id,
                'variationId' => $variation_id,
                'contentId' => ($product instanceof WC_Product) ? OverSeek_Pixel_Matching_Utils::get_content_id($product, array('meta' => $meta_config)) : (string) ($variation_id ?: $product_id),
                'sku' => ($product && is_object($product) && method_exists($product, 'get_sku')) ? $product->get_sku() : '',
                'name' => ($product && is_object($product)) ? $product->get_name() : '',
                'quantity' => $quantity,
                'price' => ($product && is_object($product)) ? floatval($product->get_price()) : 0,
            ),
        );

        return $payload;
    }

    /**
     * @param array<string, mixed>|null $removed_item
     * @param object|null $product WooCommerce product instance.
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_remove_from_cart_payload(?array $removed_item, $product, $cart, array $meta_config = array()): array
    {
        $payload = array();

        if (is_array($removed_item)) {
            $payload['productId'] = isset($removed_item['product_id']) ? absint($removed_item['product_id']) : 0;
            $payload['variationId'] = isset($removed_item['variation_id']) ? absint($removed_item['variation_id']) : 0;
            $payload['contentId'] = ($product instanceof WC_Product) ? OverSeek_Pixel_Matching_Utils::get_content_id($product, array('meta' => $meta_config)) : (string) ($payload['variationId'] ?: $payload['productId']);
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
    public static function build_checkout_start_payload(string $email, $cart, string $event_id, ?float $fp_score = null, string $source = '', array $meta_config = array()): array
    {
        $payload = array(
            'email' => $email,
            'currency' => self::get_currency(),
            'eventId' => $event_id,
            'externalId' => OverSeek_Pixel_Matching_Utils::get_external_id(),
        );

        if ($source !== '') {
            $payload['source'] = $source;
        }

        $payload = self::add_cart_totals($payload, $cart, true, $meta_config);

        if ($fp_score !== null) {
            $payload['fpScore'] = $fp_score;
        }

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload);
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
     * @param array<string, mixed> $meta_config Meta pixel config (contentIdFormat, contentIdPrefix, contentIdSuffix)
     * @return array<string, mixed>
     */
    public static function build_purchase_payload($order, int $order_id, string $event_id, array $meta_config = array()): array
    {
        $items = array();

        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            $product_id = method_exists($item, 'get_product_id') ? (int) $item->get_product_id() : ($product ? (int) $product->get_id() : 0);
            $variation_id = method_exists($item, 'get_variation_id') ? (int) $item->get_variation_id() : 0;
            $items[] = array(
                'id' => $variation_id ?: $product_id,
                'productId' => $product_id,
                'variationId' => $variation_id,
                'sku' => $product ? $product->get_sku() : '',
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'price' => floatval($order->get_item_total($item)),
                'total' => floatval($item->get_total()),
            );
        }

        // Add formatted contentId to each item if pixel config is available
        $content_config = array('meta' => $meta_config);
        foreach ($items as &$item) {
            $product_for_id = wc_get_product((int) ($item['variationId'] ?: $item['productId']));
            if ($product_for_id) {
                $item['contentId'] = OverSeek_Pixel_Matching_Utils::get_content_id($product_for_id, $content_config);
            }
        }
        unset($item);

        $date_created = $order->get_date_created();

        $payload = array(
            'orderId' => $order_id,
            'dateCreated' => $date_created ? $date_created->date('c') : null,
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
            'externalId' => OverSeek_Pixel_Matching_Utils::get_external_id(),
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
     * @param array<string, mixed> $meta_config Meta pixel config (contentIdFormat, contentIdPrefix, contentIdSuffix)
     * @return array<string, mixed>
     */
    public static function build_product_view_payload($product, array $categories, array $meta_config = array()): array
    {
        $sku = $product->get_sku();
        $product_id = $product->get_id();

        // Compute formatted contentId using pixel config (matches browser pixel)
        $content_config = array('meta' => $meta_config);
        $content_id = OverSeek_Pixel_Matching_Utils::get_content_id($product, $content_config);

        $payload = array(
            'productId' => $product_id,
            'productName' => $product->get_name(),
            'sku' => $sku ?: '',
            'price' => floatval($product->get_price()),
            'regularPrice' => floatval($product->get_regular_price()),
            'salePrice' => $product->get_sale_price() ? floatval($product->get_sale_price()) : null,
            'currency' => self::get_currency(),
            'inStock' => $product->is_in_stock(),
            'categories' => $categories,
            'productType' => $product->get_type(),
            'contentId' => $content_id,
            'eventId' => OverSeek_Tracking_Payload_Utils::issue_product_view_event_id((int) $product->get_id()),
            'externalId' => OverSeek_Pixel_Matching_Utils::get_external_id(),
        );

        // Include items array for CAPI services — matches the format used by purchase/checkout events
        $payload['items'] = array(
            array(
                'id' => $product_id,
                'sku' => $sku ?: '',
                'contentId' => $content_id,
                'name' => $product->get_name(),
                'quantity' => 1,
                'price' => floatval($product->get_price()),
                'categories' => $categories,
            ),
        );

        $payload = OverSeek_Tracking_Payload_Utils::attach_customer_identity($payload);

        return OverSeek_Tracking_Payload_Utils::attach_platform_cookies($payload);
    }

    /**
     * @param object|null $cart WooCommerce cart instance.
     * @return array<string, mixed>
     */
    public static function build_cart_view_payload($cart, array $meta_config = array()): array
    {
        $payload = array();

        if (!$cart) {
            return $payload;
        }

        $payload = self::add_cart_totals($payload, $cart);
        $items = array();

        foreach ($cart->get_cart() as $cart_item) {
            $product = $cart_item['data'] ?? null;
            $product_id = isset($cart_item['product_id']) ? absint($cart_item['product_id']) : 0;
            $variation_id = isset($cart_item['variation_id']) ? absint($cart_item['variation_id']) : 0;
            $quantity = isset($cart_item['quantity']) ? max(1, absint($cart_item['quantity'])) : 1;
            $line_total = isset($cart_item['line_total']) ? floatval($cart_item['line_total']) : 0;
            $items[] = array(
                'id' => $variation_id ?: $product_id,
                'productId' => $product_id,
                'variationId' => $variation_id,
                'contentId' => ($product instanceof WC_Product) ? OverSeek_Pixel_Matching_Utils::get_content_id($product, array('meta' => $meta_config)) : (string) ($variation_id ?: $product_id),
                'name' => ($product && is_object($product)) ? $product->get_name() : '',
                'quantity' => $quantity,
                'price' => $quantity > 0 ? $line_total / $quantity : 0,
                'total' => $line_total,
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
    private static function add_cart_totals(array $payload, $cart, bool $include_snapshot = false, array $meta_config = array()): array
    {
        if (!$cart) {
            return $payload;
        }

        $payload['total'] = floatval($cart->get_cart_contents_total());
        $payload['itemCount'] = $cart->get_cart_contents_count();
        $payload['currency'] = self::get_currency();

        if ($include_snapshot) {
            $payload['items'] = OverSeek_Tracking_Payload_Utils::get_cart_items_snapshot($cart, $meta_config);
        }

        return $payload;
    }
}

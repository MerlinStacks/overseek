<?php
/**
 * Ecommerce event builders for client-side pixels.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Pixel_Ecommerce_Events
{
    public static function build_view_content_events(array $config): string
    {
        global $product;
        if (!$product instanceof WC_Product) {
            return '';
        }

        $content_id = OverSeek_Pixel_Matching_Utils::get_content_id($product, $config);
        $value = (float) $product->get_price();
        $currency = OverSeek_Tracking_Event_Builder::get_currency();
        $name = $product->get_name();
        $event_id = OverSeek_Tracking_Payload_Utils::get_shared_product_view_event_id(
            (int) $product->get_id(),
            isset($_COOKIE['_os_vid']) ? sanitize_text_field((string) $_COOKIE['_os_vid']) : ''
        );

        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $js .= "fbq('track','ViewContent'," . wp_json_encode(array('content_ids' => array($content_id), 'content_type' => 'product', 'content_name' => $name, 'value' => $value, 'currency' => $currency)) . ",{eventID:'{$event_id}'});";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $js .= "ttq.track('ViewContent'," . wp_json_encode(array('content_id' => $content_id, 'content_type' => 'product', 'content_name' => $name, 'value' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['pinterest']['tagId'])) {
            $js .= "pintrk('track','pagevisit'," . wp_json_encode(array('product_id' => $content_id, 'product_name' => $name, 'value' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','VIEW_CONTENT'," . wp_json_encode(array('item_ids' => array($content_id), 'price' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $js .= "gtag('event','view_item'," . wp_json_encode(array('items' => array(array('item_id' => $content_id, 'item_name' => $name, 'price' => $value)), 'value' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['google']['conversionId']) && !empty($config['google']['conversionLabelViewItem'])) {
            $js .= "gtag('event','conversion',{send_to:'" . esc_js($config['google']['conversionId'] . '/' . $config['google']['conversionLabelViewItem']) . "',value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','page_view',{ecomm_prodid:'" . esc_js($content_id) . "',ecomm_pagetype:'product',revenue_value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }

        return $js;
    }

    public static function build_view_item_list_events(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) {
            return '';
        }

        $items = array();
        global $wp_query;
        $term = get_queried_object();
        $list_name = ($term instanceof WP_Term) ? $term->name : 'Shop';

        if (!empty($wp_query->posts)) {
            $count = 0;
            foreach ($wp_query->posts as $post) {
                if ($count >= 10) {
                    break;
                }
                $product = wc_get_product($post->ID);
                if (!$product || !$product instanceof WC_Product) {
                    continue;
                }
                $items[] = array(
                    'item_id' => OverSeek_Pixel_Matching_Utils::get_content_id($product, $config),
                    'item_name' => $product->get_name(),
                    'price' => (float) $product->get_price(),
                    'index' => $count,
                );
                $count++;
            }
        }

        if (empty($items)) {
            return '';
        }

        return "gtag('event','view_item_list'," . wp_json_encode(array('item_list_name' => $list_name, 'items' => $items)) . ");";
    }

    public static function build_view_cart_events(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) {
            return '';
        }

        $cart = WC()->cart;
        if (!$cart) {
            return '';
        }

        $items = array();
        foreach ($cart->get_cart() as $item) {
            $product = $item['data'] ?? null;
            if (!$product instanceof WC_Product) {
                continue;
            }
            $items[] = array(
                'item_id' => OverSeek_Pixel_Matching_Utils::get_content_id($product, $config),
                'item_name' => $product->get_name(),
                'price' => (float) $product->get_price(),
                'quantity' => (int) $item['quantity'],
            );
        }

        return "gtag('event','view_cart'," . wp_json_encode(array(
            'value' => (float) $cart->get_total('edit'),
            'currency' => OverSeek_Tracking_Event_Builder::get_currency(),
            'items' => $items,
        )) . ");";
    }

    public static function build_initiate_checkout_events(array $config): string
    {
        $cart = WC()->cart;
        if (!$cart) {
            return '';
        }

        $value = (float) $cart->get_total('edit');
        $currency = OverSeek_Tracking_Event_Builder::get_currency();
        $num_items = $cart->get_cart_contents_count();
        $event_id = wp_generate_uuid4();

        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $js .= "fbq('track','InitiateCheckout'," . wp_json_encode(array('value' => $value, 'currency' => $currency, 'num_items' => $num_items)) . ",{eventID:'{$event_id}'});";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $tt_content_ids = array();
            foreach ($cart->get_cart() as $item) {
                $product = $item['data'] ?? null;
                if ($product) {
                    $tt_content_ids[] = (string) OverSeek_Pixel_Matching_Utils::get_content_id($product, $config);
                }
            }
            $js .= "ttq.track('InitiateCheckout'," . wp_json_encode(array('content_id' => implode(',', $tt_content_ids), 'content_type' => 'product', 'value' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['pinterest']['tagId'])) {
            $js .= "pintrk('track','checkout'," . wp_json_encode(array('value' => $value, 'currency' => $currency, 'order_quantity' => $num_items)) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','START_CHECKOUT'," . wp_json_encode(array('price' => $value, 'currency' => $currency, 'number_items' => $num_items)) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $js .= "gtag('event','begin_checkout'," . wp_json_encode(array('value' => $value, 'currency' => $currency)) . ");";
        }
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','begin_checkout',{revenue_value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }
        $js .= "(function(){function setOverseekEventId(){var f=jQuery('form.checkout').first();if(!f.length)return;var i=f.find('input[name=\"overseek_event_id\"]');if(!i.length){i=jQuery('<input/>',{type:'hidden',name:'overseek_event_id'});f.append(i);}i.val('{$event_id}');}setOverseekEventId();jQuery(document.body).on('updated_checkout',setOverseekEventId);})();";

        return $js;
    }

    public static function build_purchase_events(array $config): string
    {
        global $wp;
        $order_id = isset($wp->query_vars['order-received']) ? absint($wp->query_vars['order-received']) : 0;
        if (!$order_id) {
            return '';
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return '';
        }

        if ($order->get_meta('_overseek_pixel_tracked')) {
            return '';
        }
        $order->update_meta_data('_overseek_pixel_tracked', '1');
        $order->save();

        $total = (float) $order->get_total();
        $currency = $order->get_currency();
        $event_id = $order->get_meta('_overseek_event_id');
        if (empty($event_id)) {
            $event_id = wp_generate_uuid4();
            $order->update_meta_data('_overseek_event_id', $event_id);
            $order->save();
        }

        if (!empty($config['meta']['excludeShipping'])) {
            $total -= (float) $order->get_shipping_total();
        }
        if (!empty($config['meta']['excludeTax'])) {
            $total -= (float) $order->get_total_tax();
        }
        $total = max(0, round($total, 2));

        $items = array();
        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            if (!$product) {
                continue;
            }
            $items[] = array(
                'id' => OverSeek_Pixel_Matching_Utils::get_content_id($product, $config),
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'price' => (float) $order->get_item_total($item),
            );
        }

        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $content_ids = array_column($items, 'id');
            $js .= "fbq('track','Purchase'," . wp_json_encode(array('value' => $total, 'currency' => $currency, 'content_ids' => $content_ids, 'content_type' => 'product', 'num_items' => count($items))) . ",{eventID:'{$event_id}'});";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $tt_content_ids = array_column($items, 'id');
            $js .= "ttq.track('CompletePayment'," . wp_json_encode(array('content_id' => implode(',', $tt_content_ids), 'content_type' => 'product', 'value' => $total, 'currency' => $currency)) . ");";
        }
        if (!empty($config['pinterest']['tagId'])) {
            $product_ids = array_column($items, 'id');
            $js .= "pintrk('track','checkout'," . wp_json_encode(array('value' => $total, 'currency' => $currency, 'order_quantity' => count($items), 'product_ids' => $product_ids)) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $product_ids = array_column($items, 'id');
            $js .= "snaptr('track','PURCHASE'," . wp_json_encode(array('transaction_id' => (string) $order_id, 'item_ids' => $product_ids, 'price' => $total, 'currency' => $currency)) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $ga_items = array();
            foreach ($items as $item) {
                $ga_items[] = array(
                    'item_id' => $item['id'],
                    'item_name' => $item['name'],
                    'quantity' => $item['quantity'],
                    'price' => $item['price'],
                );
            }
            $js .= "gtag('event','purchase'," . wp_json_encode(array('transaction_id' => (string) $order_id, 'value' => $total, 'currency' => $currency, 'items' => $ga_items)) . ");";
        }
        if (!empty($config['google']['conversionId']) && !empty($config['google']['conversionLabelPurchase'])) {
            $js .= "gtag('event','conversion',{send_to:'" . esc_js($config['google']['conversionId'] . '/' . $config['google']['conversionLabelPurchase']) . "',value:" . $total . ",currency:'" . esc_js($currency) . "',transaction_id:'" . esc_js((string) $order_id) . "'});";
        }
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','purchase',{ecomm_prodid:" . wp_json_encode(array_column($items, 'id')) . ",ecomm_pagetype:'purchase',revenue_value:" . $total . ",currency:'" . esc_js($currency) . "'});";
        }
        if (!empty($config['twitter']['pixelId'])) {
            $js .= "if(window.twq){twq('event','tw-purchase-event',{value:" . $total . ",currency:'" . esc_js($currency) . "',conversion_id:'" . esc_js((string) $order_id) . "'});}";
        }

        return $js;
    }
}

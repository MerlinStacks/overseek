<?php
/**
 * Pixel identity and matching helpers.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Pixel_Matching_Utils
{
    public static function get_content_id(WC_Product $product, array $config): string
    {
        $format = $config['meta']['contentIdFormat'] ?? 'sku';
        $prefix = $config['meta']['contentIdPrefix'] ?? '';
        $suffix = $config['meta']['contentIdSuffix'] ?? '';
        $id = ($format === 'id') ? (string) $product->get_id() : ($product->get_sku() ?: (string) $product->get_id());

        return $prefix . $id . $suffix;
    }

    public static function get_advanced_matching_params(array $meta_config): array
    {
        if (empty($meta_config['advancedMatching'])) {
            return array();
        }

        $params = array();
        $user = wp_get_current_user();
        if ($user->ID > 0) {
            if ($user->user_email) {
                $params['em'] = strtolower(trim($user->user_email));
            }
            if ($user->first_name) {
                $params['fn'] = strtolower(trim($user->first_name));
            }
            if ($user->last_name) {
                $params['ln'] = strtolower(trim($user->last_name));
            }
        }

        $wc = function_exists('WC') ? WC() : null;
        $customer = $wc ? ($wc->customer ?? null) : null;
        if ($customer) {
            $phone = $customer->get_billing_phone();
            if ($phone) {
                $params['ph'] = preg_replace('/[^0-9]/', '', $phone);
            }
            $zip = $customer->get_billing_postcode();
            if ($zip) {
                $params['zp'] = strtolower(trim($zip));
            }
            $city = $customer->get_billing_city();
            if ($city) {
                $params['ct'] = strtolower(trim($city));
            }
            $state = $customer->get_billing_state();
            if ($state) {
                $params['st'] = strtolower(trim($state));
            }
            $country = $customer->get_billing_country();
            if ($country) {
                $params['country'] = strtolower(trim($country));
            }
        }

        return $params;
    }

    public static function get_tiktok_identify_params(): array
    {
        $params = array();
        $user = wp_get_current_user();
        if ($user->ID > 0 && $user->user_email) {
            $params['email'] = hash('sha256', strtolower(trim($user->user_email)));
        }

        $wc = function_exists('WC') ? WC() : null;
        $customer = $wc ? ($wc->customer ?? null) : null;
        if ($customer) {
            $phone = $customer->get_billing_phone();
            if ($phone) {
                $params['phone_number'] = hash('sha256', preg_replace('/[^0-9+]/', '', $phone));
            }
        }

        return $params;
    }

    public static function get_external_id(): string
    {
        $user = wp_get_current_user();
        if ($user->ID > 0) {
            return 'wc_' . $user->ID;
        }

        return isset($_COOKIE['_os_vid']) ? sanitize_text_field((string) $_COOKIE['_os_vid']) : '';
    }
}

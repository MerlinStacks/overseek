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

    public static function get_google_user_data_params(): array
    {
        $params = array();

        $user = wp_get_current_user();
        if ($user->ID > 0 && $user->user_email) {
            $params['email'] = trim((string) $user->user_email);
        }

        $wc = function_exists('WC') ? WC() : null;
        $customer = $wc ? ($wc->customer ?? null) : null;
        if ($customer) {
            $phone = $customer->get_billing_phone();
            if ($phone) {
                $params['phone_number'] = trim((string) $phone);
            }

            $address = self::build_google_address(
                $customer->get_billing_first_name(),
                $customer->get_billing_last_name(),
                trim($customer->get_billing_address_1() . ' ' . $customer->get_billing_address_2()),
                $customer->get_billing_city(),
                $customer->get_billing_state(),
                $customer->get_billing_postcode(),
                $customer->get_billing_country()
            );
            if (!empty($address)) {
                $params['address'] = $address;
            }
        }

        return $params;
    }

    public static function get_google_user_data_params_from_order($order): array
    {
        if (!$order) {
            return array();
        }

        $params = array();
        $email = $order->get_billing_email();
        if ($email) {
            $params['email'] = trim((string) $email);
        }

        $phone = $order->get_billing_phone();
        if ($phone) {
            $params['phone_number'] = trim((string) $phone);
        }

        $address = self::build_google_address(
            $order->get_billing_first_name(),
            $order->get_billing_last_name(),
            trim($order->get_billing_address_1() . ' ' . $order->get_billing_address_2()),
            $order->get_billing_city(),
            $order->get_billing_state(),
            $order->get_billing_postcode(),
            $order->get_billing_country()
        );
        if (!empty($address)) {
            $params['address'] = $address;
        }

        return $params;
    }

    private static function build_google_address($first_name, $last_name, $street, $city, $region, $postal_code, $country): array
    {
        $address = array();
        if ($first_name) {
            $address['first_name'] = trim((string) $first_name);
        }
        if ($last_name) {
            $address['last_name'] = trim((string) $last_name);
        }
        if ($street) {
            $address['street'] = trim((string) $street);
        }
        if ($city) {
            $address['city'] = trim((string) $city);
        }
        if ($region) {
            $address['region'] = trim((string) $region);
        }
        if ($postal_code) {
            $address['postal_code'] = trim((string) $postal_code);
        }
        if ($country) {
            $address['country'] = strtoupper(trim((string) $country));
        }

        return $address;
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

<?php
/**
 * Pixel configuration loading and caching helpers.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Pixel_Config_Provider
{
    private const FRESH_TTL = 1800;
    private const STALE_TTL = DAY_IN_SECONDS;
    private const REFRESH_HOOK = 'overseek_refresh_pixel_config';

    /**
     * @return array<string, mixed>
     */
    public static function get_config(string $api_url, string $account_id): array
    {
        $local = get_option('overseek_storefront_pixel_config', false);
        if (is_array($local)) {
            $updated_at = (int) get_option('overseek_storefront_pixel_config_updated_at', 0);
            if ($updated_at <= 0 || (time() - $updated_at) >= self::FRESH_TTL) {
                self::schedule_background_refresh($account_id);
            }

            return $local;
        }

        $fresh_key = self::get_fresh_key($account_id);
        $stale_key = self::get_stale_key($account_id);

        $cached = get_transient($fresh_key);
        if (is_array($cached)) {
            return $cached;
        }

        $stale = get_transient($stale_key);
        if (is_array($stale)) {
            self::schedule_background_refresh($account_id);

            return $stale;
        }

        self::schedule_background_refresh($account_id);

        return array();
    }

    /**
     * @return array<string, mixed>
     */
    public static function refresh_config(string $api_url, string $account_id): array
    {
        if ($api_url === '' || $account_id === '') {
            return array();
        }

        $response = wp_remote_get(
            $api_url . '/api/capi/pixels/' . $account_id,
            array(
                'timeout' => 5,
                'headers' => array('Accept' => 'application/json'),
            )
        );

        if (is_wp_error($response)) {
            return array();
        }

        $data = OverSeek_HTTP_Utils::decode_json_response($response);
        if (!is_array($data)) {
            return array();
        }

        set_transient(self::get_fresh_key($account_id), $data, self::FRESH_TTL);
        set_transient(self::get_stale_key($account_id), $data, self::STALE_TTL);
        update_option('overseek_storefront_pixel_config', $data, false);
        update_option('overseek_storefront_pixel_config_updated_at', time(), false);
        update_option('overseek_storefront_pixel_config_version', hash('sha256', (string) wp_json_encode($data)), false);
        delete_transient(self::get_refresh_lock_key($account_id));

        return $data;
    }

    public static function schedule_background_refresh(string $account_id): void
    {
        if ($account_id === '') {
            return;
        }

        $lock_key = self::get_refresh_lock_key($account_id);
        if (get_transient($lock_key)) {
            return;
        }

        if (!wp_next_scheduled(self::REFRESH_HOOK, array($account_id))) {
            set_transient($lock_key, 1, 5 * MINUTE_IN_SECONDS);
            wp_schedule_single_event(time(), self::REFRESH_HOOK, array($account_id));
        }
    }

    private static function get_fresh_key(string $account_id): string
    {
        return 'overseek_pixels_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 32);
    }

    private static function get_stale_key(string $account_id): string
    {
        return 'overseek_pixels_stale_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 32);
    }

    private static function get_refresh_lock_key(string $account_id): string
    {
        return 'overseek_pixels_refresh_lock_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id, 32);
    }
}

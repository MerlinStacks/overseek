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
    private const REFRESH_HOOK = 'overseek_refresh_pixel_config';

    /**
     * @return array<string, mixed>
     */
    public static function get_config(string $api_url, string $account_id): array
    {
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

        return self::refresh_config($api_url, $account_id);
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
        set_transient(self::get_stale_key($account_id), $data, DAY_IN_SECONDS);

        return $data;
    }

    public static function schedule_background_refresh(string $account_id): void
    {
        if ($account_id === '') {
            return;
        }

        if (!wp_next_scheduled(self::REFRESH_HOOK, array($account_id))) {
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
}

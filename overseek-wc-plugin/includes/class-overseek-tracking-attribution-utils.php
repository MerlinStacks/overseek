<?php
/**
 * Attribution and request-context helpers for OverSeek tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Attribution_Utils
{
    /**
     * Check if the current REST request is a WooCommerce Store API request.
     */
    public static function is_wc_store_api_request(): bool
    {
        global $wp;

        if ($wp !== null && isset($wp->query_vars['rest_route'])) {
            return strpos((string) $wp->query_vars['rest_route'], '/wc/store/') === 0;
        }

        if (isset($_SERVER['REQUEST_URI'])) {
            $uri = esc_url_raw(wp_unslash((string) $_SERVER['REQUEST_URI']));

            return strpos($uri, '/wc/store/') !== false;
        }

        return false;
    }

    /**
     * Persist UTM/MTM parameters from the current URL into a session cookie.
     */
    public static function persist_utm_parameters(): void
    {
        $utm_params = self::get_utm_parameters_from_request();

        if (empty($utm_params)) {
            return;
        }

        OverSeek_Tracking_Request_Utils::set_cookie_safe('_os_utm', wp_json_encode($utm_params), 0);
    }

    /**
     * Persist click ID from ad platforms into a session cookie.
     *
     * @param array<string, string> $click_id_params
     */
    public static function persist_click_id(array $click_id_params): void
    {
        foreach ($click_id_params as $param => $platform) {
            if (!isset($_GET[$param]) || $_GET[$param] === '') {
                continue;
            }

            $click_data = array(
                'id' => sanitize_text_field(wp_unslash((string) $_GET[$param])),
                'platform' => $platform,
                'param' => $param,
            );

            OverSeek_Tracking_Request_Utils::set_cookie_safe('_os_click', wp_json_encode($click_data), 0);

            return;
        }
    }

    /**
     * Persist the first external landing referrer for the current session.
     */
    public static function persist_landing_referrer(): void
    {
        if (!empty($_COOKIE['_os_lref'])) {
            return;
        }

        $referrer = isset($_SERVER['HTTP_REFERER']) ? esc_url_raw(wp_unslash((string) $_SERVER['HTTP_REFERER'])) : '';
        if ($referrer === '') {
            return;
        }

        $site_host = wp_parse_url(home_url(), PHP_URL_HOST);
        $ref_host = wp_parse_url($referrer, PHP_URL_HOST);

        if ($ref_host && $ref_host !== $site_host) {
            OverSeek_Tracking_Request_Utils::set_cookie_safe('_os_lref', $referrer, 0);
        }
    }

    /**
     * Get persisted click ID data from URL or cookie.
     *
     * @param array<string, string> $click_id_params
     * @return array{id: string, platform: string}|array<string, never>
     */
    public static function get_click_data(array $click_id_params): array
    {
        foreach ($click_id_params as $param => $platform) {
            if (!isset($_GET[$param]) || $_GET[$param] === '') {
                continue;
            }

            return array(
                'id' => sanitize_text_field(wp_unslash((string) $_GET[$param])),
                'platform' => $platform,
            );
        }

        $click_data = OverSeek_Tracking_Request_Utils::get_json_cookie('_os_click');
        if (is_array($click_data) && !empty($click_data['id'])) {
            return array(
                'id' => sanitize_text_field((string) $click_data['id']),
                'platform' => isset($click_data['platform']) ? sanitize_text_field((string) $click_data['platform']) : 'unknown',
            );
        }

        return array();
    }

    /**
     * Get the persisted external landing referrer from the session cookie.
     */
    public static function get_landing_referrer(): string
    {
        if (empty($_COOKIE['_os_lref'])) {
            return '';
        }

        return esc_url_raw(wp_unslash((string) $_COOKIE['_os_lref']));
    }

    /**
     * Get UTM/MTM parameters from URL or persisted cookie.
     *
     * @return array<string, string|null>
     */
    public static function get_utm_parameters(): array
    {
        $utm_params = self::get_utm_parameters_from_request();
        if (!empty($utm_params)) {
            return $utm_params;
        }

        $utm_data = OverSeek_Tracking_Request_Utils::get_json_cookie('_os_utm');

        return is_array($utm_data) ? $utm_data : array();
    }

    /**
     * @return array<string, string|null>
     */
    private static function get_utm_parameters_from_request(): array
    {
        $has_url_params = isset($_GET['utm_source']) || isset($_GET['utm_campaign']) ||
            isset($_GET['mtm_source']) || isset($_GET['mtm_campaign']);

        if (!$has_url_params) {
            return array();
        }

        return array(
            'source' => self::get_query_param('utm_source', 'mtm_source'),
            'medium' => self::get_query_param('utm_medium', 'mtm_medium'),
            'campaign' => self::get_query_param('utm_campaign', 'mtm_campaign'),
            'content' => self::get_query_param('utm_content', 'mtm_content'),
            'term' => self::get_query_param('utm_term', 'mtm_cid'),
        );
    }

    private static function get_query_param(string $primary, string $fallback = ''): ?string
    {
        if (isset($_GET[$primary])) {
            return sanitize_text_field(wp_unslash((string) $_GET[$primary]));
        }

        if ($fallback !== '' && isset($_GET[$fallback])) {
            return sanitize_text_field(wp_unslash((string) $_GET[$fallback]));
        }

        return null;
    }
}

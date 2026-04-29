<?php
/**
 * Shared request and cookie utilities for OverSeek tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Request_Utils
{
    /**
     * Generate a cryptographically secure UUID v4.
     *
     * @return string
     */
    public static function generate_uuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    /**
     * Resolve the visitor IP from common proxy headers.
     *
     * @return string
     */
    public static function resolve_visitor_ip(): string
    {
        $ip = '';

        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ips = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
            $ip = trim($ips[0]);
        } elseif (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            $ip = (string) $_SERVER['HTTP_X_REAL_IP'];
        } elseif (!empty($_SERVER['HTTP_CLIENT_IP'])) {
            $ip = (string) $_SERVER['HTTP_CLIENT_IP'];
        } elseif (!empty($_SERVER['REMOTE_ADDR'])) {
            $ip = (string) $_SERVER['REMOTE_ADDR'];
        }

        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
    }

    /**
     * Safely decode a JSON payload from a cookie value.
     *
     * @param string $cookie_name Cookie key to inspect.
     * @return array<string, mixed>|null
     */
    public static function get_json_cookie(string $cookie_name): ?array
    {
        if (!isset($_COOKIE[$cookie_name]) || empty($_COOKIE[$cookie_name])) {
            return null;
        }

        $decoded = json_decode(wp_unslash((string) $_COOKIE[$cookie_name]), true);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * Get the current page URL with sanitization.
     *
     * @return string
     */
    public static function get_sanitized_current_url(): string
    {
        $url = home_url(add_query_arg(array()));
        $data_uri_patterns = array(
            '/\/image\/svg\+xml[,%].*$/i',
            '/\/image\/png[,%].*$/i',
            '/\/image\/jpeg[,%].*$/i',
            '/\/image\/gif[,%].*$/i',
            '/\/image\/webp[,%].*$/i',
            '/\/data:[^\/]*;base64[,%].*$/i',
        );

        foreach ($data_uri_patterns as $pattern) {
            $cleaned = preg_replace($pattern, '', $url);
            if ($cleaned !== $url) {
                return rtrim((string) $cleaned, '/');
            }
        }

        return $url;
    }

    /**
     * Get logged-in user data for event enrichment.
     *
     * @return array<string, mixed>
     */
    public static function get_logged_in_user_data(): array
    {
        if (!is_user_logged_in()) {
            return array();
        }

        $user = wp_get_current_user();
        if (!$user || !$user->ID) {
            return array();
        }

        return array(
            'customerId' => $user->ID,
            'email' => $user->user_email,
        );
    }

    /**
     * Parse and classify referrer data.
     *
     * @return array<string, string>
     */
    public static function get_referrer_data(): array
    {
        $referrer = isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : '';

        if ($referrer === '') {
            return array('referrer' => '', 'referrerDomain' => '', 'referrerType' => 'direct');
        }

        $parsed = wp_parse_url($referrer);
        $domain = isset($parsed['host']) ? strtolower((string) $parsed['host']) : '';

        $type = 'referral';
        $site_host = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));

        if ($domain === $site_host || strpos($domain, $site_host) !== false) {
            $type = 'internal';
        } elseif (
            strpos($domain, 'google') !== false || strpos($domain, 'bing') !== false ||
            strpos($domain, 'yahoo') !== false || strpos($domain, 'duckduckgo') !== false
        ) {
            $type = 'organic';
        } elseif (
            strpos($domain, 'facebook') !== false || strpos($domain, 'instagram') !== false ||
            strpos($domain, 'twitter') !== false || strpos($domain, 'linkedin') !== false ||
            strpos($domain, 'pinterest') !== false || strpos($domain, 'tiktok') !== false
        ) {
            $type = 'social';
        }

        return array(
            'referrer' => esc_url_raw($referrer),
            'referrerDomain' => $domain,
            'referrerType' => $type,
        );
    }

    /**
     * Set a cookie with modern SameSite-compatible attributes.
     *
     * @param string $name Cookie name.
     * @param string $value Cookie value.
     * @param int    $expires Expiration timestamp or 0.
     * @return void
     */
    public static function set_cookie_safe(string $name, string $value, int $expires = 0): void
    {
        if (headers_sent()) {
            return;
        }

        $secure = is_ssl();
        $samesite = 'Lax';

        if (PHP_VERSION_ID >= 70300) {
            setcookie($name, $value, array(
                'expires' => $expires,
                'path' => '/',
                'domain' => '',
                'secure' => $secure,
                'httponly' => false,
                'samesite' => $samesite,
            ));
        } else {
            setcookie($name, $value, $expires, '/; SameSite=' . $samesite, '', $secure, false);
        }

        $_COOKIE[$name] = $value;
    }

    /**
     * Read a request value with explicit POST-first, GET-second precedence.
     *
     * @param string $key Request parameter name.
     * @return string
     */
    public static function get_request_param_value(string $key): string
    {
        if (isset($_POST[$key])) {
            return sanitize_text_field(wp_unslash($_POST[$key]));
        }

        if (isset($_GET[$key])) {
            return sanitize_text_field(wp_unslash($_GET[$key]));
        }

        return '';
    }
}

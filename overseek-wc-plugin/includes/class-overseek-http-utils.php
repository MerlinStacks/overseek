<?php
/**
 * Shared HTTP utility helpers for OverSeek.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_HTTP_Utils
{
    /**
     * Decode a JSON HTTP response body into an array.
     *
     * @param array|\WP_Error $response HTTP response array.
     * @return array<string, mixed>|null
     */
    public static function decode_json_response($response): ?array
    {
        $body = wp_remote_retrieve_body($response);
        $data = json_decode((string) $body, true);

        return is_array($data) ? $data : null;
    }

    /**
     * Resolve the visitor IP from proxy headers with consistent priority.
     *
     * Priority: CF-Connecting-IP > X-Forwarded-For (first) > X-Real-IP > Client-IP > REMOTE_ADDR
     *
     * @return string Validated IP address or empty string.
     */
    public static function get_client_ip(): string
    {
        $ip = '';

        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $ip = sanitize_text_field((string) $_SERVER['HTTP_CF_CONNECTING_IP']);
        } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ips = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
            $ip = sanitize_text_field(trim($ips[0]));
        } elseif (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            $ip = sanitize_text_field((string) $_SERVER['HTTP_X_REAL_IP']);
        } elseif (!empty($_SERVER['HTTP_CLIENT_IP'])) {
            $ip = sanitize_text_field((string) $_SERVER['HTTP_CLIENT_IP']);
        } elseif (!empty($_SERVER['REMOTE_ADDR'])) {
            $ip = sanitize_text_field((string) $_SERVER['REMOTE_ADDR']);
        }

        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
    }
}

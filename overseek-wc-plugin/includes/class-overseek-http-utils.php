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
}

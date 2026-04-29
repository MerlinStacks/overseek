<?php
/**
 * Shared fingerprint support helpers.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Fingerprint_Utils
{
    public static function is_suspicious_user_agent(): bool
    {
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower((string) $_SERVER['HTTP_USER_AGENT']) : '';
        if ($ua === '') {
            return true;
        }

        $signals = array('headless', 'bot', 'crawler', 'spider', 'curl', 'wget', 'python', 'java/');
        foreach ($signals as $signal) {
            if (strpos($ua, $signal) !== false) {
                return true;
            }
        }

        return false;
    }

    public static function get_client_ip(): string
    {
        $ip = '';

        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $ip = sanitize_text_field((string) $_SERVER['HTTP_CF_CONNECTING_IP']);
        } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $xff = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
            $ip = sanitize_text_field(trim($xff[0]));
        } elseif (!empty($_SERVER['REMOTE_ADDR'])) {
            $ip = sanitize_text_field((string) $_SERVER['REMOTE_ADDR']);
        }

        if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }

        return 'unknown';
    }

    public static function screen_dims_suspicious(string $dims): bool
    {
        if ($dims === '') {
            return true;
        }

        $parts = explode(':', $dims);
        if (count($parts) !== 2) {
            return true;
        }

        $screen = explode('x', $parts[0]);
        $inner = explode('x', $parts[1]);

        if (count($screen) !== 2 || count($inner) !== 2) {
            return true;
        }

        $sw = intval($screen[0]);
        $sh = intval($screen[1]);
        $iw = intval($inner[0]);
        $ih = intval($inner[1]);

        if ($sw === 0 || $sh === 0) {
            return true;
        }

        return $sw === $iw && $sh === $ih;
    }

    public static function get_visitor_id(): ?string
    {
        return isset($_COOKIE['_os_vid']) ? sanitize_text_field((string) $_COOKIE['_os_vid']) : null;
    }

    public static function nonce_transient_key(string $account_id, string $visitor_id, int $length): string
    {
        return '_os_fp_nonce_' . OverSeek_Crypto_Utils::hash_key_fragment($account_id . $visitor_id, $length);
    }

    public static function generate_and_store_nonce(string $account_id, int $ttl, int $length): ?string
    {
        $visitor_id = self::get_visitor_id();
        if (!$visitor_id) {
            return null;
        }

        $nonce = wp_generate_password(32, false);
        set_transient(self::nonce_transient_key($account_id, $visitor_id, $length), $nonce, $ttl);

        return $nonce;
    }

    public static function validate_nonce(string $account_id, string $nonce, int $length): bool
    {
        if ($nonce === '') {
            return false;
        }

        $visitor_id = self::get_visitor_id();
        if (!$visitor_id) {
            return false;
        }

        $key = self::nonce_transient_key($account_id, $visitor_id, $length);
        $stored = get_transient($key);

        if ($stored === false || !hash_equals((string) $stored, $nonce)) {
            return false;
        }

        delete_transient($key);

        return true;
    }
}

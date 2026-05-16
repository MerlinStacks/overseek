<?php
/**
 * Shared hashing helpers for OverSeek.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Crypto_Utils
{
    public static function hash_key_fragment(string $value, int $length): string
    {
        return substr(hash('sha256', $value), 0, $length);
    }

    public static function encrypt_secret(string $plaintext): string
    {
        if ($plaintext === '') {
            return '';
        }

        if (strpos($plaintext, 'enc:') === 0) {
            return $plaintext;
        }

        $key_material = self::get_key_material();
        if ($key_material === '') {
            return $plaintext;
        }

        $key = hash('sha256', $key_material, true);
        $iv = random_bytes(16);
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        if (!is_string($ciphertext) || $ciphertext === '') {
            return $plaintext;
        }

        return 'enc:' . base64_encode($iv . $ciphertext);
    }

    public static function decrypt_secret(string $value): string
    {
        if ($value === '' || strpos($value, 'enc:') !== 0) {
            return $value;
        }

        $encoded = substr($value, 4);
        $raw = base64_decode($encoded, true);
        if (!is_string($raw) || strlen($raw) <= 16) {
            return '';
        }

        $key_material = self::get_key_material();
        if ($key_material === '') {
            return '';
        }

        $key = hash('sha256', $key_material, true);
        $iv = substr($raw, 0, 16);
        $ciphertext = substr($raw, 16);
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);

        return is_string($plaintext) ? $plaintext : '';
    }

    private static function get_key_material(): string
    {
        $auth_key = defined('AUTH_KEY') ? (string) AUTH_KEY : '';
        $secure_auth_key = defined('SECURE_AUTH_KEY') ? (string) SECURE_AUTH_KEY : '';
        return $auth_key . '|' . $secure_auth_key;
    }
}

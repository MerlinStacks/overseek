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
}

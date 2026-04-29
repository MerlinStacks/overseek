<?php
/**
 * Guard and gating helpers for OverSeek tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Guard_Utils
{
    /**
     * Check if the current request is from a known bot/crawler.
     */
    public static function is_bot_request(): bool
    {
        $user_agent = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower((string) $_SERVER['HTTP_USER_AGENT']) : '';

        if ($user_agent === '') {
            return true;
        }

        $bot_patterns = array(
            'googlebot',
            'bingbot',
            'slurp',
            'duckduckbot',
            'baiduspider',
            'yandexbot',
            'sogou',
            'exabot',
            'facebot',
            'linkedinbot',
            'twitterbot',
            'pinterestbot',
            'discordbot',
            'telegrambot',
            'whatsapp',
            'ia_archiver',
            'mj12bot',
            'ahrefsbot',
            'semrushbot',
            'dotbot',
            'rogerbot',
            'screaming frog',
            'seodatabox',
            'sistrix',
            'dataforseo',
            'serpstatbot',
            'bytespider',
            'gtmetrix',
            'pingdom',
            'uptimerobot',
            'statuscake',
            'newrelicpinger',
            'site24x7',
            'pagespeedonline',
            'gptbot',
            'claudebot',
            'ccbot',
            'amazonbot',
            'applebot',
            'meta-externalagent',
            'crawler',
            'spider',
            'bot/',
            '/bot',
            'headless',
            'phantomjs',
            'playwright',
            'puppeteer',
            'wget',
            'curl',
            'python-requests',
            'go-http-client',
            'apache-httpclient',
            'httpx',
            'node-fetch',
            'axios',
        );

        $bot_patterns = apply_filters('overseek_bot_patterns', $bot_patterns);

        foreach ($bot_patterns as $pattern) {
            if (strpos($user_agent, (string) $pattern) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if the current request is for a static resource.
     */
    public static function is_static_resource(): bool
    {
        $request_uri = isset($_SERVER['REQUEST_URI']) ? strtolower((string) $_SERVER['REQUEST_URI']) : '';
        $path = strtok($request_uri, '?');

        $static_extensions = array(
            '.js', '.css', '.map', '.json', '.xml', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
            '.ico', '.bmp', '.avif', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.mp3',
            '.ogg', '.wav', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.tar', '.gz', '.rar',
        );

        foreach ($static_extensions as $ext) {
            if (substr((string) $path, -strlen($ext)) === $ext) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if the current visitor has consent for statistics tracking.
     */
    public static function has_tracking_consent(): bool
    {
        if (!apply_filters('overseek_require_consent', get_option('overseek_require_consent', false))) {
            return true;
        }

        if (function_exists('wp_has_consent')) {
            return wp_has_consent('statistics');
        }

        return false;
    }

    /**
     * Get cookie retention period in seconds from plugin settings.
     */
    public static function get_cookie_retention_seconds(): int
    {
        return absint(get_option('overseek_cookie_retention_days', 365)) * DAY_IN_SECONDS;
    }

    /**
     * Get the current storefront page type.
     */
    public static function get_page_type(): string
    {
        if (is_front_page()) {
            return 'home';
        }
        if (is_product()) {
            return 'product';
        }
        if (is_product_category()) {
            return 'category';
        }
        if (is_cart()) {
            return 'cart';
        }
        if (is_checkout()) {
            return 'checkout';
        }
        if (is_account_page()) {
            return 'account';
        }
        if (is_search()) {
            return 'search';
        }
        if (is_shop()) {
            return 'shop';
        }

        return 'other';
    }
}

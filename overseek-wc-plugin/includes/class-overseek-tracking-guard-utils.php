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
     * Identify document requests, not background fetches masquerading as home views.
     * Missing browser metadata is allowed for GET requests (older browsers/proxies).
     * This is analytics classification, not an authentication or security boundary.
     */
    public static function is_document_view_request(): bool
    {
        if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return false;
        }
        // Some frontend endpoints do not set DOING_AJAX until after template_redirect.
        if (isset($_GET['wc-ajax']) || isset($_POST['wc-ajax'])) {
            return false;
        }

        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $mode = strtolower(trim((string) ($_SERVER['HTTP_SEC_FETCH_MODE'] ?? '')));
        $destination = strtolower(trim((string) ($_SERVER['HTTP_SEC_FETCH_DEST'] ?? '')));
        if ($method !== 'GET' && !($method === 'POST' && $mode === 'navigate')) {
            return false;
        }
        if (($mode !== '' && $mode !== 'navigate')
            || ($destination !== '' && !in_array($destination, array('document', 'iframe', 'frame'), true))) {
            return false;
        }
        if (strtolower(trim((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? ''))) === 'xmlhttprequest') {
            return false;
        }

        foreach (array('HTTP_SEC_PURPOSE', 'HTTP_PURPOSE', 'HTTP_X_PURPOSE', 'HTTP_X_MOZ') as $header) {
            if (preg_match('/\b(prefetch|prerender)\b/i', (string) ($_SERVER[$header] ?? ''))) {
                return false;
            }
        }

        $accept = strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? ''));
        if ($accept !== '' && strpos($accept, 'text/html') === false
            && strpos($accept, 'application/xhtml+xml') === false && strpos($accept, '*/*') === false) {
            return false;
        }

        return true;
    }

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
     * Check if the current visitor has consent for advertising tracking.
     */
    public static function has_tracking_consent(): bool
    {
        $pixel_config = get_option('overseek_storefront_pixel_config', array());
        if (is_array($pixel_config) && !empty($pixel_config['_consent']['autoAccept'])) {
            return true;
        }

        if (!apply_filters('overseek_require_consent', get_option('overseek_require_consent', false))) {
            return true;
        }

        if (function_exists('wp_has_consent')) {
            return wp_has_consent('marketing');
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

<?php
/**
 * Crawler Guard - Blocks blacklisted bots at the application level.
 *
 * Syncs the blocked crawler list from the OverSeek server via WP-Cron (hourly).
 * Checks incoming requests against the cached block list on template_redirect.
 * Serves a customizable 403 page to blocked bots.
 *
 * Performance: For real visitors, adds only a single get_transient() call
 * (~0.01ms via WP object cache) and a strpos loop that short-circuits on
 * no match. Zero additional HTTP calls, DB queries, or file reads.
 *
 * @package OverSeek
 * @since   2.8.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Crawler_Guard
{
    /** @var int Length used for hashed key fragments. */
    private const HASH_LENGTH = 16;

    /** @var string OverSeek API base URL. */
    private string $api_url;

    /** @var string OverSeek account ID. */
    private string $account_id;

    /** @var string Transient key for cached block patterns. */
    private string $transient_key;

    /** @var string WP-Cron hook name. */
    private const CRON_HOOK = 'overseek_sync_blocked_crawlers';

    /** @var int Transient TTL in seconds (2 hours — buffer beyond 1-hour cron). */
    private const TRANSIENT_TTL = 7200;

    /**
     * Initialize the crawler guard.
     * Hooks into template_redirect (priority 1) to block bots before page render.
     */
    public function __construct()
    {
        $this->api_url    = untrailingslashit(get_option('overseek_api_url', ''));
        $this->account_id = get_option('overseek_account_id', '');

        if (empty($this->account_id) || empty($this->api_url)) {
            return;
        }

        $this->transient_key = 'overseek_blocked_agents_' . OverSeek_Crypto_Utils::hash_key_fragment($this->account_id, 8);

        // Schedule hourly sync via WP-Cron
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), 'hourly', self::CRON_HOOK);
        }
        add_action(self::CRON_HOOK, array($this, 'sync_blocked_list'));

        // Check incoming requests — priority 1 to run before tracking/page render
        add_action('template_redirect', array($this, 'maybe_block_request'), 1);

        // Guard WooCommerce Store API checkout against bots.
        // template_redirect does NOT fire for REST requests — they go through
        // rest_api_init instead. This filter runs before any REST endpoint
        // handler and lets us block bots on the public checkout endpoint.
        add_filter('rest_pre_dispatch', array($this, 'maybe_block_rest_checkout'), 1, 3);

        // Immediate sync on cold start so new installs don't wait up to 1 hour
        // with an empty block list. Uses a short-lived backoff transient to prevent
        // hammering the API on every page load if the server is unreachable.
        $backoff_key = $this->transient_key . '_backoff';
        if (false === get_transient($this->transient_key) && false === get_transient($backoff_key)) {
            // Set backoff BEFORE the call so concurrent requests don't all fire
            set_transient($backoff_key, 1, 5 * MINUTE_IN_SECONDS);
            $this->sync_blocked_list();
        }
    }

    /**
     * Check if the current request should be blocked.
     *
     * Why template_redirect: Runs after WordPress has resolved the query
     * but before any template output. Blocking here prevents the full page
     * from rendering for the bot, saving server resources.
     */
    public function maybe_block_request(): void
    {
        // Skip admin, AJAX, cron, REST
        // REST requests are handled separately via rest_pre_dispatch filter
        if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
            return;
        }

        if (defined('REST_REQUEST') && REST_REQUEST) {
            return;
        }

        $user_agent = isset($_SERVER['HTTP_USER_AGENT'])
            ? strtolower($_SERVER['HTTP_USER_AGENT'])
            : '';

        if (empty($user_agent)) {
            return;
        }

        $cached = get_transient($this->transient_key);
        if (empty($cached) || !is_array($cached)) {
            // Fail-open: no cache = no blocking, but still report unknown bots
            $this->maybe_report_bot($user_agent);
            return;
        }

        $patterns   = isset($cached['patterns']) && is_array($cached['patterns']) ? $cached['patterns'] : array();
        $block_html = isset($cached['blockPageHtml']) ? $cached['blockPageHtml'] : '';

        // Check UA against blocked patterns — only block what was set in OverSeek
        foreach ($patterns as $pattern) {
            if (!empty($pattern) && strpos($user_agent, $pattern) !== false) {
                $this->serve_block_page($block_html, $pattern);
                return;
            }
        }

        // Not blocked — report to OverSeek if it looks like an unknown bot
        $this->maybe_report_bot($user_agent);
    }

    /**
     * Block bots on WooCommerce Store API checkout endpoints.
     *
     * Hooked into rest_pre_dispatch (priority 1) so it runs before any REST
     * endpoint handler. Only applies to the WooCommerce Store API checkout
     * routes — all other REST endpoints pass through unblocked.
     *
     * Why rest_pre_dispatch: This filter fires after the REST route is resolved
     * but before the endpoint callback runs. Returning a WP_Error here short-
     * circuits the request. Returning null lets it proceed normally.
     *
     * @param mixed            $result  Response to replace the requested result (null to proceed).
     * @param \WP_REST_Server  $server  REST server instance.
     * @param \WP_REST_Request $request Incoming REST request.
     * @return mixed|WP_Error  WP_Error to block, or $result to pass through.
     */
    public function maybe_block_rest_checkout($result, $server, $request)
    {
        // Only guard WooCommerce Store API checkout routes
        $route = $request->get_route();
        $is_checkout = (
            strpos($route, '/wc/store/v1/checkout') !== false ||
            strpos($route, '/wc/store/checkout') !== false
        );

        if (!$is_checkout) {
            return $result;
        }

        $user_agent = isset($_SERVER['HTTP_USER_AGENT'])
            ? strtolower($_SERVER['HTTP_USER_AGENT'])
            : '';

        if (empty($user_agent)) {
            return $result;
        }

        $cached = get_transient($this->transient_key);
        if (empty($cached) || !is_array($cached)) {
            return $result;
        }

        $patterns = isset($cached['patterns']) && is_array($cached['patterns']) ? $cached['patterns'] : array();

        foreach ($patterns as $pattern) {
            if (!empty($pattern) && strpos($user_agent, $pattern) !== false) {
                return new \WP_Error(
                    'bot_blocked',
                    'Automated access to checkout has been restricted.',
                    array('status' => 403)
                );
            }
        }

        return $result;
    }

    /**
     * Fire-and-forget report of an unknown bot UA to the OverSeek server.
     *
     * Why blocking:false + 0.01s timeout: wp_remote_post writes the TCP payload
     * and returns immediately without waiting for a response. The OS handles
     * connection teardown in the background. Real visitors are never in this
     * code path (browser UAs never contain bot signal words), so there is zero
     * performance impact on the store.
     *
     * Deduplication: A 5-minute transient per unique UA prevents the same bot
     * crawling 100 pages from generating 100 HTTP calls to the OverSeek server.
     *
     * @param string $user_agent Lowercased user-agent string.
     */
    private function maybe_report_bot(string $user_agent): void
    {
        // Signal words that indicate automated/bot traffic.
        // Real browsers (Chrome, Firefox, Safari, Edge) never contain these.
        static $signals = [
            'bot', 'crawler', 'spider', 'scraper', 'fetcher',
            'scan', 'curl', 'wget', 'python', 'java/', 'go-http', 'headless',
        ];

        $is_bot_like = false;
        foreach ($signals as $signal) {
            if (strpos($user_agent, $signal) !== false) {
                $is_bot_like = true;
                break;
            }
        }

        if (!$is_bot_like) {
            return;
        }

        // Dedup: only report this UA once per 5 minutes per account
        $dedup_key = 'os_bh_' . OverSeek_Crypto_Utils::hash_key_fragment($this->account_id . $user_agent, self::HASH_LENGTH);
        if (false !== get_transient($dedup_key)) {
            return;
        }
        set_transient($dedup_key, 1, 5 * MINUTE_IN_SECONDS);

        // Retrieve raw UA for the server (we lowercased for matching, send original)
        $raw_ua  = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : $user_agent;
        $raw_url = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';

        // Bug fix: REMOTE_ADDR returns the load-balancer/proxy IP on most production
        // setups (Cloudflare, nginx, AWS ELB). Prefer forwarded headers in priority order.
        // CF-Connecting-IP is set by Cloudflare (most reliable when present).
        // HTTP_X_FORWARDED_FOR may contain a comma-separated list — take the first.
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $raw_ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
        } elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $raw_ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        } else {
            $raw_ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
        }

        // Bug fix: wp_json_encode returns false on failure (e.g. invalid UTF-8 in UA).
        // Abort rather than send a malformed body.
        $body = wp_json_encode(array(
            'accountId' => $this->account_id,
            'userAgent' => substr($raw_ua, 0, 500),
            'url'       => substr($raw_url, 0, 500),
            'ip'        => $raw_ip,
        ));
        if (false === $body) {
            return;
        }

        // Bug fix: 0.01s (10ms) timeout was too aggressive — TCP handshake to a
        // geographically distant server can take 20-100ms, silently dropping reports.
        // 3s is the connection setup budget. With blocking:false, the page response
        // is NOT held — PHP returns as soon as cURL starts the connection attempt.
        wp_remote_post(
            $this->api_url . '/api/t/bot-hit',
            array(
                'blocking' => false,
                'timeout'  => 3,
                'headers'  => array(
                    'Content-Type'     => 'application/json',
                    'X-Plugin-Version' => defined('OVERSEEK_WC_VERSION') ? OVERSEEK_WC_VERSION : 'unknown',
                ),
                'body'     => $body,
            )
        );
    }

    /**
     * Serve the 403 block page and exit.
     *
     * @param string $custom_html Custom HTML template from admin, or empty for default.
     * @param string $matched_pattern The pattern that triggered the block.
     */
    private function serve_block_page(string $custom_html, string $matched_pattern): void
    {
        status_header(403);
        nocache_headers();

        if (!empty($custom_html)) {
            // Replace template placeholders
            $html = str_replace(
                array('{{site_name}}', '{{contact_email}}', '{{crawler_name}}'),
                array(
                    esc_html(get_bloginfo('name')),
                    esc_html(get_option('admin_email', '')),
                    esc_html($matched_pattern),
                ),
                $custom_html
            );
            echo $html; // phpcs:ignore WordPress.Security.EscapeOutput -- admin-authored template
        } else {
            // Default block page
            $site_name = esc_html(get_bloginfo('name'));
            echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Restricted - {$site_name}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; text-align: center; color: #334155; background: #f8fafc; }
    h1 { font-size: 1.5rem; color: #1e293b; margin-bottom: 0.5rem; }
    p { line-height: 1.6; margin: 0.75rem 0; }
    .muted { color: #94a3b8; font-size: 0.85rem; margin-top: 2.5rem; }
    .card { background: white; border-radius: 12px; padding: 2.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Restricted</h1>
    <p>Automated access to <strong>{$site_name}</strong> has been restricted.</p>
    <p>If you believe this is an error, please contact the site administrator.</p>
    <p class="muted">Your request was identified as automated traffic.</p>
  </div>
</body>
</html>
HTML;
        }

        exit;
    }

    /**
     * Sync the blocked crawler list from the OverSeek server.
     * Called by WP-Cron hourly. Stores result as a transient.
     *
     * Why transient: WordPress transients are backed by the object cache
     * (if available) or wp_options. Either way, get_transient() on the
     * next page load is a memory read — no DB query or HTTP call.
     */
    public function sync_blocked_list(): void
    {
        $url = $this->api_url . '/api/crawlers/blocked-agents';

        $response = wp_remote_get($url, array(
            'timeout' => 10,
            'headers' => array(
                'Accept'           => 'application/json',
                'X-Account-ID'     => $this->account_id,
                'X-Plugin-Version' => defined('OVERSEEK_WC_VERSION') ? OVERSEEK_WC_VERSION : 'unknown',
            ),
        ));

        if (is_wp_error($response)) {
            // Fail silently — stale transient still in use
            return;
        }

        $status = wp_remote_retrieve_response_code($response);
        if ($status !== 200) {
            return;
        }

        $data = OverSeek_HTTP_Utils::decode_json_response($response);

        if (!is_array($data)) {
            return;
        }

        $cache_data = array(
            'patterns'      => isset($data['patterns']) && is_array($data['patterns']) ? $data['patterns'] : array(),
            'blockPageHtml' => isset($data['blockPageHtml']) ? $data['blockPageHtml'] : '',
        );

        set_transient($this->transient_key, $cache_data, self::TRANSIENT_TTL);
    }

    /**
     * Clean up on plugin deactivation.
     * Removes cron schedule and transients.
     */
    public static function deactivate(): void
    {
        wp_clear_scheduled_hook(self::CRON_HOOK);

        // Clean up all blocked agent and backoff transients
        global $wpdb;
        $wpdb->query(
            "DELETE FROM {$wpdb->options}
             WHERE option_name LIKE '_transient_overseek_blocked_agents_%'
                OR option_name LIKE '_transient_timeout_overseek_blocked_agents_%'"
        );
    }

}

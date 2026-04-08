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

        $this->transient_key = 'overseek_blocked_agents_' . substr(md5($this->account_id), 0, 8);

        // Schedule hourly sync via WP-Cron
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), 'hourly', self::CRON_HOOK);
        }
        add_action(self::CRON_HOOK, array($this, 'sync_blocked_list'));

        // Check incoming requests — priority 1 to run before tracking/page render
        add_action('template_redirect', array($this, 'maybe_block_request'), 1);

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
            return; // Fail-open: no cache = no blocking
        }

        $patterns  = isset($cached['patterns']) && is_array($cached['patterns']) ? $cached['patterns'] : array();
        $block_html = isset($cached['blockPageHtml']) ? $cached['blockPageHtml'] : '';

        if (empty($patterns)) {
            return;
        }

        // Check UA against blocked patterns
        foreach ($patterns as $pattern) {
            if (!empty($pattern) && strpos($user_agent, $pattern) !== false) {
                $this->serve_block_page($block_html, $pattern);
                return;
            }
        }
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

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

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

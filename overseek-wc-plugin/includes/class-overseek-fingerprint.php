<?php
/**
 * Browser Fingerprint Bot Detection for WooCommerce Checkout.
 *
 * Injects a lightweight JS collector on checkout pages that gathers behavioral
 * signals (pointer events, timing, visibility, webdriver flag). On checkout
 * submit, validates the token and scores it. Bots that skip JS or submit
 * instantly with no interaction score high and are blocked.
 *
 * Scoring is pure PHP arithmetic — no HTTP calls, no DB queries beyond a
 * single transient lookup. Adds <1ms to checkout processing.
 *
 * Fail-soft: missing tokens add risk and can be blocked only when combined
 * with risky context (e.g. bursty checkout attempts). Real customers on
 * normal traffic should still pass.
 *
 * @package OverSeek
 * @since   2.12.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Fingerprint
{
    /** @var self|null Singleton instance for cross-class access. */
    private static ?self $instance = null;

    /** @var string OverSeek API base URL. */
    private string $api_url;

    /** @var string OverSeek account ID. */
    private string $account_id;

    /** @var int|null Cached score for the current request (avoids double-scoring). */
    private ?int $current_score = null;

    /** @var string[] Cached factors for the current request. */
    private array $current_factors = [];

    /** @var int Score threshold for blocking checkout. */
    private const BLOCK_THRESHOLD = 60;

    /** @var int Score threshold for flagging order as suspicious. */
    private const FLAG_THRESHOLD = 40;

    /** @var int Nonce TTL in seconds. */
    private const NONCE_TTL = 600; // 10 minutes

    /** @var int Velocity window in seconds for short burst detection. */
    private const VELOCITY_WINDOW_SHORT = 300; // 5 minutes

    /** @var int Velocity window in seconds for medium burst detection. */
    private const VELOCITY_WINDOW_MEDIUM = 3600; // 1 hour

    public function __construct()
    {
        self::$instance = $this;

        $this->api_url    = untrailingslashit(get_option('overseek_api_url', ''));
        $this->account_id = get_option('overseek_account_id', '');

        if (empty($this->account_id) || empty($this->api_url)) {
            return;
        }

        // Inject collector script on checkout page
        add_action('woocommerce_before_checkout_form', array($this, 'inject_collector'), 1);

        // Blocks checkout: inject via wp_footer on checkout page (Blocks doesn't fire woocommerce_before_checkout_form)
        add_action('wp_footer', array($this, 'inject_collector_blocks'));

        // Validate on classic checkout submit (priority 5 — before tracking at default 10)
        add_action('woocommerce_checkout_process', array($this, 'validate_classic_checkout'), 5);

        // Flag suspicious orders after creation (classic)
        add_action('woocommerce_checkout_order_created', array($this, 'flag_order_if_suspicious'), 10, 1);

        // Validate on Blocks/Store API checkout (priority 1 — earliest)
        add_action('woocommerce_store_api_checkout_order_processed', array($this, 'validate_blocks_checkout'), 1, 1);
    }

    /**
     * Inject the fingerprint collector script on classic checkout pages.
     */
    public function inject_collector(): void
    {
        $nonce = $this->generate_and_store_nonce();
        if (!$nonce) {
            return;
        }

        $script_url = esc_url($this->api_url . '/api/fp/collect.js');
        $nonce_attr = esc_attr($nonce);
        $version    = esc_attr(defined('OVERSEEK_WC_VERSION') ? OVERSEEK_WC_VERSION : '0');

        echo "<!-- OverSeek Bot Shield v{$version} -->\n";
        echo "<script src=\"{$script_url}\" data-nonce=\"{$nonce_attr}\" defer async></script>\n";
    }

    /**
     * Inject collector for Blocks-based checkout (fires via wp_footer).
     * Only outputs if we're on a page that has the checkout block and the
     * classic checkout hook didn't already fire.
     */
    public function inject_collector_blocks(): void
    {
        // Skip if classic checkout already injected
        if (did_action('woocommerce_before_checkout_form') > 0) {
            return;
        }

        // Only inject on pages with the checkout block
        if (!function_exists('has_block') || !has_block('woocommerce/checkout')) {
            return;
        }

        $nonce = $this->generate_and_store_nonce();
        if (!$nonce) {
            return;
        }

        $script_url = esc_url($this->api_url . '/api/fp/collect.js');
        $nonce_attr = esc_attr($nonce);

        echo "<script src=\"{$script_url}\" data-nonce=\"{$nonce_attr}\" defer async></script>\n";
    }

    /**
     * Validate fingerprint on classic checkout submission.
     * Adds a WooCommerce notice error to prevent order creation if bot-likely.
     */
    public function validate_classic_checkout(): void
    {
        $token = isset($_POST['_os_fp']) ? sanitize_text_field(wp_unslash($_POST['_os_fp'])) : '';
        $email = isset($_POST['billing_email']) ? sanitize_email(wp_unslash($_POST['billing_email'])) : '';
        $score = $this->score_token($token, $email);

        if ($score >= self::BLOCK_THRESHOLD) {
            wc_add_notice(
                __('We were unable to process your order. Please refresh the page and try again, or contact support if the issue persists.', 'overseek-wc'),
                'error'
            );
        }
    }

    /**
     * Flag the order as suspicious after creation if score is in the warning range.
     *
     * @param \WC_Order $order The newly created order.
     */
    public function flag_order_if_suspicious($order): void
    {
        if ($this->current_score === null) {
            return;
        }

        if ($this->current_score >= self::FLAG_THRESHOLD) {
            $order->update_meta_data('_os_fp_score', $this->current_score);
            $order->update_meta_data('_os_fp_factors', implode(', ', $this->current_factors));
            $order->update_meta_data('_os_fp_suspicious', '1');
            $order->save();
        }
    }

    /**
     * Validate fingerprint on Blocks/Store API checkout.
     *
     * @param \WC_Order $order The order being processed.
     */
    public function validate_blocks_checkout($order): void
    {
        $token = isset($_SERVER['HTTP_X_OS_FP']) ? sanitize_text_field($_SERVER['HTTP_X_OS_FP']) : '';
        $email = '';
        if (is_object($order) && method_exists($order, 'get_billing_email')) {
            $email = sanitize_email((string) $order->get_billing_email());
        }
        $score = $this->score_token($token, $email);

        if ($score >= self::BLOCK_THRESHOLD) {
            // Store API expects a RouteException or WP_Error-compatible exception
            if (class_exists('\Automattic\WooCommerce\StoreApi\Exceptions\RouteException')) {
                throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException(
                    'os_bot_detected',
                    __('We were unable to process your order. Please refresh the page and try again.', 'overseek-wc'),
                    403
                );
            }
        }

        if ($score >= self::FLAG_THRESHOLD) {
            $order->update_meta_data('_os_fp_score', $score);
            $order->update_meta_data('_os_fp_factors', implode(', ', $this->current_factors));
            $order->update_meta_data('_os_fp_suspicious', '1');
            $order->save();
        }
    }

    /**
     * Score a fingerprint token.
     *
     * @param string $token Base64-encoded JSON token from the collector JS.
     * @param string $email Billing email when available.
     * @return int Score (0 = clean, higher = more suspicious).
     */
    private function score_token(string $token, string $email = ''): int
    {
        // Return cached score if already computed this request
        if ($this->current_score !== null) {
            return $this->current_score;
        }

        $score   = 0;
        $factors = array();
        $velocity = $this->score_checkout_velocity($email);
        $score += $velocity['score'];
        $factors = array_merge($factors, $velocity['factors']);

        // Missing token = fail-soft:
        // low-risk requests pass with mild risk, high-risk requests are challenged/blocked.
        if (empty($token)) {
            $score += 10;
            $factors[] = 'Token missing';

            if ($velocity['score'] >= 20 || $this->is_suspicious_user_agent()) {
                $score += 50;
                $factors[] = 'Token missing in risky context (challenge required)';
            } else {
                $score += 5;
                $factors[] = 'Token missing in low-risk context (fail-soft)';
            }

            $this->current_score   = $score;
            $this->current_factors = $factors;
            return $score;
        }

        // Decode token
        $decoded = base64_decode($token, true);
        if ($decoded === false) {
            $score += 10;
            $factors[] = 'Invalid base64 encoding';
            $this->current_score   = $score;
            $this->current_factors = $factors;
            return $score;
        }

        $data = json_decode($decoded, true);
        if (!is_array($data)) {
            $score += 10;
            $factors[] = 'Invalid JSON in token';
            $this->current_score   = $score;
            $this->current_factors = $factors;
            return $score;
        }

        // Validate nonce
        $nonce = isset($data['n']) ? $data['n'] : '';
        if (!$this->validate_nonce($nonce)) {
            $score += 15;
            $factors[] = 'Invalid or expired nonce';
        }

        // Score: navigator.webdriver
        if (!empty($data['w'])) {
            $score += 40;
            $factors[] = 'navigator.webdriver is true';
        }

        // Score: pointer event count
        $pointer_count = isset($data['e']) ? intval($data['e']) : 0;
        if ($pointer_count === 0) {
            $score += 30;
            $factors[] = 'Zero pointer events before submit';
        }

        // Score: trusted interaction signals (harder to fake than plain counters)
        $trusted_pointer = isset($data['pt']) ? intval($data['pt']) : 0;
        if ($trusted_pointer === 0) {
            $score += 12;
            $factors[] = 'No trusted pointerdown events';
        }

        $key_count = isset($data['k']) ? intval($data['k']) : 0;
        $trusted_keys = isset($data['kt']) ? intval($data['kt']) : 0;
        if ($key_count > 0 && $trusted_keys === 0) {
            $score += 10;
            $factors[] = 'Keyboard events present but none trusted';
        }

        // Score: time to submit
        $time_ms = isset($data['t']) ? intval($data['t']) : 0;
        if ($time_ms < 2000) {
            $score += 25;
            $factors[] = 'Submitted in under 2 seconds';
        } elseif ($time_ms < 5000) {
            $score += 15;
            $factors[] = 'Submitted in under 5 seconds';
        }

        // Score: tab visibility
        $was_visible = isset($data['v']) ? intval($data['v']) : 1;
        if ($was_visible === 0) {
            $score += 20;
            $factors[] = 'Tab was never visible';
        }

        // Score: screen dimensions
        $screen_dims = isset($data['s']) ? $data['s'] : '';
        if ($this->screen_dims_suspicious($screen_dims)) {
            $score += 10;
            $factors[] = 'Suspicious screen dimensions';
        }

        // Score: languages count
        $lang_count = isset($data['l']) ? intval($data['l']) : 1;
        if ($lang_count === 0) {
            $score += 10;
            $factors[] = 'No navigator.languages';
        }

        $this->current_score   = $score;
        $this->current_factors = $factors;
        return $score;
    }

    /**
     * Score bursty checkout behavior over short windows.
     * Uses transients keyed by account + IP/visitor/email hash.
     *
     * @param string $email Billing email when available.
     * @return array{score:int,factors:string[]}
     */
    private function score_checkout_velocity(string $email): array
    {
        $score = 0;
        $factors = array();

        $visitor_id = $this->get_visitor_id() ?? 'none';
        $ip = $this->get_client_ip();
        $email_hash = !empty($email) ? substr(md5(strtolower($email)), 0, 16) : 'none';

        $ip_short = $this->increment_velocity_counter('ip_short_' . md5($ip), self::VELOCITY_WINDOW_SHORT);
        if ($ip_short >= 10) {
            $score += 35;
            $factors[] = 'High checkout burst from IP (5m)';
        } elseif ($ip_short >= 6) {
            $score += 20;
            $factors[] = 'Elevated checkout burst from IP (5m)';
        }

        $visitor_short = $this->increment_velocity_counter('visitor_short_' . md5($visitor_id), self::VELOCITY_WINDOW_SHORT);
        if ($visitor_short >= 7) {
            $score += 25;
            $factors[] = 'High checkout burst from visitor (5m)';
        } elseif ($visitor_short >= 4) {
            $score += 15;
            $factors[] = 'Elevated checkout burst from visitor (5m)';
        }

        if ($email_hash !== 'none') {
            $email_medium = $this->increment_velocity_counter('email_medium_' . $email_hash, self::VELOCITY_WINDOW_MEDIUM);
            if ($email_medium >= 8) {
                $score += 30;
                $factors[] = 'High checkout burst from email (1h)';
            } elseif ($email_medium >= 4) {
                $score += 15;
                $factors[] = 'Elevated checkout burst from email (1h)';
            }
        }

        return array('score' => $score, 'factors' => $factors);
    }

    /**
     * Increment a transient counter in a fixed window and return the new count.
     *
     * @param string $suffix Counter key suffix.
     * @param int    $ttl    Window TTL in seconds.
     * @return int Current count in the active window.
     */
    private function increment_velocity_counter(string $suffix, int $ttl): int
    {
        $key = '_os_fp_vel_' . substr(md5($this->account_id . '_' . $suffix), 0, 24);
        $data = get_transient($key);
        $now = time();

        if (!is_array($data) || !isset($data['count'], $data['start']) || ($now - intval($data['start'])) > $ttl) {
            $data = array('count' => 1, 'start' => $now);
            set_transient($key, $data, $ttl);
            return 1;
        }

        $count = intval($data['count']) + 1;
        $data['count'] = $count;
        set_transient($key, $data, max(1, $ttl - ($now - intval($data['start']))));
        return $count;
    }

    /**
     * Determine whether user agent is likely automation tooling.
     *
     * @return bool True if UA appears suspicious.
     */
    private function is_suspicious_user_agent(): bool
    {
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower((string) $_SERVER['HTTP_USER_AGENT']) : '';
        if (empty($ua)) {
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

    /**
     * Resolve the client IP behind reverse proxies when present.
     *
     * @return string IP address string or "unknown".
     */
    private function get_client_ip(): string
    {
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            return sanitize_text_field((string) $_SERVER['HTTP_CF_CONNECTING_IP']);
        }

        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $xff = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
            return sanitize_text_field(trim($xff[0]));
        }

        if (!empty($_SERVER['REMOTE_ADDR'])) {
            return sanitize_text_field((string) $_SERVER['REMOTE_ADDR']);
        }

        return 'unknown';
    }

    /**
     * Check if screen dimensions look suspicious.
     * Format: "screenWxscreenH:innerWxinnerH"
     *
     * @param string $dims Dimension string from collector.
     * @return bool True if suspicious.
     */
    private function screen_dims_suspicious(string $dims): bool
    {
        if (empty($dims)) {
            return true;
        }

        $parts = explode(':', $dims);
        if (count($parts) !== 2) {
            return true;
        }

        $screen = explode('x', $parts[0]);
        $inner  = explode('x', $parts[1]);

        if (count($screen) !== 2 || count($inner) !== 2) {
            return true;
        }

        $sw = intval($screen[0]);
        $sh = intval($screen[1]);
        $iw = intval($inner[0]);
        $ih = intval($inner[1]);

        // 0x0 screen = headless default
        if ($sw === 0 || $sh === 0) {
            return true;
        }

        // Screen exactly equals inner viewport = no browser chrome = likely headless
        if ($sw === $iw && $sh === $ih) {
            return true;
        }

        return false;
    }

    /**
     * Generate a nonce and store it in a WordPress transient.
     *
     * @return string|null The nonce, or null on failure.
     */
    private function generate_and_store_nonce(): ?string
    {
        $visitor_id = $this->get_visitor_id();
        if (!$visitor_id) {
            return null;
        }

        $nonce = wp_generate_password(32, false);
        $key   = $this->nonce_transient_key($visitor_id);

        set_transient($key, $nonce, self::NONCE_TTL);
        return $nonce;
    }

    /**
     * Validate a nonce against the stored transient. Single-use — deletes after validation.
     *
     * @param string $nonce The nonce to validate.
     * @return bool True if valid.
     */
    private function validate_nonce(string $nonce): bool
    {
        if (empty($nonce)) {
            return false;
        }

        $visitor_id = $this->get_visitor_id();
        if (!$visitor_id) {
            return false;
        }

        $key    = $this->nonce_transient_key($visitor_id);
        $stored = get_transient($key);

        if ($stored === false || !hash_equals((string) $stored, $nonce)) {
            return false;
        }

        // Single-use: delete after successful validation
        delete_transient($key);
        return true;
    }

    /**
     * Get the visitor ID from the OverSeek cookie.
     *
     * @return string|null Visitor UUID or null.
     */
    private function get_visitor_id(): ?string
    {
        return isset($_COOKIE['_os_vid']) ? sanitize_text_field($_COOKIE['_os_vid']) : null;
    }

    /**
     * Build the transient key for a visitor's nonce.
     *
     * @param string $visitor_id Visitor UUID.
     * @return string Transient key.
     */
    private function nonce_transient_key(string $visitor_id): string
    {
        return '_os_fp_nonce_' . substr(md5($this->account_id . $visitor_id), 0, 16);
    }

    /**
     * Get the score computed during this request (for use by tracking).
     *
     * @return int|null Score or null if not yet computed.
     */
    public function get_current_score(): ?int
    {
        return $this->current_score;
    }

    /**
     * Static accessor for the singleton instance's score.
     * Used by OverSeek_Server_Tracking to include fpScore in event payloads.
     *
     * @return int|null Score or null if fingerprint class not initialized or not scored.
     */
    public static function get_score(): ?int
    {
        return self::$instance?->current_score;
    }
}

<?php
/**
 * Web Vitals Collector
 *
 * Injects a small ES module into the page footer that collects Core Web
 * Vitals (LCP, CLS, INP, FCP, TTFB) from real visitors and beacons them
 * to the OverSeek server when the page is hidden/unloaded.
 *
 * Performance impact: ZERO blocking JS. The script is a <script type="module">
 * (deferred by the browser), uses the web-vitals library (~2KB gzipped) from
 * a CDN with long-lived caching, and sends data via sendBeacon() on unload
 * — never during page load.
 *
 * @package OverSeek
 * @since   2.9.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Web_Vitals
{
    /** @var string OverSeek API base URL. */
    private string $api_url;

    /** @var string OverSeek account ID. */
    private string $account_id;

    /** @var int Sampling rate 1–100. 100 = collect from every page load. */
    private int $sample_rate;

    /** web-vitals v4 CDN URL — pinned to a specific version for stability. */
    private const WEB_VITALS_CDN = 'https://unpkg.com/web-vitals@4/dist/web-vitals.attribution.js';

    /**
     * Initialize Web Vitals collector.
     * Hooks into wp_footer at priority 99 (late, after theme content).
     */
    public function __construct()
    {
        $this->api_url     = untrailingslashit(get_option('overseek_api_url', ''));
        $this->account_id  = get_option('overseek_account_id', '');
        $this->sample_rate = (int) get_option('overseek_vitals_sample_rate', 100);

        if (empty($this->account_id) || empty($this->api_url)) {
            return;
        }

        if (!get_option('overseek_enable_vitals', '1')) {
            return;
        }

        // Guard: WooCommerce page-type conditionals (is_product, is_cart etc.) only
        // exist when WooCommerce is active. If WC is missing, don't inject at all
        // rather than trigger fatal errors on wp_footer.
        if (!class_exists('WooCommerce')) {
            return;
        }

        add_action('wp_footer', array($this, 'inject_collector'), 99);
    }

    /**
     * Inject the Web Vitals collector script.
     *
     * Why wp_footer at priority 99: We need to be after the page content so
     * that the page type conditionals (is_product, is_cart, etc.) are resolved
     * and the WP_Query has run. Priority 99 ensures we're last.
     */
    public function inject_collector(): void
    {
        // Skip admin, AJAX, cron, REST — only collect on real page views
        if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
            return;
        }

        if (defined('REST_REQUEST') && REST_REQUEST) {
            return;
        }

        $endpoint  = esc_js($this->api_url . '/api/t/vitals');
        $account_id = esc_js($this->account_id);
        $sample_rate = (int) $this->sample_rate;
        $page_type  = esc_js($this->get_page_type());

        // Detect device type server-side for segmentation
        $device = esc_js($this->get_device_type());

        ?>
        <script type="module">
        // OverSeek Web Vitals Collector v<?php echo esc_js(OVERSEEK_WC_VERSION); ?>
        // Sampling: <?php echo $sample_rate; ?>% of page loads
        (function() {
            // Honour sampling rate — exit early for unsampled sessions
            if (Math.random() * 100 > <?php echo $sample_rate; ?>) return;

            const ENDPOINT   = '<?php echo $endpoint; ?>';
            const ACCOUNT_ID = '<?php echo $account_id; ?>';
            const PAGE_TYPE  = '<?php echo $page_type; ?>';
            const DEVICE     = '<?php echo $device; ?>';

            // Collect all 5 metrics in a batch and send once on page hide
            const batch = [];
            let sent = false;

            function getEffectiveType() {
                try {
                    return navigator.connection?.effectiveType || null;
                } catch(e) {
                    return null;
                }
            }

            function sendBatch() {
                if (sent || !batch.length) return;
                sent = true;
                const payload = JSON.stringify({
                    accountId: ACCOUNT_ID,
                    samples:   batch,
                });
                // sendBeacon is fire-and-forget, non-blocking, survives page unload
                if (navigator.sendBeacon) {
                    const blob = new Blob([payload], { type: 'application/json' });
                    navigator.sendBeacon(ENDPOINT, blob);
                } else {
                    // Fallback for older browsers
                    fetch(ENDPOINT, {
                        method: 'POST',
                        body: payload,
                        headers: { 'Content-Type': 'application/json' },
                        keepalive: true,
                    }).catch(() => {});
                }
            }

            function onMetric({ name, value, rating }) {
                const url = location.pathname;
                batch.push({
                    metric:        name,
                    value:         value,
                    rating:        rating,
                    url:           url,
                    pageType:      PAGE_TYPE,
                    device:        DEVICE,
                    effectiveType: getEffectiveType(),
                });
            }

            // Import web-vitals from CDN — loaded as ES module (deferred by browser)
            import('<?php echo esc_js(self::WEB_VITALS_CDN); ?>')
                .then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
                    onLCP(onMetric,  { reportAllChanges: false });
                    onCLS(onMetric,  { reportAllChanges: false });
                    onINP(onMetric,  { reportAllChanges: false });
                    onFCP(onMetric,  { reportAllChanges: false });
                    onTTFB(onMetric, { reportAllChanges: false });
                })
                .catch(() => {}); // Fail silently if CDN unreachable

            // Send batch when tab goes into background or page is closed
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') sendBatch();
            });

            // Fallback: send on pagehide (iOS Safari)
            window.addEventListener('pagehide', sendBatch, { capture: true });
        })();
        </script>
        <?php
    }

    /**
     * Detect the WooCommerce page type for the current request.
     * Used for segmenting vitals by page type in the dashboard.
     *
     * @return string One of: product|category|cart|checkout|home|other
     */
    private function get_page_type(): string
    {
        if (is_product()) {
            return 'product';
        }

        if (is_product_category() || is_product_tag() || is_shop()) {
            return 'category';
        }

        if (is_cart()) {
            return 'cart';
        }

        if (is_checkout()) {
            return 'checkout';
        }

        if (is_front_page() || is_home()) {
            return 'home';
        }

        return 'other';
    }

    /**
     * Detect device type from User-Agent server-side.
     * Coarse detection — good enough for performance segmentation.
     *
     * @return string One of: mobile|tablet|desktop
     */
    private function get_device_type(): string
    {
        $ua = strtolower($_SERVER['HTTP_USER_AGENT'] ?? '');

        if (empty($ua)) {
            return 'desktop';
        }

        // Tablet patterns checked first (iPads report as mobile in UA)
        if (preg_match('/ipad|tablet|(android(?!.*mobile))/i', $ua)) {
            return 'tablet';
        }

        if (preg_match('/mobile|iphone|ipod|android.*mobile|blackberry|windows phone/i', $ua)) {
            return 'mobile';
        }

        return 'desktop';
    }
}

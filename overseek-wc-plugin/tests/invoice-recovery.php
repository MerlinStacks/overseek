<?php
/** Customer invoice recovery exercises the real download controller. */
declare(strict_types=1);

if (!isset($argv[1])) {
    foreach (['pending', 'failed', 'ready', 'unauthorized'] as $mode) {
        passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($mode), $status);
        if ($status !== 0) exit($status);
    }
    echo "Invoice recovery checks passed.\n";
    exit;
}
define('ABSPATH', __DIR__);
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
function absint($value) { return abs((int) $value); }
function get_current_user_id() { return 0; }
function get_option($key, $default = '') { return ['blog_charset' => 'UTF-8', 'admin_email' => 'help@store.test'][$key] ?? $default; }
function wp_hash($value) { return hash('sha256', $value); }
function wc_get_order($id) { return $GLOBALS['order']; }
function rest_url($path) { return 'https://store.test/wp-json/' . $path; }
function add_query_arg($key, $value, $url) { return $url . (str_contains($url, '?') ? '&' : '?') . urlencode($key) . '=' . urlencode((string) $value); }
function sanitize_text_field($value) { return strip_tags($value); }
function sanitize_email($value) { return $value; }
function wp_unslash($value) { return $value; }
function esc_html($value) { return htmlspecialchars($value, ENT_QUOTES); }
function esc_url($value) { return esc_html($value); }
function esc_url_raw($value) { return $value; }
function __($value, $domain = '') { return $value; }
function esc_html_e($value, $domain = '') { echo esc_html($value); }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function wc_get_page_permalink($page) { return 'https://store.test/account'; }
function status_header($code) { $GLOBALS['http_status'] = $code; }
function nocache_headers() {}
function language_attributes() { echo 'lang="en"'; }
function bloginfo($key) { echo 'UTF-8'; }
class WP_REST_Request {
    public function get_param($key) { return $_GET[$key] ?? null; }
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status) {}
}
class WC_Order {
    public string $status = 'failed';
    public function get_id() { return 123; }
    public function get_order_number() { return '123'; }
    public function get_order_key() { return 'secret'; }
    public function get_meta($key) { return $this->status; }
    public function read_meta_data($force) { $this->status = $GLOBALS['mode'] === 'ready' ? 'ready' : $GLOBALS['mode']; }
}
require __DIR__ . '/../includes/class-overseek-order-invoices.php';
require __DIR__ . '/../includes/class-overseek-api.php';
class Recovery_Service extends OverSeek_Order_Invoices {
    public array $calls = [];
    public function __construct() { (new ReflectionProperty(OverSeek_Order_Invoices::class, 'instance'))->setValue(null, $this); }
    public function user_can_access_invoice(WC_Order $order, ?int $user_id = null): bool { return false; }
    public function invoice_is_available(int $order_id): bool { return count($this->calls) > 0 && $GLOBALS['mode'] === 'ready'; }
    public function try_generate_invoice_now(int $order_id, int $timeout_seconds = 6, bool $force_regenerate = false, bool $revalidate_remote = false): bool {
        $this->calls[] = [$order_id, $timeout_seconds, $force_regenerate, $revalidate_remote];
        return $GLOBALS['mode'] === 'ready';
    }
    public function get_invoice_file_path(int $order_id): string { return __FILE__; }
}
$mode = $argv[1];
$order = new WC_Order();
$service = new Recovery_Service();
$api = (new ReflectionClass(OverSeek_API::class))->newInstanceWithoutConstructor();
$_GET = ['order_id' => '123', 'invoice_token' => wp_hash('123|secret|overseek_invoice_access'), 'regenerate_invoice' => '1'];
if ($mode === 'unauthorized') $_GET['invoice_token'] = 'invalid';
ob_start();
register_shutdown_function(function () use ($service, $mode) {
    $html = ob_get_clean();
    if ($mode === 'unauthorized') {
        check(count($service->calls) === 0, 'Unauthorized request must not generate');
        echo "Unauthorized invoice access check passed.\n";
        return;
    }
    check(count($service->calls) === 1, 'One canonical check, not two generation requests');
    check($service->calls[0] === [123, 25, false, false], 'Old customer regenerate links must never force rebuild');
    if ($mode === 'ready') {
        check($html === file_get_contents(__FILE__), 'Ready invoice is streamed even after an old failed local state');
    } elseif ($mode === 'pending') {
        check($GLOBALS['http_status'] === 202, 'Preparing invoice returns 202');
        check(str_contains($html, 'window.location.replace(url)'), 'Pending invoice checks automatically');
        check(str_contains($html, '120000'), 'Automatic checks are bounded');
        check(str_contains($html, 'invoice_token='), 'Checks preserve guest authorization');
        check(!str_contains($html, 'regenerate_invoice='), 'Checks do not replay regeneration');
    } else {
        check(!str_contains($html, 'window.location.replace'), 'Terminal failure does not poll indefinitely');
        check(str_contains($html, 'mailto:help@store.test'), 'Terminal failure offers store support');
    }
    if ($mode !== 'ready') check(!str_contains($html, 'Regenerate invoice'), 'No misleading regenerate loop');
    echo $mode . " invoice recovery check passed.\n";
});
$response = $api->invoice_download_callback(new WP_REST_Request());
check($mode === 'unauthorized' && $response->status === 401, 'Invalid token is denied');

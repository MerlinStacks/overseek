<?php
/** Invoice retries retain existing PDFs and continue after order completion. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
define('HOUR_IN_SECONDS', 3600);
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
function get_option($key, $default = '') { return ['overseek_api_url' => 'https://api.test', 'overseek_account_id' => 'account', 'overseek_relay_api_key' => 'secret'][$key] ?? $default; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function trailingslashit($value) { return rtrim($value, '/') . '/'; }
function add_action(...$args) {}
function wp_next_scheduled(...$args) { return false; }
function wp_schedule_event(...$args) {}
function wp_schedule_single_event(...$args) { $GLOBALS['scheduled'][] = $args; }
function wc_get_order($id) { return $GLOBALS['order']; }
function sanitize_text_field($value) { return strip_tags($value); }
function home_url() { return 'https://store.test'; }
function wc_prices_include_tax() { return true; }
function wp_json_encode($value) { return json_encode($value); }
function wp_remote_post($url, $args) { $GLOBALS['requests'][] = $args; return $GLOBALS['response']; }
function is_wp_error($value) { return false; }
function wp_remote_retrieve_response_code($value) { return $value['code']; }
function esc_url_raw($value) { return $value; }
function wp_upload_dir() { return ['basedir' => $GLOBALS['directory']]; }
function wp_mkdir_p($dir) { return is_dir($dir) || mkdir($dir, 0777, true); }
function wp_delete_file($path) { unlink($path); }
function wp_unique_filename($dir, $file) { return uniqid() . '-' . $file; }
class OverSeek_HTTP_Utils { public static function decode_json_response($response) { return $response['body']; } }
class WC_Order {
    public array $meta = [];
    public function get_id() { return 123; }
    public function get_order_number() { return '123'; }
    public function get_status() { return 'completed'; }
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function save() {}
}
require __DIR__ . '/../includes/class-overseek-order-invoices.php';
$directory = sys_get_temp_dir() . '/invoice-storage-' . uniqid();
mkdir($directory);
$previous = $directory . '/previous.pdf';
file_put_contents($previous, '%PDF-previous');
$order = new WC_Order();
$order->meta = ['_overseek_invoice_private_path' => $previous, '_overseek_invoice_renderer_version' => 'operational-a4-v5', '_overseek_invoice_status' => 'ready'];
$service = new OverSeek_Order_Invoices();
$response = ['code' => 409, 'body' => ['status' => 'reconciliation_required', 'error' => 'Requires review']];
check(!$service->try_generate_invoice_now(123, 30, true, true), 'Rejected replacement does not claim success');
check(file_get_contents($previous) === '%PDF-previous', 'Rejected replacement must not delete existing PDF');
check($service->invoice_is_available(123), 'Last good PDF remains downloadable despite replacement failure');

// Simulate retention cleanup followed by a customer request and a pending relay.
unlink($previous);
$response = ['code' => 202, 'body' => []];
check(!$service->try_generate_invoice_now(123, 25), 'Missing retained PDF queues recovery');
check(count($GLOBALS['scheduled']) === 1, 'Pending recovery is retried in the background');
$before = count($GLOBALS['requests']);
$response = ['code' => 200, 'body' => ['pdf_base64' => base64_encode('%PDF-restored'), 'invoice_ref' => 'artifact']];
$service->process_processing_order(123);
check(count($GLOBALS['requests']) === $before + 1, 'Completed orders continue background invoice recovery');
check($service->invoice_is_available(123), 'Background recovery restores missing PDF');
check(file_get_contents($service->get_invoice_file_path(123)) === '%PDF-restored', 'Restored PDF is stored');

unlink($service->get_invoice_file_path(123));
unlink($directory . '/overseek-private/invoices/.htaccess');
unlink($directory . '/overseek-private/invoices/index.php');
rmdir($directory . '/overseek-private/invoices');
rmdir($directory . '/overseek-private');
rmdir($directory);
echo "Invoice storage and completed-order retry checks passed.\n";

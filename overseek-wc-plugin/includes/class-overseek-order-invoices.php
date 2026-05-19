<?php
/**
 * Order invoice sync for WooCommerce processing status.
 *
 * @package OverSeek
 * @since   2.16.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Order_Invoices
{
    private static ?OverSeek_Order_Invoices $instance = null;

    private const CLEANUP_HOOK = 'overseek_invoice_cleanup_daily';
    private const PROCESSING_HOOK = 'overseek_invoice_generate_for_processing_order';
    private const META_INVOICE_PATH = '_overseek_invoice_private_path';
    private const META_INVOICE_FILE = '_overseek_invoice_file_name';
    private const META_INVOICE_REF = '_overseek_invoice_ref';
    private const META_INVOICE_GENERATED_AT = '_overseek_invoice_generated_at';
    private const META_INVOICE_STATUS = '_overseek_invoice_status';
    private const META_INVOICE_ERROR = '_overseek_invoice_error';
    private const META_INVOICE_RENDERER = '_overseek_invoice_renderer';
    private const META_INVOICE_DIAGNOSTIC_REASON = '_overseek_invoice_diagnostic_reason';
    private const META_INVOICE_RETRY_COUNT = '_overseek_invoice_retry_count';
    private const META_INVOICE_RENDERER_VERSION = '_overseek_invoice_renderer_version';
    private const CURRENT_RENDERER_VERSION = 'operational-a4-v3';
    private const INVOICE_ALLOWED_ORDER_STATUSES = ['processing', 'completed'];

    private string $api_url;
    private string $account_id;
    private string $relay_api_key;

    public function __construct()
    {
        self::$instance = $this;

        $this->api_url = untrailingslashit((string) get_option('overseek_api_url', ''));
        $this->account_id = (string) get_option('overseek_account_id', '');
        $this->relay_api_key = (string) get_option('overseek_relay_api_key', '');

        add_action('woocommerce_order_status_processing', [$this, 'handle_processing_order'], 20, 1);
        add_action('woocommerce_new_order', [$this, 'handle_new_order'], 20, 1);
        add_action(self::PROCESSING_HOOK, [$this, 'process_processing_order'], 10, 1);
        add_action(self::CLEANUP_HOOK, [$this, 'cleanup_private_invoices']);

        if (!wp_next_scheduled(self::CLEANUP_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK);
        }
    }

    public static function get_instance(): ?OverSeek_Order_Invoices
    {
        return self::$instance;
    }

    public static function clear_scheduled_cleanup(): void
    {
        $timestamp = wp_next_scheduled(self::CLEANUP_HOOK);
        while ($timestamp) {
            wp_unschedule_event($timestamp, self::CLEANUP_HOOK);
            $timestamp = wp_next_scheduled(self::CLEANUP_HOOK);
        }

        wp_clear_scheduled_hook(self::PROCESSING_HOOK);
    }

    public function handle_processing_order(int $order_id): void
    {
        if (!get_option('overseek_enable_processing_invoice_sync', '1') || $order_id <= 0) {
            return;
        }

        if (!wp_next_scheduled(self::PROCESSING_HOOK, [$order_id])) {
            $order = wc_get_order($order_id);
            if ($order) {
                $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
                $order->update_meta_data(self::META_INVOICE_RETRY_COUNT, 0);
                $order->save();
            }
            wp_schedule_single_event(time() + 2, self::PROCESSING_HOOK, [$order_id]);
        }
    }

    public function handle_new_order(int $order_id): void
    {
        if (!get_option('overseek_enable_processing_invoice_sync', '1') || $order_id <= 0) {
            return;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        if ($order->get_status() !== 'processing') {
            return;
        }

        $status = (string) $order->get_meta(self::META_INVOICE_STATUS);
        if (in_array($status, ['pending', 'ready'], true)) {
            return;
        }

        if (!wp_next_scheduled(self::PROCESSING_HOOK, [$order_id])) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
            $order->update_meta_data(self::META_INVOICE_RETRY_COUNT, 0);
            $order->save();
            wp_schedule_single_event(time() + 2, self::PROCESSING_HOOK, [$order_id]);
        }
    }

    public function process_processing_order(int $order_id): void
    {
        if (!get_option('overseek_enable_processing_invoice_sync', '1') || $order_id <= 0) {
            return;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        $order_status = $this->normalize_order_status((string) $order->get_status());
        if (!in_array($order_status, self::INVOICE_ALLOWED_ORDER_STATUSES, true)) {
            $this->set_invoice_status($order, 'failed', 'Invoice generation skipped because order status is ' . $order_status . '.');
            return;
        }

        $this->generate_invoice_for_order($order, 8);
    }

    private function normalize_order_status(string $status): string
    {
        $normalized = strtolower(trim($status));
        if (strpos($normalized, 'wc-') === 0) {
            $normalized = substr($normalized, 3);
        }

        return $normalized;
    }

    private function schedule_processing_retry(int $order_id, int $delay_seconds = 60): void
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        if ($delay_seconds <= 0) {
            $attempt = (int) $order->get_meta(self::META_INVOICE_RETRY_COUNT);
            $delays = [5, 10, 20, 40, 60];
            $index = min(max(0, $attempt), count($delays) - 1);
            $delay = $delays[$index];

            $order->update_meta_data(self::META_INVOICE_RETRY_COUNT, $attempt + 1);
            $order->save();
        } else {
            $delay = max(5, $delay_seconds);
        }

        if (!wp_next_scheduled(self::PROCESSING_HOOK, [$order_id])) {
            wp_schedule_single_event(time() + $delay, self::PROCESSING_HOOK, [$order_id]);
        }
    }

    private function set_invoice_status(WC_Order $order, string $status, string $error_message = ''): void
    {
        $normalized_status = in_array($status, ['pending', 'ready', 'failed'], true) ? $status : 'pending';
        $order->update_meta_data(self::META_INVOICE_STATUS, $normalized_status);

        if ($normalized_status === 'ready' || $normalized_status === 'failed') {
            $order->delete_meta_data(self::META_INVOICE_RETRY_COUNT);
        }

        if ($error_message !== '') {
            $order->update_meta_data(self::META_INVOICE_ERROR, sanitize_text_field($error_message));
        } elseif ($normalized_status !== 'failed') {
            $order->delete_meta_data(self::META_INVOICE_ERROR);
        }
        $order->save();
    }

    private function generate_invoice_for_order(WC_Order $order, int $timeout_seconds = 8, bool $force_regenerate = false, bool $revalidate_remote = false): bool
    {
        $order_id = (int) $order->get_id();

        if (!$force_regenerate && !$revalidate_remote) {
            $existing_path = (string) $order->get_meta(self::META_INVOICE_PATH);
            if ($existing_path !== '') {
                if (file_exists($existing_path) && is_readable($existing_path)) {
                    $renderer_version = (string) $order->get_meta(self::META_INVOICE_RENDERER_VERSION);
                    if ($renderer_version === self::CURRENT_RENDERER_VERSION) {
                        if ((string) $order->get_meta(self::META_INVOICE_STATUS) === '') {
                            $order->update_meta_data(self::META_INVOICE_STATUS, 'ready');
                            $order->save();
                        }
                        return true;
                    }

                    if ((string) $order->get_meta(self::META_INVOICE_STATUS) === 'ready') {
                        $order->update_meta_data(self::META_INVOICE_STATUS, 'ready');
                        $order->save();
                    }
                }

                $order->delete_meta_data(self::META_INVOICE_PATH);
                $order->delete_meta_data(self::META_INVOICE_FILE);
                $order->delete_meta_data(self::META_INVOICE_RENDERER_VERSION);
                $order->save();
            }
        }

        if ($force_regenerate || $revalidate_remote) {
            $existing_path = (string) $order->get_meta(self::META_INVOICE_PATH);
            if ($existing_path !== '' && file_exists($existing_path)) {
                wp_delete_file($existing_path);
            }

            $order->delete_meta_data(self::META_INVOICE_PATH);
            $order->delete_meta_data(self::META_INVOICE_FILE);
            $order->save();
        }

        if ($this->api_url === '' || $this->account_id === '' || $this->relay_api_key === '') {
            $this->set_invoice_status($order, 'failed', 'Invoice relay is not configured.');
            return false;
        }

        $this->set_invoice_status($order, 'pending');

        $payload = [
            'account_id' => $this->account_id,
            'order_id' => (string) $order_id,
            'order_number' => (string) $order->get_order_number(),
            'store_url' => home_url(),
            'force_regenerate' => $force_regenerate,
        ];

        $request_timeout = max(2, $timeout_seconds);
        if ($revalidate_remote) {
            $request_timeout = max($request_timeout, 30);
        }

        $response = wp_remote_post($this->api_url . '/api/invoices/relay/woocommerce-processing', [
            'timeout' => $request_timeout,
            'headers' => [
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'X-Relay-Key' => $this->relay_api_key,
            ],
            'body' => wp_json_encode($payload),
        ]);

        if (is_wp_error($response)) {
            $this->set_invoice_status($order, 'pending', $response->get_error_message());
            $this->schedule_processing_retry($order_id, 0);
            return false;
        }

        $response_code = (int) wp_remote_retrieve_response_code($response);
        if ($response_code === 202) {
            $this->set_invoice_status($order, 'pending');
            $this->schedule_processing_retry($order_id, 0);
            return false;
        }

        $body = OverSeek_HTTP_Utils::decode_json_response($response);
        $relay_error = '';
        if (is_array($body) && isset($body['error'])) {
            $relay_error = is_string($body['error']) ? $body['error'] : '';
        }
        $relay_renderer = is_array($body) && isset($body['renderer_used']) ? sanitize_text_field((string) $body['renderer_used']) : '';
        $relay_reason = is_array($body) && isset($body['diagnostic_reason']) ? sanitize_text_field((string) $body['diagnostic_reason']) : '';
        if ($relay_renderer !== '') {
            $order->update_meta_data(self::META_INVOICE_RENDERER, $relay_renderer);
        }
        if ($relay_reason !== '') {
            $order->update_meta_data(self::META_INVOICE_DIAGNOSTIC_REASON, $relay_reason);
        }
        if ($relay_renderer !== '' || $relay_reason !== '') {
            $order->save();
        }

        if ($response_code === 409) {
            $status = isset($body['status']) ? (string) $body['status'] : '';
            if ($status === 'pending') {
                $this->set_invoice_status($order, 'pending');
                $this->schedule_processing_retry($order_id, 0);
                return false;
            }

            $this->set_invoice_status($order, 'failed', $relay_error !== '' ? $relay_error : 'Invoice generation failed at relay.');
            return false;
        }

        if ($response_code >= 300) {
            if ($response_code >= 500 || $response_code === 429) {
                $this->set_invoice_status($order, 'pending', $relay_error !== '' ? $relay_error : 'Invoice relay is temporarily unavailable.');
                $this->schedule_processing_retry($order_id, 0);
                return false;
            }

            $this->set_invoice_status($order, 'failed', $relay_error !== '' ? $relay_error : 'Invoice relay request was rejected.');
            return false;
        }

        if (!is_array($body)) {
            $this->set_invoice_status($order, 'pending', 'Invalid relay response while generating invoice.');
            $this->schedule_processing_retry($order_id, 0);
            return false;
        }

        $artifact_download_url = isset($body['artifact_download_url']) ? esc_url_raw((string) $body['artifact_download_url']) : '';
        $base64_pdf = isset($body['pdf_base64']) ? (string) $body['pdf_base64'] : '';
        $decoded = false;

        if ($artifact_download_url !== '') {
            $artifact_response = wp_remote_get($artifact_download_url, [
                'timeout' => max(5, $request_timeout),
                'headers' => [
                    'Accept' => 'application/pdf',
                ],
            ]);

            if (!is_wp_error($artifact_response)) {
                $artifact_code = (int) wp_remote_retrieve_response_code($artifact_response);
                if ($artifact_code >= 200 && $artifact_code < 300) {
                    $artifact_body = wp_remote_retrieve_body($artifact_response);
                    if (is_string($artifact_body) && $artifact_body !== '') {
                        $decoded = $artifact_body;
                    }
                }
            }
        }

        if ($decoded === false && $base64_pdf === '') {
            $status = isset($body['status']) ? (string) $body['status'] : '';
            if ($status === 'pending') {
                $this->set_invoice_status($order, 'pending');
                $this->schedule_processing_retry($order_id, 0);
                return false;
            }
            $this->set_invoice_status($order, 'failed', $relay_error !== '' ? $relay_error : 'Invoice PDF payload missing from relay response.');
            return false;
        }

        $private_dir = $this->ensure_private_invoice_dir();
        if ($private_dir === '') {
            $this->set_invoice_status($order, 'failed', 'Could not prepare private invoice directory.');
            return false;
        }

        $safe_order_number = preg_replace('/[^a-zA-Z0-9_-]/', '-', (string) $order->get_order_number());
        $file_name = 'invoice-order-' . ($safe_order_number ?: (string) $order_id) . '-' . gmdate('YmdHis') . '.pdf';
        $file_path = trailingslashit($private_dir) . $file_name;

        if ($decoded === false) {
            $decoded = base64_decode($base64_pdf, true);
            if ($decoded === false) {
                $this->set_invoice_status($order, 'failed', 'Received invalid invoice PDF payload.');
                return false;
            }
        }

        $written = file_put_contents($file_path, $decoded);
        if ($written === false) {
            $this->set_invoice_status($order, 'failed', 'Could not write invoice PDF to disk.');
            return false;
        }

        $invoice_ref = isset($body['invoice_ref']) ? sanitize_text_field((string) $body['invoice_ref']) : '';
        $renderer_used = isset($body['renderer_used']) ? sanitize_text_field((string) $body['renderer_used']) : '';
        $diagnostic_reason = isset($body['diagnostic_reason']) ? sanitize_text_field((string) $body['diagnostic_reason']) : '';

        $order->update_meta_data(self::META_INVOICE_PATH, $file_path);
        $order->update_meta_data(self::META_INVOICE_FILE, $file_name);
        $order->update_meta_data(self::META_INVOICE_RENDERER_VERSION, self::CURRENT_RENDERER_VERSION);
        if ($invoice_ref !== '') {
            $order->update_meta_data(self::META_INVOICE_REF, $invoice_ref);
        }
        if ($renderer_used !== '') {
            $order->update_meta_data(self::META_INVOICE_RENDERER, $renderer_used);
        } else {
            $order->delete_meta_data(self::META_INVOICE_RENDERER);
        }
        if ($diagnostic_reason !== '') {
            $order->update_meta_data(self::META_INVOICE_DIAGNOSTIC_REASON, $diagnostic_reason);
        } else {
            $order->delete_meta_data(self::META_INVOICE_DIAGNOSTIC_REASON);
        }
        $order->update_meta_data(self::META_INVOICE_STATUS, 'ready');
        $order->delete_meta_data(self::META_INVOICE_ERROR);
        $order->update_meta_data(self::META_INVOICE_GENERATED_AT, gmdate('c'));
        $order->save();

        return true;
    }

    public function cleanup_private_invoices(): void
    {
        $private_dir = $this->ensure_private_invoice_dir();
        if ($private_dir === '' || !is_dir($private_dir)) {
            return;
        }

        $retention_days = max(1, absint((int) get_option('overseek_invoice_retention_days', 30)));
        $cutoff = time() - ($retention_days * DAY_IN_SECONDS);
        $files = glob(trailingslashit($private_dir) . '*.pdf');
        if (!is_array($files)) {
            return;
        }

        foreach ($files as $file_path) {
            if (!is_string($file_path) || !file_exists($file_path)) {
                continue;
            }
            $mtime = filemtime($file_path);
            if ($mtime !== false && $mtime < $cutoff) {
                wp_delete_file($file_path);
            }
        }
    }

    private function ensure_private_invoice_dir(): string
    {
        $uploads = wp_upload_dir();
        $basedir = isset($uploads['basedir']) ? (string) $uploads['basedir'] : '';
        if ($basedir === '') {
            return '';
        }

        $dir = trailingslashit($basedir) . 'overseek-private/invoices';
        if (!wp_mkdir_p($dir)) {
            return '';
        }

        $htaccess = trailingslashit($dir) . '.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        }

        $index = trailingslashit($dir) . 'index.php';
        if (!file_exists($index)) {
            file_put_contents($index, "<?php\n");
        }

        return $dir;
    }

    public function invoice_is_available(int $order_id): bool
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return false;
        }

        $path = (string) $order->get_meta(self::META_INVOICE_PATH);
        $renderer_version = (string) $order->get_meta(self::META_INVOICE_RENDERER_VERSION);
        return $renderer_version === self::CURRENT_RENDERER_VERSION
            && $path !== ''
            && file_exists($path)
            && is_readable($path);
    }

    public function user_can_access_invoice(WC_Order $order, ?int $user_id = null): bool
    {
        $viewer_id = $user_id ?? get_current_user_id();

        if ($viewer_id > 0) {
            $user = get_user_by('id', $viewer_id);
            if ($user instanceof WP_User) {
                if (user_can($user, 'manage_woocommerce') || user_can($user, 'manage_options')) {
                    return true;
                }
            }
        }

        $customer_id = (int) $order->get_user_id();
        if ($customer_id > 0 && $viewer_id > 0 && $viewer_id === $customer_id) {
            return true;
        }

        return false;
    }

    public function get_invoice_for_order(int $order_id, ?int $user_id = null): ?array
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return null;
        }

        if (!$this->user_can_access_invoice($order, $user_id)) {
            return null;
        }

        $status = (string) $order->get_meta(self::META_INVOICE_STATUS);
        if ($status === '') {
            $status = $this->invoice_is_available($order_id) ? 'ready' : 'pending';
        }

        $invoice_ref = (string) $order->get_meta(self::META_INVOICE_REF);
        $generated_at = (string) $order->get_meta(self::META_INVOICE_GENERATED_AT);
        $error_message = (string) $order->get_meta(self::META_INVOICE_ERROR);
        $renderer_used = (string) $order->get_meta(self::META_INVOICE_RENDERER);
        $diagnostic_reason = (string) $order->get_meta(self::META_INVOICE_DIAGNOSTIC_REASON);
        $download_url = add_query_arg(
            [
                'order_id' => $order_id,
                'key' => $order->get_order_key(),
            ],
            rest_url('overseek/v1/invoices/download')
        );

        $payload = [
            'order_id' => $order_id,
            'invoice_id' => $invoice_ref !== '' ? $invoice_ref : 'order-' . $order_id,
            'invoice_url' => $this->invoice_is_available($order_id) ? $download_url : null,
            'pdf_url' => $this->invoice_is_available($order_id) ? $download_url : null,
            'status' => in_array($status, ['pending', 'ready', 'failed'], true) ? $status : 'pending',
            'issued_at' => $generated_at !== '' ? $generated_at : null,
            'error_message' => $error_message !== '' ? $error_message : null,
            'renderer_used' => $renderer_used !== '' ? $renderer_used : null,
            'diagnostic_reason' => $diagnostic_reason !== '' ? $diagnostic_reason : null,
        ];

        return apply_filters('overseek_invoice_payload', $payload, $order);
    }

    public function get_invoice_file_path(int $order_id): string
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return '';
        }

        return (string) $order->get_meta(self::META_INVOICE_PATH);
    }

    public function try_generate_invoice_now(int $order_id, int $timeout_seconds = 6, bool $force_regenerate = false, bool $revalidate_remote = false): bool
    {
        if ($order_id <= 0) {
            return false;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return false;
        }

        if (!$force_regenerate && !$revalidate_remote && $this->invoice_is_available($order_id)) {
            return true;
        }

        return $this->generate_invoice_for_order($order, $timeout_seconds, $force_regenerate, $revalidate_remote);
    }

}

if (!function_exists('overseek_get_invoice_for_order')) {
    function overseek_get_invoice_for_order(int $order_id, ?int $user_id = null): ?array
    {
        $service = OverSeek_Order_Invoices::get_instance();
        if (!$service) {
            return null;
        }

        return $service->get_invoice_for_order($order_id, $user_id);
    }
}

if (!function_exists('overseek_invoice_is_available')) {
    function overseek_invoice_is_available(int $order_id): bool
    {
        $service = OverSeek_Order_Invoices::get_instance();
        if (!$service) {
            return false;
        }

        return $service->invoice_is_available($order_id);
    }
}

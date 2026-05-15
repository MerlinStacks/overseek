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
        add_action(self::PROCESSING_HOOK, [$this, 'process_processing_order'], 10, 1);
        add_filter('woocommerce_email_attachments', [$this, 'attach_invoice_to_processing_email'], 10, 3);
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
                $order->save();
            }
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

        $this->generate_invoice_for_order($order, 8);
    }

    private function schedule_processing_retry(int $order_id, int $delay_seconds = 60): void
    {
        $delay = max(15, $delay_seconds);
        if (!wp_next_scheduled(self::PROCESSING_HOOK, [$order_id])) {
            wp_schedule_single_event(time() + $delay, self::PROCESSING_HOOK, [$order_id]);
        }
    }

    private function generate_invoice_for_order(WC_Order $order, int $timeout_seconds = 8): bool
    {
        $order_id = (int) $order->get_id();

        if ((string) $order->get_meta(self::META_INVOICE_PATH) !== '') {
            if ((string) $order->get_meta(self::META_INVOICE_STATUS) === '') {
                $order->update_meta_data(self::META_INVOICE_STATUS, 'ready');
                $order->save();
            }
            return true;
        }

        if ($this->api_url === '' || $this->account_id === '' || $this->relay_api_key === '') {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
        $order->save();

        $payload = [
            'account_id' => $this->account_id,
            'order_id' => (string) $order_id,
            'order_number' => (string) $order->get_order_number(),
            'store_url' => home_url(),
        ];

        $response = wp_remote_post($this->api_url . '/api/invoices/relay/woocommerce-processing', [
            'timeout' => max(2, $timeout_seconds),
            'headers' => [
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'X-Relay-Key' => $this->relay_api_key,
            ],
            'body' => wp_json_encode($payload),
        ]);

        if (is_wp_error($response)) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $response_code = (int) wp_remote_retrieve_response_code($response);
        if ($response_code === 202) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
            $order->save();
            $this->schedule_processing_retry($order_id, 45);
            return false;
        }

        if ($response_code === 409) {
            $body = OverSeek_HTTP_Utils::decode_json_response($response);
            $status = isset($body['status']) ? (string) $body['status'] : '';
            if ($status === 'pending') {
                $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
                $order->save();
                $this->schedule_processing_retry($order_id, 45);
                return false;
            }

            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        if ($response_code >= 300) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $body = OverSeek_HTTP_Utils::decode_json_response($response);
        if (!is_array($body)) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $base64_pdf = isset($body['pdf_base64']) ? (string) $body['pdf_base64'] : '';
        if ($base64_pdf === '') {
            $status = isset($body['status']) ? (string) $body['status'] : '';
            if ($status === 'pending') {
                $order->update_meta_data(self::META_INVOICE_STATUS, 'pending');
                $order->save();
                $this->schedule_processing_retry($order_id, 45);
                return false;
            }
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $private_dir = $this->ensure_private_invoice_dir();
        if ($private_dir === '') {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $safe_order_number = preg_replace('/[^a-zA-Z0-9_-]/', '-', (string) $order->get_order_number());
        $file_name = 'invoice-order-' . ($safe_order_number ?: (string) $order_id) . '-' . gmdate('YmdHis') . '.pdf';
        $file_path = trailingslashit($private_dir) . $file_name;

        $decoded = base64_decode($base64_pdf, true);
        if ($decoded === false) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $written = file_put_contents($file_path, $decoded);
        if ($written === false) {
            $order->update_meta_data(self::META_INVOICE_STATUS, 'failed');
            $order->save();
            return false;
        }

        $invoice_ref = isset($body['invoice_ref']) ? sanitize_text_field((string) $body['invoice_ref']) : '';

        $order->update_meta_data(self::META_INVOICE_PATH, $file_path);
        $order->update_meta_data(self::META_INVOICE_FILE, $file_name);
        if ($invoice_ref !== '') {
            $order->update_meta_data(self::META_INVOICE_REF, $invoice_ref);
        }
        $order->update_meta_data(self::META_INVOICE_STATUS, 'ready');
        $order->update_meta_data(self::META_INVOICE_GENERATED_AT, gmdate('c'));
        $order->save();

        return true;
    }

    public function attach_invoice_to_processing_email(array $attachments, string $email_id, $order): array
    {
        if (!get_option('overseek_enable_processing_invoice_sync', '1')) {
            return $attachments;
        }

        if ($email_id !== 'customer_processing_order') {
            return $attachments;
        }

        if (!$order instanceof WC_Order) {
            return $attachments;
        }

        if ((string) $order->get_meta(self::META_INVOICE_PATH) === '') {
            if ((string) $order->get_meta(self::META_INVOICE_STATUS) === 'pending') {
                $this->schedule_processing_retry((int) $order->get_id(), 30);
                return $attachments;
            }
            $this->generate_invoice_for_order($order, 6);
        }

        $path = (string) $order->get_meta(self::META_INVOICE_PATH);
        if ($path !== '' && file_exists($path) && is_readable($path)) {
            $attachments[] = $path;
        }

        return $attachments;
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
            file_put_contents($htaccess, "Deny from all\n");
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
        return $path !== '' && file_exists($path) && is_readable($path);
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

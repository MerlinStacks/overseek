<?php
/**
 * Event transport and retry handling for OverSeek server-side tracking.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Tracking_Transport
{
    public const RETRY_HOOK = 'overseek_retry_tracking_events';
    private const RETRY_BATCH_SIZE = 5;
    private const FAILED_EVENTS_TRANSIENT = '_overseek_failed_events';
    private const BLOCKING_EVENT_TYPES = array('purchase');

    /**
     * @return array<int, array<string, mixed>>
     */
    private static function get_failed_events_for_retry(): array
    {
        $failed_events = get_transient(self::FAILED_EVENTS_TRANSIENT);

        if (!is_array($failed_events) || empty($failed_events)) {
            return array();
        }

        $now = time();
        $ready = array();
        $deferred = array();

        foreach ($failed_events as $event) {
            if (count($ready) < self::RETRY_BATCH_SIZE && (empty($event['_retry_after']) || $event['_retry_after'] <= $now)) {
                $ready[] = $event;
            } else {
                $deferred[] = $event;
            }
        }

        if (!empty($deferred)) {
            set_transient(self::FAILED_EVENTS_TRANSIENT, $deferred, HOUR_IN_SECONDS);
        } else {
            delete_transient(self::FAILED_EVENTS_TRANSIENT);
        }

        return $ready;
    }

    /**
     * Schedule the earliest queued retry without performing HTTP in the visitor request.
     * WP-Cron must be serviced by WordPress or a system cron when DISABLE_WP_CRON is set.
     */
    public static function schedule_failed_events_retry(): void
    {
        $events = get_transient(self::FAILED_EVENTS_TRANSIENT);
        if (!is_array($events) || empty($events)) {
            return;
        }

        $next_retry = min(array_map(static function (array $event): int {
            return (int) ($event['_retry_after'] ?? 0);
        }, $events));

        // Space batches apart even when the remaining backlog is already due.
        $timestamp = max(time() + 30, $next_retry);
        $scheduled = wp_next_scheduled(self::RETRY_HOOK);
        if ($scheduled && $scheduled <= $timestamp) {
            return;
        }
        if ($scheduled && !wp_unschedule_event($scheduled, self::RETRY_HOOK)) {
            return;
        }
        wp_schedule_single_event($timestamp, self::RETRY_HOOK);
    }

    /**
     * Retry at most five events (ten seconds of configured HTTP timeout budget).
     * Reuse the captured payload so attribution and deduplication IDs stay intact.
     */
    public static function retry_failed_events(): void
    {
        $api_url = untrailingslashit((string) get_option('overseek_api_url', ''));
        $account_id = (string) get_option('overseek_account_id', '');
        if (!get_option('overseek_enable_tracking') || $api_url === '' || $account_id === '') {
            return;
        }

        $events = self::get_failed_events_for_retry();
        try {
            foreach ($events as $event) {
                // Never replay an old account's payload after a store is relinked.
                if ((string) ($event['accountId'] ?? '') !== $account_id) {
                    continue;
                }

                try {
                    $event_id = (string) ($event['payload']['eventId'] ?? '');
                    $order = null;
                    if (($event['type'] ?? '') === 'purchase' && !empty($event['payload']['orderId'])) {
                        $order = wc_get_order((int) $event['payload']['orderId']);
                        if ($order && $order->get_meta('_overseek_tracked')) {
                            continue;
                        }
                    }

                    $results = self::flush_events($api_url, array($event));
                    if ($order && $event_id !== '' && !empty($results[$event_id])
                        && (string) $order->get_meta('_overseek_event_id') === $event_id) {
                        $order->update_meta_data('_overseek_tracked', true);
                        $order->save_meta_data();
                    }
                } catch (Throwable $error) {
                    // A transport/order extension must not discard the rest of the claimed batch.
                    // Replays retain the same event ID, including if only saving the marker failed.
                    self::store_failed_event($event);
                    if (defined('WP_DEBUG') && WP_DEBUG) {
                        error_log('OverSeek tracking retry failed: ' . $error->getMessage());
                    }
                }
            }
        } finally {
            self::schedule_failed_events_retry();
        }
    }

    /**
     * @param array<int, array<string, mixed>> $events
     */
    public static function flush_events(string $api_url, array $events): array
    {
        if (empty($events)) {
            return array();
        }

        $results = array();

		$is_ajax = wp_doing_ajax();
		$is_rest = defined('REST_REQUEST') && REST_REQUEST;

        if (defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
            error_log('OverSeek: Flushing ' . count($events) . ' events (AJAX: ' . ($is_ajax ? 'yes' : 'no') . ', REST: ' . ($is_rest ? 'yes' : 'no') . ')');
        }

        foreach ($events as $data) {
            $visitor_ip = $data['visitorIp'] ?? '';
            $retry_count = $data['_retry_count'] ?? 0;
            $event_type = $data['type'] ?? 'unknown';
            $event_id = isset($data['payload']['eventId']) ? (string) $data['payload']['eventId'] : '';
            $blocking = self::should_block_for_event((string) $event_type);
            $timeout = $blocking ? 2 : 0.5;
            unset($data['visitorIp'], $data['_retry_count'], $data['_retry_after']);

            $visitor_ua = $data['userAgent'] ?? '';
            $headers = array(
                'Content-Type' => 'application/json',
                'X-Forwarded-For' => $visitor_ip,
                'X-Real-IP' => $visitor_ip,
                'User-Agent' => !empty($visitor_ua) ? $visitor_ua : 'OverSeek-WC-Plugin/1.0',
                'Expect' => '',
            );

            $webhook_token = (string) get_option('overseek_webhook_auth_token', '');
            if ('' !== $webhook_token) {
                $headers['Authorization'] = 'Bearer ' . $webhook_token;
            }

            $response = wp_remote_post($api_url . '/api/t/e', array(
                'timeout' => $timeout,
                'blocking' => $blocking,
                'httpversion' => '1.1',
                'headers' => $headers,
                'body' => wp_json_encode($data),
            ));

            if ($blocking && defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
                if (is_wp_error($response)) {
                    error_log('OverSeek FAILED: ' . $event_type . ' - ' . $response->get_error_message());
                } else {
                    $code = wp_remote_retrieve_response_code($response);
                    $body = wp_remote_retrieve_body($response);
                    error_log('OverSeek OK: ' . $event_type . ' - HTTP ' . $code . ' - ' . substr((string) $body, 0, 100));
                }
            }

            if ($blocking) {
                $successful = !is_wp_error($response) && self::is_success_response($response);
                if ($event_id !== '') {
                    $results[$event_id] = $successful;
                }
            }

            if ($blocking && (is_wp_error($response) || !self::is_success_response($response))) {
                $data['visitorIp'] = $visitor_ip;
                $data['_retry_count'] = $retry_count;
                self::store_failed_event($data);

                if (defined('WP_DEBUG') && WP_DEBUG && is_wp_error($response)) {
                    error_log('OverSeek Tracking Error: ' . $response->get_error_message() . ' | Event: ' . $event_type . ' | Retry: ' . ($retry_count + 1));
                }
            }
        }

        return $results;
    }

    private static function should_block_for_event(string $event_type): bool
    {
        return in_array($event_type, self::BLOCKING_EVENT_TYPES, true);
    }

    /**
     * @param array<string, mixed>|WP_Error $response
     */
    private static function is_retryable_response($response): bool
    {
        if (is_wp_error($response)) {
            return true;
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        return 429 === $status || $status >= 500;
    }

    /**
     * @param array<string, mixed>|WP_Error $response
     */
    private static function is_success_response($response): bool
    {
        if (is_wp_error($response)) {
            return false;
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        return $status >= 200 && $status < 300;
    }

    /**
     * @param array<string, mixed> $data
     */
    private static function store_failed_event(array $data): void
    {
        $failed_events = get_transient(self::FAILED_EVENTS_TRANSIENT);

        if (!is_array($failed_events)) {
            $failed_events = array();
        }

        if (!isset($data['_retry_count'])) {
            $data['_retry_count'] = 0;
        }

        $event_id = isset($data['payload']['eventId']) ? (string) $data['payload']['eventId'] : '';
        if ($event_id !== '') {
            foreach ($failed_events as $failed_event) {
                if (($failed_event['payload']['eventId'] ?? '') === $event_id) {
                    return;
                }
            }
        }

        if ($data['_retry_count'] < 3) {
            $data['_retry_count']++;
            $data['_retry_after'] = time() + (30 * pow(4, $data['_retry_count'] - 1));
            $failed_events[] = $data;

            if (count($failed_events) > 50) {
                $failed_events = array_slice($failed_events, -50);
            }

            set_transient(self::FAILED_EVENTS_TRANSIENT, $failed_events, HOUR_IN_SECONDS);
            self::schedule_failed_events_retry();
        }
    }
}

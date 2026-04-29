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
    private const FAILED_EVENTS_TRANSIENT = '_overseek_failed_events';

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function get_failed_events_for_retry(): array
    {
        $failed_events = get_transient(self::FAILED_EVENTS_TRANSIENT);

        if (!is_array($failed_events) || empty($failed_events)) {
            return array();
        }

        $now = time();
        $ready = array();
        $deferred = array();

        foreach ($failed_events as $event) {
            if (empty($event['_retry_after']) || $event['_retry_after'] <= $now) {
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
     * @param array<int, array<string, mixed>> $events
     */
    public static function flush_events(string $api_url, array $events): void
    {
        if (empty($events)) {
            return;
        }

        $is_ajax = wp_doing_ajax();
        $is_rest = defined('REST_REQUEST') && REST_REQUEST;
        $blocking = $is_ajax || $is_rest;
        $timeout = $blocking ? 2 : 0.5;

        if (defined('WP_DEBUG') && WP_DEBUG && defined('OVERSEEK_DEBUG') && OVERSEEK_DEBUG) {
            error_log('OverSeek: Flushing ' . count($events) . ' events (AJAX: ' . ($is_ajax ? 'yes' : 'no') . ', REST: ' . ($is_rest ? 'yes' : 'no') . ')');
        }

        foreach ($events as $data) {
            $visitor_ip = $data['visitorIp'] ?? '';
            $retry_count = $data['_retry_count'] ?? 0;
            $event_type = $data['type'] ?? 'unknown';
            unset($data['visitorIp'], $data['_retry_count'], $data['_retry_after']);

            $visitor_ua = $data['userAgent'] ?? '';
            $response = wp_remote_post($api_url . '/api/t/e', array(
                'timeout' => $timeout,
                'blocking' => $blocking,
                'httpversion' => '1.1',
                'headers' => array(
                    'Content-Type' => 'application/json',
                    'X-Forwarded-For' => $visitor_ip,
                    'X-Real-IP' => $visitor_ip,
                    'User-Agent' => !empty($visitor_ua) ? $visitor_ua : 'OverSeek-WC-Plugin/1.0',
                    'Expect' => '',
                ),
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

            if ($blocking && is_wp_error($response)) {
                $data['visitorIp'] = $visitor_ip;
                $data['_retry_count'] = $retry_count;
                self::store_failed_event($data);

                if (defined('WP_DEBUG') && WP_DEBUG) {
                    error_log('OverSeek Tracking Error: ' . $response->get_error_message() . ' | Event: ' . $event_type . ' | Retry: ' . ($retry_count + 1));
                }
            }
        }
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

        if ($data['_retry_count'] < 3) {
            $data['_retry_count']++;
            $data['_retry_after'] = time() + (30 * pow(4, $data['_retry_count'] - 1));
            $failed_events[] = $data;

            if (count($failed_events) > 50) {
                $failed_events = array_slice($failed_events, -50);
            }

            set_transient(self::FAILED_EVENTS_TRANSIENT, $failed_events, HOUR_IN_SECONDS);
        }
    }
}

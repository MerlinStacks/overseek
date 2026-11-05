<?php
/** Run only in disposable WordPress CI: real Action Scheduler persistence and execution. */
declare(strict_types=1);

if (getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS') !== '1' || !defined('ABSPATH')) {
    throw new RuntimeException('Requires disposable WordPress CI.');
}

require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-tracking-transport.php';
require_once OVERSEEK_WC_PLUGIN_DIR . 'includes/class-overseek-server-tracking.php';

$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};
$options = [
    'overseek_api_url' => 'https://overseek-ci.invalid',
    'overseek_account_id' => 'background-test',
    'overseek_enable_tracking' => '1',
    'overseek_webhook_auth_token' => 'background-test-token',
];
$previous = [];
foreach ($options as $key => $value) {
    $previous[$key] = get_option($key, null);
    update_option($key, $value);
}
$previous_backlog = get_transient('_overseek_failed_events');
$backlog = array_map(static fn (int $id): array => [
    'accountId' => 'background-test', 'type' => 'purchase',
    'payload' => ['orderId' => $id, 'eventId' => 'purchase-' . $id],
], range(1, 50));
$requests = [];
$response_code = 503;
$intercept = static function ($preempt, $args, $url) use (&$requests, &$response_code) {
    if ($url !== 'https://overseek-ci.invalid/api/t/e') return $preempt;
    $requests[] = $args;
    return ['headers' => [], 'body' => '{}', 'response' => ['code' => $response_code, 'message' => 'CI'], 'cookies' => []];
};
$jobs = static fn (): array => as_get_scheduled_actions([
    'hook' => OverSeek_Tracking_Transport::STORE_CHANGE_HOOK,
    'group' => 'overseek-store-sync', 'status' => 'pending', 'per_page' => 100,
], 'ids');

try {
    $check(function_exists('as_schedule_single_action'), 'WooCommerce Action Scheduler missing');
    set_transient('_overseek_failed_events', $backlog, HOUR_IN_SECONDS);
    add_filter('pre_http_request', $intercept, 10, 3);
    $tracking = new OverSeek_Server_Tracking();
    for ($id = 1; $id <= 55; $id++) $tracking->track_order_change($id);
    $tracking->flush_event_queue();
    $check($requests === [], 'Bulk edits performed inline operational HTTP');
    $ids = $jobs();
    $check(count($ids) === 55, 'Bulk edits did not persist independent actions');
    $check(get_transient('_overseek_failed_events') === $backlog, 'Scheduling displaced purchase retries');

    $original = ActionScheduler::store()->fetch_action((int) $ids[0])->get_args()[0];
    ActionScheduler::runner()->process_action((int) $ids[0], 'overseek-ci');
    $check(ActionScheduler::store()->get_status((int) $ids[0]) === 'complete', 'Worker failed to execute');
    $check(count($requests) === 1 && $requests[0]['blocking'] === true, 'Worker did not acknowledge HTTP');
    $check(get_transient('_overseek_failed_events') === $backlog, 'Failed delivery displaced purchase retries');
    $retry_id = null;
    foreach ($jobs() as $id) {
        $args = ActionScheduler::store()->fetch_action((int) $id)->get_args()[0];
        if (($args['_retry_count'] ?? 0) === 1 && $args['payload']['eventId'] === $original['payload']['eventId']) {
            $retry_id = (int) $id;
        }
    }
    $check($retry_id !== null, 'Failed delivery did not persist a retry with stable identity');
    $response_code = 200;
    ActionScheduler::runner()->process_action($retry_id, 'overseek-ci');
    $check(ActionScheduler::store()->get_status($retry_id) === 'complete', 'Retry worker failed');
    $check(count($requests) === 2, 'Retry did not deliver exactly once');
    $check(json_decode($requests[1]['body'], true)['payload']['eventId'] === $original['payload']['eventId'], 'Retry changed occurrence identity');
    echo "Native operational background delivery and purchase isolation passed.\n";
} finally {
    remove_filter('pre_http_request', $intercept, 10);
    if (function_exists('as_unschedule_all_actions')) {
        as_unschedule_all_actions(OverSeek_Tracking_Transport::STORE_CHANGE_HOOK, [], 'overseek-store-sync');
    }
    wp_unschedule_hook(OverSeek_Tracking_Transport::RETRY_HOOK);
    if ($previous_backlog === false) delete_transient('_overseek_failed_events');
    else set_transient('_overseek_failed_events', $previous_backlog, HOUR_IN_SECONDS);
    foreach ($previous as $key => $value) {
        if ($value === null) delete_option($key);
        else update_option($key, $value);
    }
}

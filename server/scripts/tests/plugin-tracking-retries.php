<?php
/**
 * Dependency-free regression tests for the plugin's tracking retry boundary.
 * Run from the repository root: php server/scripts/tests/plugin-tracking-retries.php
 * WordPress HTTP, cron, transient and WooCommerce order APIs are test doubles;
 * no network, database, or installed WordPress instance is used.
 */
declare(strict_types=1);

define('ABSPATH', __DIR__);
define('HOUR_IN_SECONDS', 3600);

class WP_Error {}
class Retry_Test_Order
{
    public array $meta;
    public int $saves = 0;
    public bool $throw_on_save = false;

    public function __construct(string $event_id)
    {
        $this->meta = ['_overseek_event_id' => $event_id];
    }
    public function get_meta(string $key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data(string $key, $value): void { $this->meta[$key] = $value; }
    public function save_meta_data(): void
    {
        if ($this->throw_on_save) {
            unset($this->meta['_overseek_tracked']);
            throw new RuntimeException('Order metadata write failed');
        }
        $this->saves++;
    }
}

function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient($key, $value, $ttl): bool { $GLOBALS['transients'][$key] = $value; return true; }
function delete_transient($key): bool { unset($GLOBALS['transients'][$key]); return true; }
function wp_next_scheduled($hook) { return $GLOBALS['cron'][$hook] ?? false; }
function wp_schedule_single_event($timestamp, $hook): bool
{
    $GLOBALS['cron'][$hook] = $timestamp;
    return true;
}
function wp_unschedule_event($timestamp, $hook): bool { unset($GLOBALS['cron'][$hook]); return true; }
function add_action($hook, $callback, ...$args): void { $GLOBALS['actions'][$hook][] = $callback; }
function add_filter(...$args): void {}
function untrailingslashit($value): string { return rtrim($value, '/'); }
function wp_doing_ajax(): bool { return false; }
function wp_json_encode($value): string { return json_encode($value, JSON_THROW_ON_ERROR); }
function is_wp_error($value): bool { return $value instanceof WP_Error; }
function wp_remote_retrieve_response_code($value): int { return $value['response']['code'] ?? 0; }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? false; }
function wp_remote_post($url, $args)
{
    $GLOBALS['requests'][] = ['url' => $url, 'args' => $args];
    return $GLOBALS['response'];
}

require_once __DIR__ . '/../../../overseek-wc-plugin/includes/class-overseek-tracking-transport.php';
require_once __DIR__ . '/../../../overseek-wc-plugin/includes/class-overseek-server-tracking.php';

function reset_state(): void
{
    $GLOBALS['options'] = [
        'overseek_api_url' => 'https://overseek.example/',
        'overseek_account_id' => 'store-a',
        'overseek_enable_tracking' => '1',
        'overseek_webhook_auth_token' => 'test-token',
    ];
    foreach (['transients', 'cron', 'orders', 'requests', 'actions'] as $key) {
        $GLOBALS[$key] = [];
    }
    $GLOBALS['response'] = ['response' => ['code' => 200]];
}
function check(bool $condition, string $message): void
{
    if (!$condition) { throw new RuntimeException($message); }
}
function event(int $id, int $delay = -1): array
{
    return [
        'accountId' => 'store-a', 'type' => 'purchase',
        'visitorId' => 'original-visitor', 'visitorIp' => '192.0.2.1',
        'occurredAt' => '2026-09-14T12:00:00Z',
        'payload' => ['eventId' => 'purchase-' . $id, 'orderId' => $id],
        '_retry_count' => 1, '_retry_after' => time() + $delay,
    ];
}
function seed(array $events): void { set_transient('_overseek_failed_events', $events, HOUR_IN_SECONDS); }
function pending(): array { return get_transient('_overseek_failed_events') ?: []; }
function run_worker(): void
{
    // WordPress removes a single event before invoking its callback.
    unset($GLOBALS['cron'][OverSeek_Tracking_Transport::RETRY_HOOK]);
    OverSeek_Tracking_Transport::retry_failed_events();
}

$tests = [];
$tests['checkout flush never drains a 50-purchase backlog'] = static function (): void {
    $backlog = array_map('event', range(1, 50));
    seed($backlog);
    $tracking = new OverSeek_Server_Tracking();
    $queue = new ReflectionProperty($tracking, 'event_queue');
    $queue->setValue($tracking, [event(100), event(100)]);
    $GLOBALS['response'] = new WP_Error();
    $result = $tracking->flush_event_queue();
    check(count($GLOBALS['requests']) === 1, 'Only the current purchase should be sent, even during an outage');
    $request = $GLOBALS['requests'][0]['args'];
    check(json_decode($request['body'], true)['payload']['eventId'] === 'purchase-100', 'Backlog purchase sent from checkout');
    check($request['blocking'] === true && $request['timeout'] === 2, 'Current purchase acknowledgement changed');
    check($result === ['purchase-100' => false], 'Failed purchase must not be acknowledged');
    check(count(pending()) === 50, 'Existing queue cap must remain in effect');
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) !== false, 'Retry must be scheduled');
    $tracking->flush_event_queue();
    check(count($GLOBALS['requests']) === 1, 'Shutdown flush must not retry failures from the same request');
};
$tests['successful current purchase acknowledges without touching backlog'] = static function (): void {
    seed([event(1)]);
    $tracking = new OverSeek_Server_Tracking();
    (new ReflectionProperty($tracking, 'event_queue'))->setValue($tracking, [event(100)]);
    check($tracking->flush_event_queue() === ['purchase-100' => true], 'Successful purchase acknowledgement lost');
    check(count(pending()) === 1 && pending()[0]['payload']['orderId'] === 1, 'Backlog changed during successful checkout');
};
$tests['worker registers and recovers pre-upgrade queues without HTTP'] = static function (): void {
    seed([event(1)]);
    new OverSeek_Server_Tracking();
    check(is_callable($GLOBALS['actions'][OverSeek_Tracking_Transport::RETRY_HOOK][0]), 'Worker callback missing');
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) !== false, 'Legacy queue not scheduled');
    check($GLOBALS['requests'] === [], 'Initialization must not send retries');
};
$tests['worker sends at most five and eventually drains the backlog'] = static function (): void {
    seed(array_map('event', range(1, 50)));
    run_worker();
    check(count($GLOBALS['requests']) === 5 && count(pending()) === 45, 'Worker exceeded batch limit or lost pending events');
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) >= time() + 29, 'Continuation missing');
    for ($i = 0; $i < 9; $i++) { run_worker(); }
    check(count($GLOBALS['requests']) === 50 && pending() === [], 'Backlog did not drain');
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) === false, 'Empty queue should not keep scheduling');
};
$tests['retry preserves attribution and marks the matching order tracked'] = static function (): void {
    $original = event(1);
    seed([$original]);
    $GLOBALS['orders'][1] = new Retry_Test_Order('purchase-1');
    run_worker();
    $request = $GLOBALS['requests'][0]['args'];
    $sent = json_decode($request['body'], true);
    unset($original['visitorIp'], $original['_retry_after'], $original['_retry_count']);
    check($sent === $original, 'Retry must preserve original event ID, timestamp and visitor attribution');
    check($request['headers']['X-Real-IP'] === '192.0.2.1', 'Visitor IP lost');
    check($request['headers']['Authorization'] === 'Bearer test-token', 'Authentication lost');
    check($GLOBALS['orders'][1]->get_meta('_overseek_tracked') === true, 'Successful retry not marked tracked');
    check($GLOBALS['orders'][1]->saves === 1, 'Order marker not persisted');
};
$tests['tracked orders and foreign accounts are not replayed'] = static function (): void {
    $foreign = event(2);
    $foreign['accountId'] = 'store-b';
    seed([event(1), $foreign]);
    $GLOBALS['orders'][1] = new Retry_Test_Order('purchase-1');
    $GLOBALS['orders'][1]->meta['_overseek_tracked'] = true;
    run_worker();
    check($GLOBALS['requests'] === [] && pending() === [], 'Already tracked or foreign event replayed');
};
$tests['different order event ID is never marked tracked'] = static function (): void {
    seed([event(1)]);
    $GLOBALS['orders'][1] = new Retry_Test_Order('replacement-id');
    run_worker();
    check(!$GLOBALS['orders'][1]->get_meta('_overseek_tracked'), 'Unrelated order event was marked tracked');
};
$tests['future events are retained and scheduled, not sent early'] = static function (): void {
    $future = event(1, 400);
    seed([$future]);
    run_worker();
    check($GLOBALS['requests'] === [] && pending() === [$future], 'Future event sent or lost');
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) === $future['_retry_after'], 'Backoff not respected');
};
$tests['new failures bring a later cron deadline forward'] = static function (): void {
    seed([event(1, 480)]);
    OverSeek_Tracking_Transport::schedule_failed_events_retry();
    $GLOBALS['response'] = new WP_Error();
    $new = event(2);
    unset($new['_retry_count'], $new['_retry_after']);
    OverSeek_Tracking_Transport::flush_events('https://overseek.example', [$new]);
    check(wp_next_scheduled(OverSeek_Tracking_Transport::RETRY_HOOK) <= time() + 31, 'New failure stuck behind old backoff');
};
$tests['retry failure retains backoff and stops after existing retry limit'] = static function (): void {
    seed([event(1)]);
    $GLOBALS['response'] = ['response' => ['code' => 503]];
    run_worker();
    check(count(pending()) === 1 && pending()[0]['_retry_count'] === 2, 'Failure not requeued');
    check(pending()[0]['_retry_after'] >= time() + 119, 'Existing backoff changed');
    $last = event(1);
    $last['_retry_count'] = 3;
    seed([$last]);
    run_worker();
    check(pending() === [], 'Retry limit not honored');
};
$tests['one order persistence exception does not discard the batch'] = static function (): void {
    seed([event(1), event(2)]);
    $GLOBALS['orders'][1] = new Retry_Test_Order('purchase-1');
    $GLOBALS['orders'][1]->throw_on_save = true;
    run_worker();
    check(count($GLOBALS['requests']) === 2, 'Later events discarded after metadata failure');
    check(count(pending()) === 1 && pending()[0]['payload']['eventId'] === 'purchase-1', 'Failed event not retained with stable ID');
};
$tests['disabled or unconfigured tracking never sends the backlog'] = static function (): void {
    foreach (['overseek_enable_tracking', 'overseek_api_url', 'overseek_account_id'] as $key) {
        reset_state();
        seed([event(1)]);
        $GLOBALS['options'][$key] = '';
        run_worker();
        check($GLOBALS['requests'] === [] && count(pending()) === 1, 'Disabled/unconfigured worker modified backlog');
    }
};

foreach ($tests as $name => $test) {
    reset_state();
    $test();
    fwrite(STDOUT, "PASS: {$name}\n");
}
fwrite(STDOUT, count($tests) . " tracking retry regression tests passed.\n");

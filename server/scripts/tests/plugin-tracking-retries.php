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
    public function delete_meta_data(string $key): void { unset($this->meta[$key]); }
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
function wp_schedule_single_event($timestamp, $hook, $args = []): bool
{
    if ($hook === OverSeek_Tracking_Transport::STORE_CHANGE_HOOK) {
        $GLOBALS['store_jobs'][] = ['timestamp' => $timestamp, 'args' => $args, 'scheduler' => 'cron'];
        return true;
    }
    $GLOBALS['cron'][$hook] = $timestamp;
    return true;
}
function as_schedule_single_action($timestamp, $hook, $args, $group)
{
    if ($GLOBALS['action_scheduler'] === 'throw') throw new RuntimeException('Scheduler unavailable');
    if (!$GLOBALS['action_scheduler']) return 0;
    check($hook === OverSeek_Tracking_Transport::STORE_CHANGE_HOOK && $group === 'overseek-store-sync', 'Wrong scheduler hook/group');
    $GLOBALS['store_jobs'][] = ['timestamp' => $timestamp, 'args' => $args, 'scheduler' => 'action'];
    return count($GLOBALS['store_jobs']);
}
function wp_unschedule_event($timestamp, $hook): bool { unset($GLOBALS['cron'][$hook]); return true; }
function add_action($hook, $callback, ...$args): void { $GLOBALS['actions'][$hook][] = $callback; }
function add_filter(...$args): void {}
function apply_filters($hook, $value) { return $value; }
function untrailingslashit($value): string { return rtrim($value, '/'); }
function wp_doing_ajax(): bool { return false; }
function wp_json_encode($value): string { return json_encode($value, JSON_THROW_ON_ERROR); }
function is_wp_error($value): bool { return $value instanceof WP_Error; }
function wp_remote_retrieve_response_code($value): int { return $value['response']['code'] ?? 0; }
function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? false; }
function wp_generate_uuid4(): string { static $id = 0; return 'operational-event-' . ++$id; }
function get_comment($id) { return $GLOBALS['comments'][$id] ?? null; }
function get_post($id) { return $GLOBALS['posts'][$id] ?? null; }
function wp_remote_post($url, $args)
{
    $GLOBALS['requests'][] = ['url' => $url, 'args' => $args];
    if ($GLOBALS['response'] instanceof Throwable) throw $GLOBALS['response'];
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
    foreach (['transients', 'cron', 'orders', 'requests', 'actions', 'comments', 'posts', 'store_jobs'] as $key) {
        $GLOBALS[$key] = [];
    }
    $GLOBALS['response'] = ['response' => ['code' => 200]];
    $GLOBALS['action_scheduler'] = false;
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
function run_store_worker(): array
{
    $job = array_shift($GLOBALS['store_jobs']);
    check(is_array($job), 'No operational job scheduled');
    OverSeek_Tracking_Transport::send_store_change(...$job['args']);
    return $job;
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
    check(is_callable($GLOBALS['actions'][OverSeek_Tracking_Transport::STORE_CHANGE_HOOK][0]), 'Operational worker callback missing');
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

$tests['operational changes are private ID-only signals acknowledged and retried'] = static function (): void {
    $_SERVER['HTTP_REFERER'] = 'https://store.example/wp-admin/orders';
    $tracking = new OverSeek_Server_Tracking();
    $tracking->track_order_change(42);
    $tracking->track_order_change(42);
    $tracking->flush_event_queue();
    check(count($GLOBALS['requests']) === 0, 'Operational signals must never perform HTTP inline');
    check(count($GLOBALS['store_jobs']) === 1, 'Repeated hooks in one request should coalesce');
    run_store_worker();
    $request = $GLOBALS['requests'][0]['args'];
    $body = json_decode($request['body'], true);
    check($body['type'] === 'order_changed' && $body['payload']['orderId'] === 42, 'Wrong operational payload');
    check(array_keys($body['payload']) === ['orderId', 'eventId'], 'Operational payload leaked order/customer details');
    check(!isset($body['visitorIp'], $body['email'], $body['referrer'], $body['userAgent']), 'Operational envelope leaked visitor data');
    check($body['visitorId'] === 'store-sync', 'Visitor identity must not be used for store operations');
    check($request['blocking'] && $request['timeout'] === 2, 'Store changes need acknowledgement');
    check($request['headers']['Authorization'] === 'Bearer test-token', 'Operational change not authenticated');
    unset($_SERVER['HTTP_REFERER']);

    $GLOBALS['response'] = new WP_Error();
    $tracking->track_customer_change(7);
    $tracking->flush_event_queue();
    run_store_worker();
    check(pending() === [] && count($GLOBALS['store_jobs']) === 1, 'Operational retry must not enter purchase queue');
    $retry = $GLOBALS['store_jobs'][0];
    $event_id = $retry['args'][0]['payload']['eventId'];
    check($retry['timestamp'] >= time() + 29 && $retry['args'][0]['_retry_count'] === 1, 'Operational retry backoff lost');
    $GLOBALS['response'] = ['response' => ['code' => 200]];
    run_store_worker();
    $last = json_decode(end($GLOBALS['requests'])['args']['body'], true);
    check($last['payload']['eventId'] === $event_id && $GLOBALS['store_jobs'] === [], 'Retry lost operational occurrence identity');
};

$tests['review changes cover pending reviews and moderation but ignore non-products'] = static function (): void {
    $GLOBALS['comments'][1] = (object) ['comment_ID' => 1, 'comment_post_ID' => 10];
    $GLOBALS['comments'][2] = (object) ['comment_ID' => 2, 'comment_post_ID' => 20];
    $GLOBALS['posts'][10] = (object) ['post_type' => 'product'];
    $GLOBALS['posts'][20] = (object) ['post_type' => 'post'];
    $tracking = new OverSeek_Server_Tracking();
    $tracking->track_review_change(1);
    $tracking->track_review_change(2);
    $tracking->flush_event_queue();
    check(count($GLOBALS['store_jobs']) === 1, 'Should only schedule the product review');
    run_store_worker();
    check(count($GLOBALS['requests']) === 1, 'Should only send the product review');
    $body = json_decode($GLOBALS['requests'][0]['args']['body'], true);
    check($body['type'] === 'review_changed' && $body['payload']['reviewId'] === 1, 'Wrong review identity');
    $tracking->track_review_status_change('approved', 'hold', $GLOBALS['comments'][1]);
    $tracking->flush_event_queue();
    run_store_worker();
    check(count($GLOBALS['requests']) === 2, 'Moderation change not sent');
    $next = json_decode($GLOBALS['requests'][1]['args']['body'], true);
    check($next['payload']['eventId'] !== $body['payload']['eventId'], 'Later change reused a previous occurrence');
};

$tests['operational hooks require a configured tracking token'] = static function (): void {
    $GLOBALS['options']['overseek_webhook_auth_token'] = '';
    $tracking = new OverSeek_Server_Tracking();
    $tracking->track_order_change(42);
    $tracking->track_customer_change(7);
    $tracking->flush_event_queue();
    check(count($GLOBALS['requests']) === 0, 'Unsigned operational work must not be sent');
    check($GLOBALS['store_jobs'] === [], 'Unsigned operational work must not be scheduled');
};

$tests['bulk changes do not block or evict any of fifty purchase retries'] = static function (): void {
    $backlog = array_map('event', range(1, 50));
    seed($backlog);
    $GLOBALS['response'] = new WP_Error();
    $tracking = new OverSeek_Server_Tracking();
    for ($id = 1; $id <= 80; $id++) $tracking->track_order_change($id);
    $tracking->flush_event_queue();
    check($GLOBALS['requests'] === [], 'Bulk edit performed inline HTTP');
    check(count($GLOBALS['store_jobs']) === 80, 'Bulk operational signals were capped or lost');
    check(pending() === $backlog, 'Bulk scheduling displaced purchase retries');
    for ($id = 1; $id <= 80; $id++) run_store_worker();
    check(count($GLOBALS['store_jobs']) === 80, 'Failed bulk delivery lost retries');
    check(pending() === $backlog, 'Operational failures displaced purchase retries');
};

$tests['mixed checkout still acknowledges only the purchase inline'] = static function (): void {
    $tracking = new OverSeek_Server_Tracking();
    $tracking->track_order_change(42);
    $queue = new ReflectionProperty($tracking, 'event_queue');
    $queue->setValue($tracking, array_merge($queue->getValue($tracking), [event(42)]));
    check($tracking->flush_event_queue() === ['purchase-42' => true], 'Purchase acknowledgement changed');
    check(count($GLOBALS['requests']) === 1 && count($GLOBALS['store_jobs']) === 1, 'Operational HTTP leaked into checkout');
    check(json_decode($GLOBALS['requests'][0]['args']['body'], true)['type'] === 'purchase', 'Wrong inline event');
};

$tests['operational retries are bounded, including transport exceptions'] = static function (): void {
    foreach ([new WP_Error(), new RuntimeException('Transport extension failed')] as $response) {
        reset_state();
        $GLOBALS['response'] = $response;
        $tracking = new OverSeek_Server_Tracking();
        $tracking->track_order_change(42);
        $tracking->flush_event_queue();
        foreach ([30, 120, 480] as $delay) {
            run_store_worker();
            check(count($GLOBALS['store_jobs']) === 1, 'Missing operational retry');
            check($GLOBALS['store_jobs'][0]['timestamp'] >= time() + $delay - 1, 'Incorrect retry backoff');
        }
        run_store_worker();
        check(count($GLOBALS['requests']) === 4 && $GLOBALS['store_jobs'] === [], 'Retry limit not respected');
        check(pending() === [], 'Operational exception contaminated purchase retries');
    }
};

$tests['operational jobs use Action Scheduler with WP-Cron fallback'] = static function (): void {
    foreach ([true => 'action', false => 'cron', 'throw' => 'cron'] as $mode => $expected) {
        reset_state();
        $GLOBALS['action_scheduler'] = $mode;
        $tracking = new OverSeek_Server_Tracking();
        $tracking->track_order_change(42);
        $tracking->flush_event_queue();
        check(count($GLOBALS['store_jobs']) === 1 && $GLOBALS['store_jobs'][0]['scheduler'] === $expected, 'Wrong scheduling backend');
        run_store_worker();
        check(count($GLOBALS['requests']) === 1, 'Background job did not deliver');
    }
};

$tests['old operational transient entries move out without touching purchase retries'] = static function (): void {
    $old = event(42); $old['type'] = 'order_changed';
    seed([$old, event(1, 400)]);
    run_worker();
    check($GLOBALS['requests'] === [] && count($GLOBALS['store_jobs']) === 1, 'Legacy operational retry must defer HTTP');
    check(count(pending()) === 1 && pending()[0]['type'] === 'purchase', 'Legacy migration disturbed purchase retry');
    run_store_worker();
    check(count($GLOBALS['requests']) === 1, 'Legacy operational job not delivered');
};

$tests['operational worker rejects foreign-account and non-operational jobs'] = static function (): void {
    foreach (['foreign', 'purchase'] as $mode) {
        $job = event(42); $job['type'] = 'order_changed';
        if ($mode === 'foreign') $job['accountId'] = 'old-store';
        else $job['type'] = 'purchase';
        OverSeek_Tracking_Transport::send_store_change($job);
    }
    check($GLOBALS['requests'] === [] && $GLOBALS['store_jobs'] === [], 'Invalid job replayed');
};

foreach ($tests as $name => $test) {
    reset_state();
    $test();
    fwrite(STDOUT, "PASS: {$name}\n");
}
fwrite(STDOUT, count($tests) . " tracking retry regression tests passed.\n");

<?php
/** Google attribution regression tests; no WordPress, HTTP or database required. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
function sanitize_text_field($value) { return strip_tags($value); }
function wp_unslash($value) { return stripslashes($value); }
function wp_json_encode($value) { return json_encode($value); }
class OverSeek_Tracking_Request_Utils {
    public static function set_cookie_safe($name, $value, $expiry) { $_COOKIE[$name] = $value; }
    public static function get_json_cookie($name) { return json_decode($_COOKIE[$name] ?? '', true); }
}
require_once __DIR__ . '/../includes/class-overseek-tracking-attribution-utils.php';
require_once __DIR__ . '/../includes/class-overseek-tracking-payload-utils.php';
function check($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }

$params = ['gclid' => 'google', 'gbraid' => 'google', 'wbraid' => 'google', 'fbclid' => 'facebook'];
foreach ($params as $param => $platform) {
    $_COOKIE = [];
    $_GET = [$param => 'original-click'];
    $expected = ['id' => 'original-click', 'platform' => $platform, 'param' => $param];
    check(OverSeek_Tracking_Attribution_Utils::get_click_data($params) === $expected, 'URL click type lost: ' . $param);
    OverSeek_Tracking_Attribution_Utils::persist_click_id($params);
    $_GET = [];
    check(OverSeek_Tracking_Attribution_Utils::get_click_data($params) === $expected, 'Persisted click type lost: ' . $param);
}
$_COOKIE = ['_os_click' => json_encode(['id' => 'legacy', 'platform' => 'google'])];
check(OverSeek_Tracking_Attribution_Utils::get_click_data($params)['id'] === 'legacy', 'Legacy click cookie must remain usable');

$_COOKIE = [
    '_ga' => 'GA1.1.1234567890.1770000000',
    '_ga_OLDSTREAM' => 'GS1.1.1770000123.2.1.1770000456.0.0.0',
    '_ga_NEWSTREAM' => 'GS2.1.s1770000789$o2$g1$t1770000999$j0$l0$h0',
    '_ga_REORDERED' => 'GS2.1.o2$g1$s1770000345$t1770000999',
    '_ga_INVALID' => 'GS2.1.o1$t1770000999',
    '_ga_INVALID2' => 'GS1.1.invalid.1.0',
    '_ga_ZERO' => 'GS2.1.s0$o1',
    '_ga_ARRAY' => ['invalid'],
    '_fbp' => 'fb.1.original-browser', '_fbc' => 'fb.1.original-click',
];
$original_cookies = $_COOKIE;
$event = ['eventId' => 'unchanged-dedup-id', 'orderId' => 123, 'total' => 99.95, 'currency' => 'AUD'];
$payload = OverSeek_Tracking_Payload_Utils::attach_platform_cookies($event);
check($payload['gaSessionIds'] === ['OLDSTREAM' => '1770000123', 'NEWSTREAM' => '1770000789', 'REORDERED' => '1770000345'], 'GS1/GS2 stream sessions parsed incorrectly');
check($payload['gaClientId'] === $_COOKIE['_ga'], 'GA client ID changed');
check($payload['fbc'] === $_COOKIE['_fbc'] && $payload['fbp'] === $_COOKIE['_fbp'], 'Meta cookies changed');
check(array_intersect_key($payload, $event) === $event, 'Purchase values or dedup ID changed');
check($_COOKIE === $original_cookies, 'Cookie capture mutated source identifiers');
$_COOKIE = [];
check(OverSeek_Tracking_Payload_Utils::attach_platform_cookies($event) === $event, 'Missing Google cookies must not invent sessions');
echo "Google attribution and Meta identifier preservation passed.\n";

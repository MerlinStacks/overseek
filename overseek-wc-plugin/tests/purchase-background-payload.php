<?php
/** Background purchases must not read the gateway/admin's cookies or identity. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
class OverSeek_Pixel_Matching_Utils {
    public static function get_external_id() { throw new RuntimeException('Background read shopper identity from callback'); }
}
class OverSeek_Tracking_Payload_Utils {
    public static function attach_platform_cookies($payload) { throw new RuntimeException('Background read callback cookies'); }
}
class Background_Purchase_Order {
    public function get_items() { return []; }
    public function get_date_created() { return null; }
    public function get_meta($key) { return ''; }
    public function get_total() { return '80.00'; }
    public function get_currency() { return 'AUD'; }
    public function get_billing_email() { return 'shopper@example.test'; }
    public function __call($method, $args) { return 0; }
}
require_once __DIR__ . '/../includes/class-overseek-tracking-event-builder.php';
$payload = OverSeek_Tracking_Event_Builder::build_purchase_payload(new Background_Purchase_Order(), 42, 'stable-event', [], false);
if ($payload['total'] !== 80.0 || $payload['email'] !== 'shopper@example.test' || $payload['eventId'] !== 'stable-event'
    || isset($payload['externalId']) || isset($payload['fbc'])) {
    throw new RuntimeException('Background payload lost order data or invented browser identity');
}
echo "Background purchase payload uses order data without reading callback identity or cookies.\n";

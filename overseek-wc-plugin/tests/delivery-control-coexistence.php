<?php
/** Keep the old display during private preparation, never during new activation. */
declare(strict_types=1);
require __DIR__ . '/delivery-control-disable.php';
define('WC_VERSION', '9.9.0');
function get_plugins() { return ['pi-edd/pi-edd.php' => ['Name' => 'Pi Estimated Delivery Date']]; }
function get_post_status($id) { return 'publish'; }
function get_post_field($field, $id) { return $id === 1 ? '[woocommerce_cart]' : '[woocommerce_checkout]'; }
function has_block($name, $content) { return false; }
function has_shortcode($content, $name) { return str_contains($content, '[' . $name . ']'); }

reset_receipts();
$GLOBALS['receipt_test_options'] = ['active_plugins' => ['pi-edd/pi-edd.php'], 'woocommerce_cart_page_id' => 1, 'woocommerce_checkout_page_id' => 2];
$GLOBALS['wpdb']->tables['wp_overseek_delivery_inputs'] = true;
$storage = new OverSeek_Delivery_Input_Storage();
$storage->store('account-A', ['scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'payload' => ['enabled' => true, 'settings' => []]]);
$handler = new OverSeek_Delivery_Control();
$send_control = static fn($revision, $action) => $handler->handle(new WP_REST_Request(json_encode([
    'schemaVersion' => 1, 'revision' => $revision, 'action' => $action, 'epoch' => 'epoch',
    'owners' => $action === 'baseline' ? [20] : [], 'settingsRevision' => 1,
])));
$blocker = 'deactivate_old_delivery_plugin:pi-edd/pi-edd.php';
same(OverSeek_Delivery_Control::blockers(), [$blocker]);
// The exception is narrow: compatibility prerequisites still reject preparation.
$GLOBALS['receipt_test_options']['woocommerce_manage_stock'] = 'no';
error_is($send_control(1, 'baseline'), 'overseek_control_conflict', 409);
$GLOBALS['receipt_test_options']['woocommerce_manage_stock'] = 'yes';
foreach ([1 => 'baseline', 2 => 'guarded'] as $revision => $action) {
    $response = $send_control($revision, $action);
    same($response instanceof WP_REST_Response, true);
    same($response->data['state']['mode'], $action);
    same($response->data['state']['active'], false);
    same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
    same(OverSeek_Delivery_Control::blockers(), [$blocker]);
}
$blocked = $send_control(3, 'activate');
error_is($blocked, 'overseek_control_conflict', 409);
same(str_contains($blocked->message, $blocker), true);
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
// Merchant removes Pi only when private inputs/preparation are complete.
$GLOBALS['receipt_test_options']['active_plugins'] = [];
$activated = $send_control(3, 'activate');
same($activated instanceof WP_REST_Response, true);
same($activated->data['state']['active'], true);
same($activated->data['state']['environmentFingerprint'], OverSeek_Delivery_Control::fingerprint());
same(OverSeek_Delivery_Storefront_Gate::is_active(), true);
// Re-enabling the old plugin invalidates the gate and blocks any new activation.
$GLOBALS['receipt_test_options']['active_plugins'] = ['pi-edd/pi-edd.php'];
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
error_is($send_control(3, 'activate'), 'overseek_control_conflict', 409);
error_is($send_control(4, 'activate'), 'overseek_control_conflict', 409);
$GLOBALS['receipt_test_options']['woocommerce_manage_stock'] = 'no';
same($send_control(4, 'disable')->data['state']['active'], false);
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
same($GLOBALS['calls'], []); // No stock effects added by coexistence policy.
fwrite(STDOUT, "Old-plugin preparation coexistence: inactive baseline/guarded accepted; activation gated; disable unconditional.\n");

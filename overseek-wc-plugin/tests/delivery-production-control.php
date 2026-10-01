<?php
/** Simple activation leaves the existing receipt transport and saved inputs intact. */
declare(strict_types=1);
require __DIR__ . '/delivery-control-coexistence.php';
reset_receipts();
$GLOBALS['receipt_test_options'] = ['active_plugins' => [], 'woocommerce_cart_page_id' => 1, 'woocommerce_checkout_page_id' => 2, 'woocommerce_manage_stock' => 'no'];
$GLOBALS['wpdb']->tables['wp_overseek_delivery_inputs'] = true;
$storage = new OverSeek_Delivery_Input_Storage();
$settings = ['enabled' => true, 'settings' => ['estimateMode' => 'production', 'fallbackSupplierLeadTimeDays' => 17]];
$storage->store('account-A', ['scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'payload' => $settings]);
$handler = new OverSeek_Delivery_Control();
$command = ['schemaVersion' => 1, 'revision' => 1, 'action' => 'activate', 'epoch' => null, 'owners' => [], 'settingsRevision' => 1, 'estimateMode' => 'production'];
$response = $handler->handle(new WP_REST_Request(json_encode($command)));
same($response instanceof WP_REST_Response, true);
same($response->data['state']['mode'], 'legacy');
same($response->data['state']['epoch'], null);
same(OverSeek_Delivery_Storefront_Gate::is_active(), true);
same($storage->read_settings()['payload'], $settings);
same($GLOBALS['calls'], []);
same($handler->handle(new WP_REST_Request(json_encode($command))) instanceof WP_REST_Response, true);
$settings['settings']['estimateMode'] = 'inventory';
$storage->store('account-A', ['scope' => 'settings', 'entityId' => 0, 'revision' => 2, 'payload' => $settings]);
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
$command['revision'] = 2; $command['settingsRevision'] = 2;
error_is($handler->handle(new WP_REST_Request(json_encode($command))), 'overseek_control_conflict', 409);
// Replay the production incident's exact JSONB command shape (including null cursor/epoch).
$settings['settings']['estimateMode'] = 'production';
$storage->store('account-A', ['scope' => 'settings', 'entityId' => 0, 'revision' => 24, 'payload' => $settings]);
$command = json_decode('{"epoch":null,"action":"activate","cursor":null,"owners":[],"revision":8,"estimateMode":"production","schemaVersion":1,"settingsRevision":24}', true);
$response = $handler->handle(new WP_REST_Request(json_encode($command)));
same($response instanceof WP_REST_Response, true);
same($response->data['revision'], 8);
same(OverSeek_Delivery_Storefront_Gate::is_active(), true);
foreach ([
    ['schemaVersion', '1', 'schemaVersion'],
    ['revision', '9', 'revision'],
    ['action', 'SECRET', 'action'],
    ['estimateMode', 'SECRET', 'estimateMode'],
    ['owners', ['SECRET'], 'owners'],
    ['estimateMode', null, 'epoch'],
] as [$field, $value, $expected]) {
    $invalid = array_replace($command, ['revision' => 9], [$field => $value]);
    $error = $handler->handle(new WP_REST_Request(json_encode($invalid)));
    error_is($error, 'overseek_control_invalid', 400);
    same(str_starts_with($error->message, 'Invalid launch control: ' . $expected), true);
    same($handler->handle(new WP_REST_Request(json_encode($command)))->data['revision'], 8);
}
fwrite(STDOUT, "Production-only activation preserves receipt mode and enforces settings-mode agreement.\n");

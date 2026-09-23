<?php
/** Actual control handler/storage/gate, with configuration delivery still parked upstream. */
declare(strict_types=1);
require __DIR__ . '/delivery-receipts.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-control.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-storefront-gate.php';
function get_site_option($key, $default = false) { return $default; }
function is_wp_error($value): bool { return $value instanceof WP_Error; }
reset_receipts();
$GLOBALS['wpdb']->tables['wp_overseek_delivery_inputs'] = true;
$storage = new OverSeek_Delivery_Input_Storage();
same($storage->store('account-A', ['scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'payload' => ['enabled' => true, 'settings' => []]]), true);
same($storage->store('account-A', ['scope' => 'control', 'entityId' => 0, 'revision' => 1, 'payload' => ['active' => true, 'mode' => 'guarded', 'epoch' => 'epoch', 'settingsRevision' => 1, 'environmentFingerprint' => OverSeek_Delivery_Control::fingerprint()]]), true);
same(OverSeek_Delivery_Storefront_Gate::is_active(), true);
$handler = new OverSeek_Delivery_Control();
$request = new WP_REST_Request(json_encode(['schemaVersion' => 1, 'revision' => 2, 'action' => 'disable', 'epoch' => 'epoch', 'owners' => []]));
$disabled = $handler->handle($request);
same($disabled instanceof WP_REST_Response, true);
same($disabled->data['state']['active'], false);
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
same($storage->read_settings()['payload']['enabled'], true); // Parked/failed input sync never delivered false.
same($handler->handle($request)->data, $disabled->data); // Lost disable ACK replay.
$old = $handler->handle(new WP_REST_Request(json_encode(['schemaVersion' => 1, 'revision' => 1, 'action' => 'activate', 'epoch' => 'epoch', 'settingsRevision' => 1])));
error_is($old, 'overseek_control_conflict', 409);
same(OverSeek_Delivery_Storefront_Gate::is_active(), false);
same($GLOBALS['calls'], []);
fwrite(STDOUT, "Independent control disable reaches actual plugin gate while settings stay enabled; stale activation rejected.\n");

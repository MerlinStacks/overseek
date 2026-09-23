<?php
/** Legacy recovery exercises native-owner observation and audit-only ACK replay. */
declare(strict_types=1);
require __DIR__ . '/delivery-launch-receipts.php';
require_once __DIR__ . '/../includes/class-overseek-legacy-receipt-reconciliation.php';
reset_receipts();
$GLOBALS['products'][20]->type = 'variable';
$GLOBALS['products'][21] = new WC_Product_Variation(21, 'variation', 20);
$GLOBALS['products'][21]->owner = 20; $GLOBALS['products'][21]->manage = 'parent';
$GLOBALS['wpdb']->native_stock[20] = 12;
$legacy_api = new OverSeek_Legacy_Receipt_Reconciliation();
$source = ['schemaVersion' => 1, 'jobId' => 'legacy-job', 'sourceIncomplete' => false, 'targets' => [
    ['productWooId' => 20, 'variationWooId' => null], ['productWooId' => 20, 'variationWooId' => 21],
]];
$observed = $legacy_api->observe(new WP_REST_Request(json_encode($source)));
same($observed instanceof WP_REST_Response, true);
same($observed->data['owners'], [['stockOwnerWooId' => 20, 'stockQuantity' => 12]]);
$attestation = $source + ['actionId' => 'legacy-resolution', 'actorId' => 'inventory-manager', 'reason' => 'Corrected inventory including legacy and dependent work; workers restarted.', 'receivingPaused' => true, 'workersRestarted' => true, 'correctedInventoryIncludesLegacyWork' => true, 'acknowledgeUnobservableTargets' => false, 'observationToken' => $observed->data['observationToken']];
$GLOBALS['wpdb']->native_stock[20] = 13;
error_is($legacy_api->reconcile(new WP_REST_Request(json_encode($attestation))), 'overseek_legacy_conflict', 409);
same($GLOBALS['wpdb']->resolutions, []);
$fresh_observation = $legacy_api->observe(new WP_REST_Request(json_encode($source)));
$attestation['observationToken'] = $fresh_observation->data['observationToken'];
$result = $legacy_api->reconcile(new WP_REST_Request(json_encode($attestation)));
same($result instanceof WP_REST_Response, true);
same($result->data['state'], 'operator_attested_drained');
same($GLOBALS['calls'], []); same($GLOBALS['wpdb']->journal, []); // Ledger and stock APIs untouched.
unset($GLOBALS['products'][20], $GLOBALS['products'][21]);
same($legacy_api->reconcile(new WP_REST_Request(json_encode($attestation)))->data, $result->data); // Lost ACK survives deletion.
$changed = $attestation; $changed['reason'] = 'Changed reason with same action is not idempotent';
error_is($legacy_api->reconcile(new WP_REST_Request(json_encode($changed))), 'overseek_legacy_conflict', 409);

$missing = ['schemaVersion' => 1, 'jobId' => 'old-job-without-original-targets', 'sourceIncomplete' => true, 'targets' => [['productWooId' => 999, 'variationWooId' => null]]];
$observation = $legacy_api->observe(new WP_REST_Request(json_encode($missing)));
same($observation->data['owners'], []); same(count($observation->data['unobservable']), 1);
$unknown = array_replace($attestation, $missing, ['actionId' => 'unobservable-review', 'observationToken' => $observation->data['observationToken']]);
error_is($legacy_api->reconcile(new WP_REST_Request(json_encode($unknown))), 'overseek_legacy_conflict', 409);
$unknown['acknowledgeUnobservableTargets'] = true;
same($legacy_api->reconcile(new WP_REST_Request(json_encode($unknown)))->data['state'], 'operator_attested_drained');
same($GLOBALS['calls'], []); same($GLOBALS['wpdb']->journal, []); same($GLOBALS['wpdb']->locks, []);
$audit = json_decode($GLOBALS['wpdb']->resolutions['account-A|unobservable-review'], true);
same($audit['actorId'], 'inventory-manager'); same($audit['request']['acknowledgeUnobservableTargets'], true);
same($audit['wooUserId'], 45);
$unicode_source = $missing; $unicode_source['jobId'] = 'utf8-job';
$unicode_observation = $legacy_api->observe(new WP_REST_Request(json_encode($unicode_source)));
$unicode_request = array_replace($unknown, $unicode_source, ['actionId' => 'utf8-resolution', 'reason' => str_repeat('庫', 1000), 'observationToken' => $unicode_observation->data['observationToken']]);
same($legacy_api->reconcile(new WP_REST_Request(json_encode($unicode_request)))->data['state'], 'operator_attested_drained');
fwrite(STDOUT, "Legacy operator review: {$checks} cumulative assertions passed; no stock or guarded ledger replay.\n");

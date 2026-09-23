<?php
/** Dependency-free inbound ingestion regression harness. @package OverSeek */
declare(strict_types=1);
require __DIR__ . '/delivery-inputs.php';

$GLOBALS['caps'] = ['manage_woocommerce'];
$GLOBALS['wpdb'] = new Input_DB();
same($storage->read_inbound(10), null);
same($storage->read_inbound(0), null);
same($GLOBALS['wpdb']->installs, 0);
$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$target = ['wooId' => 11, 'stockOwnerWooId' => 11, 'state' => 'pending', 'supplierLead' => ['min' => 0, 'max' => 3650], 'batches' => [['dueDate' => '2028-02-29', 'quantity' => 1000000]]];
$inbound = ['schemaVersion' => 1, 'scope' => 'inbound', 'entityId' => 10, 'revision' => 1, 'payload' => ['wooId' => 10, 'generatedAt' => $now->format('Y-m-d\TH:i:s.000\Z'), 'expiresAt' => $now->modify('+24 hours')->format('Y-m-d\TH:i:s.000\Z'), 'receiptSafety' => 'unverified', 'targets' => [$target]]];
same(send($inbound)->data, ['schemaVersion' => 1, 'scope' => 'inbound', 'entityId' => 10, 'revision' => 1, 'storedRevision' => 1, 'applied' => true, 'storefrontActivated' => false]);
same($storage->read_inbound(10)['payload']['targets'][0]['batches'][0]['quantity'], 1000000);
same($storage->read_inbound(11), null);
$replay = $inbound; $replay['payload'] = array_reverse($replay['payload'], true);
$replay['payload']['targets'][0] = array_reverse($target, true);
same(send($replay)->data['applied'], false);
$json = str_replace('"quantity":1000000', '"quantity":1e6', json_encode($inbound));
same($api->ingest(new WP_REST_Request($json))->data['applied'], false);
same($api->ingest(new WP_REST_Request(str_pad(json_encode($inbound), 512 * 1024, ' ')))->status, 200);
status($api->ingest(new WP_REST_Request(str_pad(json_encode($inbound), 512 * 1024 + 1, ' '))), 413);
foreach (['verified', 'ready', null, true] as $safety) { $bad = $inbound; $bad['payload']['receiptSafety'] = $safety; invalid($bad); }
foreach (['ready', 'verified', '', null] as $state) { $bad = $inbound; $bad['payload']['targets'][0]['state'] = $state; invalid($bad); }
foreach (['2026-02-29', '2028-02-30', '2026-04-31', '2026-1-01', '0000-01-01', '2028-02-29T00:00:00Z', 123] as $date) {
    $bad = $inbound; $bad['payload']['targets'][0]['batches'][0]['dueDate'] = $date; invalid($bad);
}
foreach ([0, -1, 1.5, 1000001, '1', true, null] as $qty) { $bad = $inbound; $bad['payload']['targets'][0]['batches'][0]['quantity'] = $qty; invalid($bad); }
foreach ([[], ['min' => 0], ['min' => null, 'max' => null], ['min' => -1, 'max' => 0], ['min' => 2, 'max' => 1], ['min' => 0, 'max' => 3651], ['min' => '0', 'max' => 1]] as $lead) {
    $bad = $inbound; $bad['payload']['targets'][0]['supplierLead'] = $lead; invalid($bad);
}
foreach ([12, 20, 99999, '11', 11.5] as $id) { $bad = $inbound; $bad['payload']['targets'][0]['wooId'] = $id; invalid($bad); }
foreach ([null, 10, 12, 0, '11'] as $id) { $bad = $inbound; $bad['payload']['targets'][0]['stockOwnerWooId'] = $id; invalid($bad); }
$bad = $inbound; $bad['payload']['wooId'] = 20; invalid($bad);
$bad = $inbound; $bad['payload']['targets'][] = $target; invalid($bad);
$bad = $inbound; $bad['payload']['targets'][0]['batches'][] = $target['batches'][0]; invalid($bad);
foreach (['payload', 'target', 'batch'] as $where) {
    $bad = $inbound;
    if ($where === 'payload') { $bad['payload']['SECRET'] = 'SECRET'; }
    elseif ($where === 'target') { $bad['payload']['targets'][0]['SECRET'] = 'SECRET'; }
    else { $bad['payload']['targets'][0]['batches'][0]['SECRET'] = 'SECRET'; }
    invalid($bad);
}
foreach (['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+10:00'] as $instant) {
    foreach (['generatedAt', 'expiresAt'] as $field) { $bad = $inbound; $bad['payload'][$field] = $instant; invalid($bad); }
}
foreach ([['-25 hours', '-1 hour'], ['+10 minutes', '+1450 minutes'], ['now', '+25 hours'], ['now', '+23 hours']] as [$start, $end]) {
    $bad = $inbound; $bad['payload']['generatedAt'] = $now->modify($start)->format('Y-m-d\TH:i:s\Z'); $bad['payload']['expiresAt'] = $now->modify($end)->format('Y-m-d\TH:i:s\Z'); invalid($bad);
}
$valid = $inbound; $valid['revision'] = 2;
foreach (['unsupported', 'integrity_error'] as $state) {
    $valid['payload']['targets'] = [['wooId' => 10, 'stockOwnerWooId' => null, 'state' => $state, 'supplierLead' => null, 'batches' => []]];
    same(send($valid)->data['applied'], true); $valid['revision']++;
    $bad = $valid; $bad['payload']['targets'][0]['batches'] = $target['batches']; invalid($bad);
}
// Real parent-owned stock cannot masquerade as independent variation supply.
$GLOBALS['products'][13] = new class(13, 10) extends WC_Product_Variation {
    public function get_stock_managed_by_id(): int { return 10; }
};
$bad = $inbound; $bad['payload']['targets'][0]['wooId'] = 13; $bad['payload']['targets'][0]['stockOwnerWooId'] = 13; invalid($bad);
$bad['payload']['targets'][0]['stockOwnerWooId'] = 10;
same((new OverSeek_Delivery_Input_Validation())->validate(json_encode($bad))['scope'], 'inbound'); // Explicit real parent owner is supported.
// Maximum aggregate bounds, not just per-target limits.
$max = $inbound; $max['revision'] = 4; $max['payload']['targets'] = [];
for ($i = 100; $i < 1100; $i++) {
    $t = $target; $t['wooId'] = $i; $t['stockOwnerWooId'] = $i; $max['payload']['targets'][] = $t;
}
$max['payload']['targets'][] = ['wooId' => 10, 'stockOwnerWooId' => null, 'state' => 'unsupported', 'supplierLead' => null, 'batches' => []];
same(send($max)->data['applied'], true);
same(count($storage->read_inbound(10)['payload']['targets']), 1001);
$bad = $max; $bad['payload']['targets'][] = $target; invalid($bad);
$bad = $max; $bad['payload']['targets'][0]['batches'][] = ['dueDate' => '2028-03-01', 'quantity' => 1]; invalid($bad);
status(send($inbound), 409);
$bad = $max; $bad['payload']['targets'][0]['batches'][0]['quantity'] = 1; status(send($bad), 409);
// Keyed reads and auth never cross accounts or install during reads.
$db = $GLOBALS['wpdb']; $installs = $db->installs;
foreach (['account-B', 'account-a', ''] as $account) { $GLOBALS['linked'] = $account; same($storage->read_inbound(10), null); status(send($inbound), 403); }
$GLOBALS['linked'] = 'account-B';
same(send($inbound, ['x-overseek-account-id' => 'account-B'])->data['applied'], true);
same($storage->read_inbound(10)['revision'], 1);
$validated = (new OverSeek_Delivery_Input_Validation())->validate(json_encode($inbound));
status($storage->store('account-A', $validated), 403);
$GLOBALS['linked'] = 'account-A';
same($storage->read_inbound(10)['revision'], 4);
same($db->installs, $installs);
status(send($inbound, ['x-overseek-account-id' => 'account-A'], ['accountId' => 'account-B']), 403);
// Full replacement clears all targets, including when Woo has removed the parent.
unset($GLOBALS['products'][10]);
$clear = $inbound; $clear['revision'] = 5; $clear['payload']['targets'] = [];
same(send($clear)->data['applied'], true);
same($storage->read_inbound(10)['payload']['targets'], []);
same(send($clear)->data['applied'], false);
same($storage->read_product(10), null);
// Both durable deletion replacements ACK after the product has disappeared;
// a configured live sibling keeps its independent product/inbound snapshots.
$live_product = ['schemaVersion' => 1, 'scope' => 'product', 'entityId' => 20, 'revision' => 1,
    'payload' => ['wooId' => 20, 'productionMinDays' => 0, 'productionMaxDays' => 2, 'variations' => []]];
same(send($live_product)->data['applied'], true);
$live_inbound = $inbound; $live_inbound['entityId'] = 20; $live_inbound['payload']['wooId'] = 20;
$live_inbound['payload']['targets'] = [['wooId' => 20, 'stockOwnerWooId' => 20, 'state' => 'pending', 'supplierLead' => null, 'batches' => []]];
same(send($live_inbound)->data['applied'], true);
$product_clear = ['schemaVersion' => 1, 'scope' => 'product', 'entityId' => 10, 'revision' => 6,
    'payload' => ['wooId' => 10, 'productionMinDays' => null, 'productionMaxDays' => null, 'variations' => []]];
$GLOBALS['product_lookups'] = [];
same(send($product_clear)->data['storedRevision'], 6);
same(send($clear)->data['storedRevision'], 5);
same($GLOBALS['product_lookups'], []);
same($storage->read_product(20)['payload']['productionMaxDays'], 2);
same($storage->read_inbound(20)['payload']['targets'][0]['state'], 'pending');
$source = file_get_contents(__DIR__ . '/../includes/class-overseek-delivery-inbound-validation.php');
same((bool) preg_match('/\b(wp_remote_\w+|wc_get_products|update_post_meta|add_action|add_filter)\s*\(/', $source), false);
echo "Delivery inbound inputs: {$checks} cumulative checks passed.\n";

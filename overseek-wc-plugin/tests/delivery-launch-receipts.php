<?php
/** Exercises actual finalizer/reconciliation code against the journal SQL model. */
declare(strict_types=1);
require __DIR__ . '/delivery-receipts.php';
require_once __DIR__ . '/../includes/class-overseek-receipt-reconciliation.php';

reset_receipts();
$first = op();
ack(send($first), $first, 'prepared');
$GLOBALS['native_trace'] = 'silent-failure';
ack(send($first, 'apply'), $first, 'uncertain');
$GLOBALS['native_trace'] = 'success';
$GLOBALS['wpdb']->native_stock[20] = 7; // Operator corrected count, including this operation.
$resolutionApi = new OverSeek_Receipt_Reconciliation();
$observation = $resolutionApi->observe(new WP_REST_Request(json_encode(['operation' => $first])));
same($observation instanceof WP_REST_Response, true);
$body = ['operation' => $first, 'actionId' => 'resolve-1', 'actorId' => 'inventory-manager', 'reason' => 'Count corrected including receipt, excluding later queue.', 'correctedCountIncludesOperation' => true, 'observedStockQuantity' => 7, 'observationToken' => $observation->data['observationToken']];
$GLOBALS['wpdb']->native_stock[20] = 8;
error_is($resolutionApi->reconcile(new WP_REST_Request(json_encode($body))), 'overseek_resolution_conflict', 409);
$observation = $resolutionApi->observe(new WP_REST_Request(json_encode(['operation' => $first])));
$body['observationToken'] = $observation->data['observationToken']; $body['observedStockQuantity'] = 8;
$call_count = count($GLOBALS['calls']);
$resolved = $resolutionApi->reconcile(new WP_REST_Request(json_encode($body)));
same($resolved instanceof WP_REST_Response, true);
same($resolved->data['state'], 'reconciled');
same(count($GLOBALS['calls']), $call_count); // Never retries a delta.
same($resolutionApi->reconcile(new WP_REST_Request(json_encode($body)))->data, $resolved->data);
$reordered = array_reverse($body, true);
$reordered['operation'] = array_reverse($body['operation'], true);
same($resolutionApi->reconcile(new WP_REST_Request(json_encode($reordered)))->data, $resolved->data);
same(count($GLOBALS['calls']), $call_count);
ack(send($first, 'apply'), $first, 'applied', 8); // Historical replay cannot apply again.
same(count($GLOBALS['calls']), $call_count);
$next = op('next', 2, 2);
$GLOBALS['products'][20]->quantity = 8; // Native Woo refresh after operator correction.
ack(send($next), $next, 'prepared'); // Ordered queue continues after phase 5.
ack(send($next, 'apply'), $next, 'applied', 10);

$storage = new OverSeek_Receipt_Storage();
same($storage->lock_owners([20]), true);
$GLOBALS['wpdb']->query('START TRANSACTION');
$stale = ['version' => 1, 'epoch' => 'epoch', 'owners' => [['stockOwnerWooId' => 20, 'sequence' => 1, 'operationId' => $first['operationId']]]];
try { $storage->release_proof('account-A', $stale); throw new LogicException('Old proof accepted'); } catch (DomainException $expected) {}
same($storage->guard('account-A', 20)['guard_active'], 1);
$GLOBALS['wpdb']->query('ROLLBACK');
$proof = ['version' => 1, 'epoch' => 'epoch', 'owners' => [['stockOwnerWooId' => 20, 'sequence' => 2, 'operationId' => 'next']]];
$GLOBALS['wpdb']->query('START TRANSACTION');
$storage->release_proof('account-A', $proof);
same($storage->guard('account-A', 20)['guard_active'], 0);
$GLOBALS['wpdb']->query('ROLLBACK'); // Failed input publish rolls the guard back too.
same($storage->guard('account-A', 20)['guard_active'], 1);
$GLOBALS['wpdb']->query('START TRANSACTION'); $storage->release_proof('account-A', $proof); $GLOBALS['wpdb']->query('COMMIT');
$storage->close();
ack(send(op('third', 3, 1)), op('third', 3, 1), 'prepared'); // Released guard accepts next sequence.
same($GLOBALS['wpdb']->guards['account-A|20']['guard_active'], 1);

reset_receipts(); $storage = new OverSeek_Receipt_Storage();
same($storage->lock_owners([20]), true); $storage->install();
$storage->baseline('account-A', 'epoch', [20]);
same($storage->guard('account-A', 20), ['operation_id' => 'baseline_epoch', 'sequence' => 0, 'guard_active' => 1]);
$storage->close(); ack(send(op()), op(), 'prepared');
reset_receipts(); $GLOBALS['products'][20]->type = 'variable';
$parent_op = op('parent-receipt', 1, 4);
ack(send($parent_op), $parent_op, 'prepared'); ack(send($parent_op, 'apply'), $parent_op, 'applied', 4);
$GLOBALS['products'][21] = new WC_Product_Variation(21, 'variation', 20);
$GLOBALS['products'][21]->owner = 20; $GLOBALS['products'][21]->manage = 'parent';
$child_op = op('inherited-receipt', 2, 2); $child_op['variationWooId'] = 21;
ack(send($child_op), $child_op, 'prepared'); ack(send($child_op, 'apply'), $child_op, 'applied', 6);
same($GLOBALS['products'][21]->manage, 'parent');
same($GLOBALS['products'][21]->quantity, 0);
same($GLOBALS['calls'], [[20, 4, 'increase'], [20, 2, 'increase']]);
fwrite(STDOUT, "Launch receipt finalization/reconciliation: {$checks} cumulative assertions passed.\n");

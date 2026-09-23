<?php
/** Typed REST diagnostics retain generic text and never expose raw exceptions. */
declare(strict_types=1);
require __DIR__ . '/delivery-inputs.php';
$GLOBALS['linked'] = 'account-A'; $GLOBALS['caps'] = ['manage_woocommerce'];
$GLOBALS['products'][10] = new WC_Product(10, 'variable');
foreach ([11, 12] as $id) $GLOBALS['products'][$id] = new class($id, 10) extends WC_Product_Variation {
    public function get_stock_managed_by_id(): int { return 10; }
};
$wire = json_decode(file_get_contents(__DIR__ . '/../../packages/overseek-core/test-fixtures/delivery-variant-supplier-leads-v1.json'), true, 32, JSON_THROW_ON_ERROR);
$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$wire['payload']['generatedAt'] = $now->format('Y-m-d\TH:i:s\Z');
$wire['payload']['expiresAt'] = $now->modify('+24 hours')->format('Y-m-d\TH:i:s\Z');
same((new OverSeek_Delivery_Input_Validation())->validate(json_encode($wire))['scope'], 'inbound');
function reason(array $wire, string $expected): void {
    $result = send($wire); status($result, 400);
    same($result->code, 'overseek_delivery_input_invalid'); same($result->data['reason'], $expected);
}
$bad = $wire; $bad['SECRET'] = 'SECRET'; reason($bad, 'schema_invalid');
$bad = $wire; $bad['payload']['generatedAt'] = $now->modify('-25 hours')->format('Y-m-d\TH:i:s\Z'); $bad['payload']['expiresAt'] = $now->modify('-1 hour')->format('Y-m-d\TH:i:s\Z'); reason($bad, 'inbound_expired');
$bad = $wire; $bad['payload']['generatedAt'] = $now->modify('+10 minutes')->format('Y-m-d\TH:i:s\Z'); $bad['payload']['expiresAt'] = $now->modify('+1450 minutes')->format('Y-m-d\TH:i:s\Z'); reason($bad, 'inbound_generated_in_future');
$bad = $wire; $bad['payload']['expiresAt'] = $now->modify('+23 hours')->format('Y-m-d\TH:i:s\Z'); reason($bad, 'inbound_ttl_invalid');
$bad = $wire; $bad['payload']['targets'][1]['supplierLead'] = ['min' => 4, 'max' => 2]; reason($bad, 'supplier_lead_invalid');
$bad = $wire; $bad['payload']['targets'][1]['stockOwnerWooId'] = 11; reason($bad, 'stock_owner_mismatch');
$bad = $wire; $bad['payload']['targets'][1]['batches'][0]['quantity'] = 4; reason($bad, 'owner_pool_batches_mismatch');
$bad = $wire; $bad['payload']['targets'] = array_fill(0, 1002, $wire['payload']['targets'][1]); reason($bad, 'payload_limits_exceeded');
unset($GLOBALS['products'][12]); reason($wire, 'variation_missing');
$GLOBALS['products'][12] = new WC_Product_Variation(12, 20); reason($wire, 'variation_parent_mismatch');
unset($GLOBALS['products'][10]); reason($wire, 'product_missing');
$product = ['schemaVersion' => 1, 'scope' => 'product', 'entityId' => 10, 'revision' => 100, 'payload' => ['wooId' => 10, 'productionMinDays' => 2, 'productionMaxDays' => 1, 'variations' => []]];
reason($product, 'production_range_invalid');
$product['payload']['productionMaxDays'] = 2; reason($product, 'product_missing');
$GLOBALS['products'][10] = new WC_Product(10, 'custom'); reason($product, 'product_type_unsupported');
$GLOBALS['products'][10] = new class(10) extends WC_Product {
    public function get_status(): string { throw new RuntimeException('SECRET raw database failure'); }
};
reason($product, 'schema_invalid');
same((new OverSeek_Delivery_Input_Exception('SECRET'))->reason(), 'schema_invalid');
echo "Typed input reasons: {$checks} cumulative checks passed.\n";

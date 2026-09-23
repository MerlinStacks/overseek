<?php
/** Offline mapping and selection contracts, independent of activation lifecycle. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
require __DIR__ . '/stubs/delivery-storefront.php';
require __DIR__ . '/../includes/class-overseek-delivery-product-service.php';
require __DIR__ . '/../includes/class-overseek-delivery-input-validation.php';

$row = ['methodId' => 'wbs', 'instanceId' => 0, 'enabled' => true, 'fulfilmentType' => 'delivery', 'minTransitDays' => 4, 'maxTransitDays' => 6];
$standard = new WC_Shipping_Rate('wbs:eb6d8ae6_standard', 'Standard', 10, [1 => 1], 'wbs', 0);
$express = new WC_Shipping_Rate('wbs:opaque/express?x=1', 'Express', 20, [1 => 2], 'wbs', 0);
$resolve = [OverSeek_Delivery_Rate_Resolver::class, 'resolve'];
$select = [OverSeek_Delivery_Product_Service::class, 'select_rate'];
$core = new WC_Shipping_Rate('opaque/core-option?x=1', 'Core', 0, [], 'flat_rate', 7);
$core_settings = ['shippingMethods' => [array_replace($row, ['methodId' => 'flat_rate', 'instanceId' => 7])], 'defaultMethod' => ['methodId' => 'flat_rate', 'instanceId' => 7]];
same($core->get_id(), $resolve($core_settings, [$core])[0]['id'], 'core metadata authoritative too');
same($core, $select($core_settings, false, ['rates' => [$core->get_id() => $core]], ''), 'core instance default resolves opaque actual ID');
$settings = ['shippingMethods' => [$row], 'defaultMethod' => null];
same([], $resolve($settings, [$standard]), 'old WBS row is not implicitly certified');
$broad = $row + ['mappingKind' => 'all_provider_rates', 'allRatesConfirmed' => true];
$exact = array_replace($row, ['mappingKind' => 'exact_rate', 'rateId' => $express->get_id(), 'minTransitDays' => 1, 'maxTransitDays' => 2]);
$settings['shippingMethods'] = [$broad, $exact];
$result = $resolve($settings, [$standard, $express, new WC_Shipping_Rate('unknown', '', 0, [], 'unknown', 0)]);
same([4, 1], array_column(array_column($result, 'transit'), 'min'), 'exact overrides broad and unknown does not poison');
$settings['shippingMethods'][1]['enabled'] = false;
same([$standard->get_id()], array_column($resolve($settings, [$standard, $express]), 'id'), 'disabled exact blocks broad fallback');
$settings['shippingMethods'] = [$exact];
same([$express->get_id()], array_column($resolve($settings, [$standard, $express]), 'id'), 'unmapped sibling blank');
$settings['defaultMethod'] = ['methodId' => 'wbs', 'instanceId' => 0, 'mappingKind' => 'exact_rate', 'rateId' => $express->get_id()];
same($express->get_id(), $select($settings, true, null, '')->get_id(), 'unknown address nominated exact timing');
same(null, $select($settings, false, ['rates' => [$standard->get_id() => $standard]], ''), 'known address never invents unavailable default');
$settings['shippingMethods'] = [$broad, $exact];
$package = ['rates' => [$standard->get_id() => $standard, $express->get_id() => $express]];
same($standard, $select($settings, false, $package, $standard->get_id()), 'previous actual option first');
same($express, $select($settings, false, $package, 'stale'), 'exact default second');
$settings['defaultMethod'] = ['methodId' => 'wbs', 'instanceId' => 0, 'mappingKind' => 'all_provider_rates'];
same(null, $select($settings, false, $package, ''), 'ambiguous broad default does not choose third service');
$settings['defaultMethod']['rateId'] = $express->get_id();
same($express, $select($settings, false, $package, ''), 'broad default can nominate actual option');
foreach (['wbs', 'wbsng'] as $provider) {
    $rate = new WC_Shipping_Rate($provider . ':hash_standard', 'Standard', 10, [], $provider, 0);
    $settings = ['shippingMethods' => [array_replace($broad, ['methodId' => $provider])], 'defaultMethod' => null];
    same($rate->get_id(), $resolve($settings, [$rate])[0]['id'], 'global metadata instance 0 ' . $provider);
    $before = serialize($rate); $resolve($settings, [$rate]);
    same($before, serialize($rate), 'provider rate is immutable');
}
class SplitWbsngRate extends WC_Shipping_Rate { public function get_meta_data() { return ['wbsng_solution' => 'provider-private-breakdown']; } }
$split = new SplitWbsngRate('wbsng:split', '', 0, [], 'wbsng', 0);
same([], $resolve($settings, [$split]), 'WBSNG multi-shipment rate stays blank');
$settings = ['cutoffTime' => '14:00', 'timezone' => 'Australia/Sydney', 'fallbackSupplierLeadTimeDays' => 30, 'productionWeekdays' => [1,2,3,4,5], 'transitWeekdays' => [1,2,3,4,5], 'closures' => [], 'shippingMethods' => [], 'defaultMethod' => null, 'branding' => ['textColor' => null, 'accentColor' => null, 'backgroundColor' => null, 'fontSize' => 14, 'spacing' => 'compact', 'showIcon' => false]];
$validate = static function ($row, $default = null) use ($settings): bool {
    $settings['shippingMethods'] = [$row + ['zoneId' => 0, 'zoneName' => 'Global', 'title' => 'Standard']]; $settings['defaultMethod'] = $default;
    try { (new OverSeek_Delivery_Input_Validation())->validate(json_encode(['schemaVersion' => 1, 'scope' => 'settings', 'entityId' => 0, 'revision' => 1, 'payload' => ['enabled' => true, 'settings' => $settings]])); return true; }
    catch (InvalidArgumentException $error) { return false; }
};
same(true, $validate($row), 'old WBS settings remain valid but unverified');
same(true, $validate($exact, ['methodId' => 'wbs', 'instanceId' => 0, 'mappingKind' => 'exact_rate', 'rateId' => $exact['rateId']]), 'exact default validator parity');
same(true, $validate($broad, ['methodId' => 'wbs', 'instanceId' => 0, 'mappingKind' => 'all_provider_rates', 'rateId' => $exact['rateId']]), 'broad nominated option validator parity');
same(false, $validate(array_replace($broad, ['allRatesConfirmed' => false])), 'broad policy requires confirmation');
same(false, $validate(array_replace($exact, ['rateId' => 'bad rate'])), 'opaque grammar rejects spaces');
same(false, $validate(array_replace($exact, ['rateId' => str_repeat('a', 201)])), 'opaque grammar bounded');
fwrite(STDOUT, "WBS mapping: {$assertions} assertions passed.\n");

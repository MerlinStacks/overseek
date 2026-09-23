<?php
/** Native WBS 6.18.0 fixture. Run with wp eval-file ONLY in a NEW disposable WP site. */
declare(strict_types=1);
if (!defined('WP_CLI') || !WP_CLI || getenv('OVERSEEK_NATIVE_FIXTURE') !== 'disposable' || wp_get_environment_type() === 'production') {
    throw new RuntimeException('Requires WP CLI, non-production WP_ENVIRONMENT_TYPE and OVERSEEK_NATIVE_FIXTURE=disposable.');
}
if (!class_exists('Wbs\\ShippingMethod') || !class_exists('Aikinomi\\Wbsng\\ShippingMethod') || (string) Wbs\Plugin::instance()->meta->version !== '6.18.0') {
    throw new RuntimeException('Install and activate the public WBS 6.18.0 release first.');
}
if (get_option('overseek_native_wbs_fixture') || get_option('wbs_config') || get_option('wbsng_config') || WC_Shipping_Zones::get_zones()) {
    throw new RuntimeException('Refusing to overwrite shipping configuration. Use a new disposable site.');
}
require_once dirname(__DIR__) . '/includes/class-overseek-delivery-rate-resolver.php';
require_once dirname(__DIR__) . '/includes/class-overseek-delivery-order-snapshot.php';
$legacy = ['enabled' => true, 'rules' => []];
$ng = ['settings' => ['disableSplitShipping' => true], 'methods' => []];
foreach (['Standard' => 10, 'Express' => 20] as $title => $price) {
    // Public GPL 6.18.0 RulesMapper fields, not guessed rule IDs.
    $legacy['rules'][] = ['meta' => ['enabled' => true, 'title' => $title, 'taxable' => true], 'conditions' => ['destination' => ['mode' => 'all']], 'charges' => ['base' => $price, 'weight' => ['cost' => 0, 'step' => 1, 'skip' => 0]]];
    $ng['methods'][] = ['name' => $title, 'settings' => null, 'rules' => [['name' => '', 'locations' => null, 'shclasses' => null, 'weight' => null, 'price' => null, 'action' => null, 'charge' => ['base' => (string) $price, 'rate' => '0', 'step' => '1', 'skip' => '0']]]];
}
update_option('wbs_global_methods', 'both');
(new Wbs\ShippingMethod(0))->config($legacy);
(new Aikinomi\Wbsng\ShippingMethod(0))->updateConfigData($ng);
$zone = new WC_Shipping_Zone();
$zone->set_zone_name('Overseek native WBS fixture AU');
$zone->add_location('AU', 'country');
$zone->save();
$instances = [];
foreach (['wbs', 'wbsng'] as $provider) {
    $id = $zone->add_shipping_method($provider);
    if (!$id) throw new RuntimeException('Unable to create native method');
    $instances[$provider] = $id;
    if ($provider === 'wbs') (new Wbs\ShippingMethod($id))->config($legacy);
    else (new Aikinomi\Wbsng\ShippingMethod($id))->updateConfigData($ng);
}
$product = new WC_Product_Simple();
$product->set_name('Overseek native WBS fixture'); $product->set_status('publish');
$product->set_regular_price('50'); $product->set_weight('1'); $product->set_manage_stock(false); $product->save();
if (!WC()->cart) wc_load_cart();
WC()->customer->set_shipping_country('AU'); WC()->customer->set_shipping_state('NSW'); WC()->customer->set_shipping_postcode('2000');
WC()->cart->empty_cart(); WC()->cart->add_to_cart($product->get_id(), 1); WC()->cart->calculate_totals();
$package = WC()->cart->get_shipping_packages()[0];
$mappings = [];
foreach (['wbs' => Wbs\ShippingMethod::class, 'wbsng' => Aikinomi\Wbsng\ShippingMethod::class] as $provider => $class) {
    foreach ([0, $instances[$provider]] as $instance) {
        $method = new $class($instance);
        $rates = $method->get_rates_for_package($package); // Test-only native calculation, never application discovery.
        if (count($rates) !== 2) throw new RuntimeException('Expected native Standard and Express for ' . $provider);
        foreach ($rates as $rate) {
            if ($rate->get_method_id() !== $provider || $rate->get_instance_id() !== $instance) throw new RuntimeException('Unexpected native metadata');
            $express = $rate->get_label() === 'Express';
            if ((float) $rate->get_cost() !== ($express ? 20.0 : 10.0)) throw new RuntimeException('Unexpected native price');
            $row = ['methodId' => $provider, 'instanceId' => $instance, 'mappingKind' => 'exact_rate', 'rateId' => $rate->get_id(), 'zoneId' => $instance ? $zone->get_id() : 0, 'zoneName' => $instance ? $zone->get_zone_name() : 'Global', 'title' => $rate->get_label(), 'enabled' => true, 'fulfilmentType' => 'delivery', 'minTransitDays' => $express ? 1 : 4, 'maxTransitDays' => $express ? 2 : 6];
            $before = serialize($rate);
            $resolved = OverSeek_Delivery_Rate_Resolver::resolve(['shippingMethods' => [$row], 'defaultMethod' => null], array_values($rates));
            if (count($resolved) !== 1 || $resolved[0]['id'] !== $rate->get_id() || serialize($rate) !== $before) throw new RuntimeException('Native exact mapping failed');
            $mappings[] = $row;
        }
    }
}
update_option('overseek_native_wbs_fixture', ['productId' => $product->get_id(), 'zoneId' => $zone->get_id(), 'instances' => $instances], false);
WP_CLI::line(wp_json_encode(['wbsVersion' => '6.18.0', 'wooVersion' => WC_VERSION, 'phpVersion' => PHP_VERSION, 'productId' => $product->get_id(), 'shippingMethods' => $mappings], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
WP_CLI::success('Native option identities captured. No delivery storefront activation was changed.');

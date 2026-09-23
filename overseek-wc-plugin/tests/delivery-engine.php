<?php
/**
 * Dependency-free engine regression tests, matching the repository's CLI harnesses.
 * Run: php overseek-wc-plugin/tests/delivery-engine.php
 * @package OverSeek
 */
declare(strict_types=1);
define('ABSPATH', __DIR__);
require_once __DIR__ . '/../includes/class-overseek-delivery-engine.php';

// Warnings are failures too: malformed input must not emit notices or output.
set_error_handler(static function (int $severity, string $message, string $file, int $line): void {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

function fixture(): array {
    return json_decode(file_get_contents(__DIR__ . '/delivery-engine-fixture.json'), true, 512, JSON_THROW_ON_ERROR);
}
function same($actual, $expected): void {
    if ($actual !== $expected) {
        throw new RuntimeException('Expected ' . json_encode($expected) . ', got ' . json_encode($actual));
    }
}
function readiness(array $input, string $min, string $max): array {
    $result = OverSeek_Delivery_Engine::calculate($input);
    same($result['status'], 'available');
    same($result['readiness'], ['min' => $min, 'max' => $max]);
    same([$result['methods'][1]['min'], $result['methods'][1]['max']], [$min, $max]);
    return $result;
}
function unavailable($input, string $reason): void {
    same(OverSeek_Delivery_Engine::calculate($input), ['status' => 'unavailable', 'reason' => $reason]);
}
function shortage(): array {
    $input = fixture();
    $input['items'][0]['quantity'] = 5;
    $input['stock_owners']['product:100']['quantity'] = 2;
    return $input;
}
function batch(string $date, int $quantity): array {
    return ['date' => $date, 'quantity' => $quantity, 'eligible' => true];
}

$tests = [];
$tests['before cutoff 0-1 and method endpoints'] = static function (): void {
    $r = readiness(fixture(), '2026-09-21', '2026-09-22');
    same($r['methods'][0], ['id' => 'flat_rate:7', 'type' => 'delivery', 'min' => '2026-09-21', 'max' => '2026-09-23']);
};
$tests['at and after local cutoff roll exactly once'] = static function (): void {
    foreach (['2026-09-21T13:00:00Z', '2026-09-21T14:01:00Z'] as $now) {
        $i = fixture(); $i['now'] = $now;
        $r = readiness($i, '2026-09-22', '2026-09-23');
        same($r['effective_date'], '2026-09-22');
    }
};
$tests['zero and one offsets before and after'] = static function (): void {
    foreach ([0, 1] as $days) {
        foreach ([false, true] as $after) {
            $i = fixture(); $i['items'][0]['production'] = ['min' => $days, 'max' => $days];
            if ($after) { $i['now'] = '2026-09-21T13:00:00Z'; }
            $date = '2026-09-' . (21 + $days + (int) $after);
            readiness($i, $date, $date);
        }
    }
};
$tests['weekend zero normalizes without surcharge'] = static function (): void {
    $i = fixture(); $i['now'] = '2026-09-26T10:00:00Z';
    readiness($i, '2026-09-28', '2026-09-29');
};
$tests['seven day, Saturday only and Sunday only work calendars'] = static function (): void {
    foreach ([[[0,1,2,3,4,5,6], '2026-09-26', '2026-09-27'], [[6], '2026-09-26', '2026-10-03'], [[0], '2026-09-27', '2026-10-04']] as [$days, $min, $max]) {
        $i = fixture(); $i['now'] = '2026-09-26T10:00:00Z'; $i['work_weekdays'] = $days;
        readiness($i, $min, $max);
    }
};
$tests['separate scoped work/transit closures'] = static function (): void {
    $i = fixture();
    $i['closures'] = [['date' => '2026-09-21', 'scope' => 'work'], ['date' => '2026-09-22', 'scope' => 'transit'], ['date' => '2026-09-24', 'scope' => 'both']];
    $r = readiness($i, '2026-09-22', '2026-09-23');
    same([$r['methods'][0]['min'], $r['methods'][0]['max']], ['2026-09-23', '2026-09-25']);
};
$tests['transit zero and one normalize onto Sunday independently; pickup does not'] = static function (): void {
    $i = fixture(); $i['transit_weekdays'] = [0];
    $r = readiness($i, '2026-09-21', '2026-09-22');
    same([$r['methods'][0]['min'], $r['methods'][0]['max']], ['2026-09-27', '2026-10-04']);
};
$tests['DST spring/fall use local dates, not 86400 second days'] = static function (): void {
    foreach ([['2026-03-07T19:00:00Z', '2026-03-08', '2026-03-09'], ['2026-10-31T18:00:00Z', '2026-11-01', '2026-11-02']] as [$now, $min, $max]) {
        $i = fixture(); $i['timezone'] = 'America/New_York'; $i['now'] = $now;
        $i['work_weekdays'] = $i['transit_weekdays'] = [0,1,2,3,4,5,6];
        readiness($i, $min, $max);
    }
};
$tests['UTC instant converted to store next date'] = static function (): void {
    $i = fixture(); $i['timezone'] = 'Pacific/Auckland'; $i['now'] = '2026-09-20T23:00:00Z';
    readiness($i, '2026-09-21', '2026-09-22');
};
$tests['legacy IANA aliases accepted by settings retain calculation parity'] = static function (): void {
    foreach (['US/Pacific', 'Asia/Calcutta', 'Europe/Kiev'] as $zone) {
        $i = fixture(); $i['timezone'] = $zone; $i['now'] = '2026-09-21T10:00:00+00:00';
        same(OverSeek_Delivery_Engine::calculate($i)['status'], 'available');
    }
    $i = fixture(); $i['timezone'] = 'Factory'; unavailable($i, 'invalid_timezone');
};
$tests['leap day and year rollover'] = static function (): void {
    foreach ([['2028-02-28T15:00:00Z', '2028-02-29', '2028-03-01'], ['2026-12-31T15:00:00Z', '2027-01-01', '2027-01-02']] as [$now, $min, $max]) {
        $i = fixture(); $i['now'] = $now; $i['work_weekdays'] = [0,1,2,3,4,5,6];
        readiness($i, $min, $max);
    }
};
$tests['quantity deficit accumulates unsorted eligible batches; ignores invalid rows'] = static function (): void {
    $i = shortage();
    $i['stock_owners']['product:100']['inbound'] = [batch('2026-09-24', 2), batch('2026-09-22', 1), batch('2026-09-20', 100), batch('2026-02-30', 100), ['quantity' => 100], array_merge(batch('2026-09-21', 100), ['eligible' => false]), 'bad', batch('2026-09-21', -5)];
    readiness($i, '2026-09-24', '2026-09-25');
};
$tests['same-day receipt eligible before cutoff and after cutoff rolls only once'] = static function (): void {
    $i = shortage(); $i['stock_owners']['product:100']['inbound'] = [batch('2026-09-21', 3)];
    readiness($i, '2026-09-21', '2026-09-22');
    $i['now'] = '2026-09-21T13:00:00Z';
    readiness($i, '2026-09-22', '2026-09-23');
};
$tests['supplier calendar days include weekend, production follows supply'] = static function (): void {
    $i = shortage(); $i['now'] = '2026-09-25T10:00:00Z';
    $i['stock_owners']['product:100']['supplier_lead'] = ['min' => 2, 'max' => 3];
    readiness($i, '2026-09-28', '2026-09-29');
};
$tests['supplier wait from effective date, no duplicate cutoff'] = static function (): void {
    $i = shortage(); $i['now'] = '2026-09-21T13:00:00Z';
    $i['stock_owners']['product:100']['supplier_lead'] = ['min' => 1, 'max' => 2];
    readiness($i, '2026-09-23', '2026-09-25');
};
$tests['default fallback 30 and configured fallback'] = static function (): void {
    $i = shortage(); readiness($i, '2026-10-21', '2026-10-22');
    $i['fallback_lead'] = ['min' => 0, 'max' => 2]; readiness($i, '2026-09-21', '2026-09-24');
};
$tests['insufficient dated supply floors fallback at latest consumed batch'] = static function (): void {
    $i = shortage(); $i['stock_owners']['product:100']['inbound'] = [batch('2026-09-30', 1)];
    $i['stock_owners']['product:100']['supplier_lead'] = ['min' => 1, 'max' => 2];
    readiness($i, '2026-09-30', '2026-10-01');
};
$tests['dated supply overrides supplier lead without duplicate waiting'] = static function (): void {
    $i = shortage(); $i['stock_owners']['product:100']['inbound'] = [batch('2026-09-22', 3)];
    $i['stock_owners']['product:100']['supplier_lead'] = ['min' => 100, 'max' => 200];
    readiness($i, '2026-09-22', '2026-09-23');
};
$tests['resolved variations share owner quantity, independently resolved production'] = static function (): void {
    $i = fixture(); $i['stock_owners']['product:100']['quantity'] = 1;
    $i['stock_owners']['product:100']['inbound'] = [batch('2026-09-23', 1)];
    $i['items'][] = array_merge($i['items'][0], ['production' => ['min' => 2, 'max' => 3]]);
    readiness($i, '2026-09-25', '2026-09-28');
};
$tests['whole order takes latest min and latest max separately'] = static function (): void {
    $i = fixture(); $i['items'][0]['production'] = ['min' => 0, 'max' => 5];
    $i['items'][] = array_merge($i['items'][0], ['managed_stock' => false, 'production' => ['min' => 2, 'max' => 3]]);
    readiness($i, '2026-09-23', '2026-09-28');
};
$tests['prior demand explicit and negative stock not automatically counted twice'] = static function (): void {
    $i = shortage(); $s = &$i['stock_owners']['product:100']; $s['quantity'] = -2;
    unavailable($i, 'unsupported_negative_stock');
    $s['prior_demand'] = 2; $s['inbound'] = [batch('2026-09-22', 7)];
    readiness($i, '2026-09-22', '2026-09-23');
    $s['prior_demand'] = null; unavailable($i, 'invalid_prior_demand');
    $s['quantity'] = 10; $s['prior_demand'] = 8;
    $s['inbound'] = [batch('2026-09-22', 2), batch('2026-09-24', 1)];
    readiness($i, '2026-09-24', '2026-09-25');
};
$tests['pending and integrity failures suppress shortage, not stocked items'] = static function (): void {
    foreach (['pending', 'integrity_error', 'unsupported', 'stale', 'missing'] as $state) {
        $i = shortage(); $i['stock_owners']['product:100']['projection_status'] = $state;
        unavailable($i, 'projection_' . $state);
        $i['stock_owners']['product:100']['quantity'] = 10;
        readiness($i, '2026-09-21', '2026-09-22');
        $i['context_status'] = $state; unavailable($i, 'context_' . $state);
    }
};
$tests['virtual and nonshipping skip unknown production; physical missing suppresses all'] = static function (): void {
    $i = fixture(); $i['items'][] = ['virtual' => true, 'needs_shipping' => false];
    $i['items'][] = ['virtual' => false, 'needs_shipping' => false];
    readiness($i, '2026-09-21', '2026-09-22');
    $i['items'][] = array_merge($i['items'][0], ['production' => null]); unavailable($i, 'missing_range');
    $i['items'] = [['virtual' => true, 'needs_shipping' => false]]; unavailable($i, 'no_physical_items');
};
$tests['blocked local data never produces a promise'] = static function (): void {
    $i = fixture(); $i['items'][0]['purchasable'] = false; unavailable($i, 'blocked_item');
    $i = fixture(); $i['items'][0]['stock_status'] = 'out_of_stock'; unavailable($i, 'blocked_stock');
    $i = shortage(); $i['stock_owners']['product:100']['backorders_allowed'] = false; unavailable($i, 'backorders_blocked');
    $i = shortage(); $i['stock_owners']['product:100']['stock_status'] = 'out_of_stock'; unavailable($i, 'blocked_stock');
    $i = fixture(); $i['items'][0]['managed_stock'] = false; $i['items'][0]['stock_status'] = 'on_backorder'; unavailable($i, 'unsupported_unmanaged_backorder');
    $i = fixture(); $i['items'][0]['supported'] = false; unavailable($i, 'unsupported_item');
};
$tests['missing owner, no methods, disabled and unmapped methods'] = static function (): void {
    $i = fixture(); $i['stock_owners'] = []; unavailable($i, 'missing_stock_owner');
    $i = fixture(); $i['methods'] = []; unavailable($i, 'no_methods');
    $i = fixture(); $i['enabled'] = false; unavailable($i, 'feature_off');
    $i = fixture(); $i['methods'][0]['eligible'] = false; unavailable($i, 'unavailable_method');
    $i = fixture(); unset($i['methods'][0]['transit']); unavailable($i, 'missing_range');
    $i = fixture(); $i['methods'][] = $i['methods'][0]; unavailable($i, 'invalid_method');
};
$tests['untrusted ranges reject coercion, half ranges and excess'] = static function (): void {
    foreach ([['min' => -1, 'max' => 0], ['min' => 2, 'max' => 1], ['min' => 0, 'max' => 3651], ['min' => '0', 'max' => 1], ['min' => false, 'max' => 1], ['min' => 0.0, 'max' => 1], ['min' => 0]] as $range) {
        $i = fixture(); $i['items'][0]['production'] = $range; unavailable($i, 'invalid_range');
    }
};
$tests['malformed calendar, time and structures fail without notices'] = static function (): void {
    foreach ([null, false, 'bad', 4, new stdClass()] as $bad) { unavailable($bad, 'invalid_input'); }
    foreach ([[], [7], ['1'], [1,1]] as $days) { $i = fixture(); $i['work_weekdays'] = $days; unavailable($i, 'invalid_calendar'); }
    foreach (['2026-02-30T10:00:00Z', 'tomorrow', '2026-09-21T10:00:00', []] as $now) { $i = fixture(); $i['now'] = $now; unavailable($i, 'invalid_now'); }
    $i = fixture(); $i['timezone'] = 'bad'; unavailable($i, 'invalid_timezone');
    $i = fixture(); $i['cutoff'] = '24:00'; unavailable($i, 'invalid_cutoff');
    $i = fixture(); $i['closures'] = [['date' => '2026-02-30', 'scope' => 'both']]; unavailable($i, 'invalid_calendar');
    foreach (['items', 'methods', 'stock_owners', 'closures'] as $key) { $i = fixture(); $i[$key] = false; unavailable($i, 'invalid_input'); }
    foreach ([0, -1, '2', 1.5, 1000001] as $qty) { $i = fixture(); $i['items'][0]['quantity'] = $qty; unavailable($i, 'invalid_quantity'); }
};
$tests['hard collection limits and inbound horizon'] = static function (): void {
    $i = fixture(); $i['items'] = array_fill(0, 201, $i['items'][0]); unavailable($i, 'input_too_large');
    $i = shortage(); $i['stock_owners']['product:100']['inbound'] = array_fill(0, 1001, batch('2026-09-22', 1)); unavailable($i, 'invalid_projection');
    $i = shortage(); $i['stock_owners']['product:100']['inbound'] = [batch('9999-12-31', 5)]; unavailable($i, 'horizon_exceeded');
};
$tests['maximum offset is accepted and calendar scan terminates at horizon'] = static function (): void {
    $calendar = new OverSeek_Delivery_Calendar([0,1,2,3,4,5,6], [], 'work', '2040-01-01');
    same($calendar->advance('2026-09-21', 3650), OverSeek_Delivery_Calendar::add_days('2026-09-21', 3650));
    $calendar = new OverSeek_Delivery_Calendar([0], [], 'work', '2026-09-22');
    try { $calendar->advance('2026-09-21', 0); throw new RuntimeException('Expected bounded failure'); }
    catch (InvalidArgumentException $e) { same($e->getMessage(), 'horizon_exceeded'); }
};
$tests['pickup-only order retains readiness without transit normalization'] = static function (): void {
    $i = fixture(); $i['methods'] = [$i['methods'][1]]; $i['transit_weekdays'] = [0];
    $r = OverSeek_Delivery_Engine::calculate($i);
    same($r['status'], 'available');
    same($r['methods'], [['id' => 'local_pickup:8', 'type' => 'pickup', 'min' => '2026-09-21', 'max' => '2026-09-22']]);
};
$tests['maximum production and transit offsets fit bounded weekly calendars'] = static function (): void {
    $i = fixture(); $i['work_weekdays'] = $i['transit_weekdays'] = [1];
    $i['items'][0]['production'] = $i['methods'][0]['transit'] = ['min' => 3650, 'max' => 3650];
    $r = OverSeek_Delivery_Engine::calculate($i);
    same($r['status'], 'available');
    same($r['readiness']['min'], OverSeek_Delivery_Calendar::add_days('2026-09-21', 3650 * 7));
    same($r['methods'][0]['max'], OverSeek_Delivery_Calendar::add_days('2026-09-21', 3650 * 14));
};
$tests['malformed nested payloads fail closed without runtime errors'] = static function (): void {
    foreach ([null, true, 1, 1.5, 'bad', new stdClass(), []] as $bad) {
        foreach ([['items', 0], ['methods', 0], ['stock_owners', 'product:100']] as [$field, $key]) {
            $i = fixture(); $i[$field][$key] = $bad;
            same(OverSeek_Delivery_Engine::calculate($i)['status'], 'unavailable');
        }
    }
    $i = shortage(); $i['stock_owners']['product:100']['supplier_lead'] = ['min' => 1]; unavailable($i, 'invalid_range');
    $i = fixture(); $i['closures'] = [['date' => '2026-09-21', 'scope' => 'unknown']]; unavailable($i, 'invalid_calendar');
    $i = fixture(); $i['methods'] = array_fill(0, 101, $i['methods'][0]); unavailable($i, 'input_too_large');
    $i = fixture(); $i['closures'] = array_fill(0, 3661, ['date' => '2026-09-21', 'scope' => 'both']); unavailable($i, 'invalid_calendar');
};

$failed = 0;
foreach ($tests as $name => $test) {
    try { $test(); fwrite(STDOUT, "PASS $name\n"); }
    catch (Throwable $error) { ++$failed; fwrite(STDERR, "FAIL $name: {$error->getMessage()}\n"); }
}
fwrite(STDOUT, count($tests) . ' cases, ' . $failed . " failures\n");
exit($failed ? 1 : 0);

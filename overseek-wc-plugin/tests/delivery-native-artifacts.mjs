/** Optional dependency-free Node 22+ verification of native PHP/Woo artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDeliveryEstimateSnapshot, getOrderDeliveryEstimateSnapshot, renderDeliveryEstimateEmailBlock } from '../../packages/overseek-core/src/deliveryEstimateSnapshot.ts';

const directory = process.argv[2];
assert.ok(directory, 'Usage: node --experimental-strip-types delivery-native-artifacts.mjs <artifact-directory>');
const results = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'));
const snapshots = fs.readFileSync(path.join(directory, 'native-snapshots.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(snapshots.length, 80, 'All forty classic/Blocks capture runs must export both snapshots');
for (const { snapshot } of snapshots) {
    assert.deepEqual(parseDeliveryEstimateSnapshot(snapshot), snapshot);
    const order = { meta_data: [{ key: '_overseek_delivery_estimate_v1', value: snapshot }] };
    assert.deepEqual(getOrderDeliveryEstimateSnapshot(order), snapshot);
    assert.ok(renderDeliveryEstimateEmailBlock(order).length > 0);
}
const shared = JSON.parse(fs.readFileSync(new URL('../../packages/overseek-core/test-fixtures/delivery-estimate-snapshot-v1.json', import.meta.url), 'utf8'));
for (const row of shared.cases) assert.equal(parseDeliveryEstimateSnapshot(row.snapshot) !== null, row.valid, row.name);
console.log(`Shared core: ${snapshots.length} native snapshots parsed, metadata round-tripped, email rendered; ${shared.cases.length} shared fixtures passed; Node ${process.version}`);

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const mode of ['classic', 'blocks']) {
    const log = fs.readFileSync(path.join(directory, `render-${mode}.log`), 'utf8');
    for (const line of log.split('\n').filter(line => line.startsWith('METRIC '))) {
        const metric = JSON.parse(line.slice(7));
        if (!metric.samples) { console.log(JSON.stringify(metric)); continue; }
        console.log(JSON.stringify({ mode, callbacks: metric.callbacks,
            queries: metric.samples.map(row => row.queries),
            adapterProductReads: metric.samples.map(row => row.adapter_product_reads),
            medianMilliseconds: median(metric.samples.map(row => row.milliseconds)),
            minMilliseconds: Math.min(...metric.samples.map(row => row.milliseconds)),
            maxMilliseconds: Math.max(...metric.samples.map(row => row.milliseconds)) }));
    }
}
assert.deepEqual(results.failures, [], 'Native aggregate failures must also be resolved');
assert.deepEqual(results.cleanupErrors, [], 'Native fixture cleanup must succeed');

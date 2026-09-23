const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/cjs');
const acceptance = require('../test-fixtures/delivery-estimate-snapshot-v1.json');
test('shared acceptance base', () => assert.deepEqual(core.parseDeliveryEstimateSnapshot(acceptance.base), acceptance.base));
for (const fixture of acceptance.cases) test(`shared acceptance: ${fixture.name}`, () => {
    for (const value of [fixture.snapshot, JSON.stringify(fixture.snapshot)]) {
        assert.deepEqual(core.parseDeliveryEstimateSnapshot(value), fixture.valid ? fixture.snapshot : null);
    }
    const utf16 = /title-unicode-(\d+)-utf16/.exec(fixture.name);
    if (utf16) assert.equal(fixture.snapshot.method.title.length, Number(utf16[1]));
    if (fixture.name === 'encoded-bytes-over-8192') assert.ok(Buffer.byteLength(JSON.stringify(fixture.snapshot), 'utf8') > 8192);
});
const sample = () => ({ version: 1, capturedAt: '2026-09-22T10:00:00.000Z', timezone: 'Australia/Sydney', fulfilmentType: 'delivery', method: { methodId: 'flat_rate', instanceId: 3, rateId: 'flat_rate:3', title: 'Standard' }, dispatch: { min: '2026-09-23', max: '2026-09-24' }, delivery: { min: '2026-09-25', max: '2026-09-28' }, collection: null });
const metadata = value => ({ meta_data: [{ key: '_overseek_delivery_estimate_v1', value }] });
test('root exports accept object and JSON and clone without altering captured labels', () => {
    const s = sample();
    assert.deepEqual(core.parseDeliveryEstimateSnapshot(s), s);
    assert.deepEqual(core.parseDeliveryEstimateSnapshot(JSON.stringify(s)), s);
    assert.notEqual(core.parseDeliveryEstimateSnapshot(s), s);
});
for (const [name, change] of Object.entries({
    extra: s => { s.stock = 1; }, undefinedExtra: s => { s.stock = undefined; }, missing: s => { delete s.collection; }, version: s => { s.version = 2; },
    impossible: s => { s.delivery.min = '2026-02-30'; }, reversed: s => { s.delivery.max = '2026-09-24'; },
    earlyStart: s => { s.delivery.min = '2026-09-22'; }, earlyEnd: s => { s.delivery = { min: '2026-09-23', max: '2026-09-23' }; },
    mixed: s => { s.collection = s.delivery; }, absentBranch: s => { s.delivery = null; },
    branch: s => { s.fulfilmentType = 'pickup'; }, timezone: s => { s.timezone = 'Not/AZone'; }, offset: s => { s.timezone = '+10:00'; },
    invalidCapture: s => { s.capturedAt = '2026-02-30T00:00:00Z'; }, localCapture: s => { s.capturedAt = '2026-09-22T10:00:00'; },
    hour: s => { s.capturedAt = '2026-09-22T24:00:00Z'; }, negative: s => { s.method.instanceId = -1; },
    fraction: s => { s.method.instanceId = 1.2; }, identity: s => { s.method.rateId = 'bad rate'; },
    rateLimit: s => { s.method.rateId = 'x'.repeat(201); }, methodExtra: s => { s.method.price = 10; },
    longTitle: s => { s.method.title = 'x'.repeat(301); }, control: s => { s.method.title = 'hello\nworld'; },
    dateExtra: s => { s.dispatch.time = '12:00'; }, yearZero: s => { s.dispatch.min = '0000-01-01'; }
})) test(`rejects ${name}`, () => { const s = sample(); change(s); assert.equal(core.parseDeliveryEstimateSnapshot(s), null); });
test('8 KiB encoded limit, malformed and circular values fail closed', () => {
    assert.equal(core.parseDeliveryEstimateSnapshot(' '.repeat(8192) + JSON.stringify(sample())), null);
    const s = sample(); s.self = s;
    for (const value of [s, undefined, null, [], '{', 42, true]) assert.equal(core.parseDeliveryEstimateSnapshot(value), null);
});
test('persisted own property is authoritative including undefined and null', () => {
    for (const value of [undefined, null, {}, 'bad']) {
        assert.equal(core.getOrderDeliveryEstimateSnapshot({ ...metadata(sample()), deliveryEstimateSnapshot: value }), null);
    }
    const changed = sample(); changed.delivery.max = '2026-10-01';
    assert.deepEqual(core.getOrderDeliveryEstimateSnapshot({ ...metadata(changed), deliveryEstimateSnapshot: sample() }), sample());
});
test('controlled raw fallback rejects invalid or changed duplicates across wrappers', () => {
    assert.deepEqual(core.getOrderDeliveryEstimateSnapshot({ rawData: metadata(sample()) }), sample());
    const same = metadata(sample()); same.meta_data.push({ ...same.meta_data[0], value: JSON.stringify(sample()) });
    assert.deepEqual(core.getOrderDeliveryEstimateSnapshot(same), sample());
    for (const value of [null, { ...sample(), capturedAt: '2026-09-23T10:00:00Z' }]) {
        assert.equal(core.getOrderDeliveryEstimateSnapshot({ ...same, rawData: metadata(value) }), null);
    }
    assert.equal(core.getOrderDeliveryEstimateSnapshot({ orders: [metadata(sample())] }), null);
});
test('all ten scalar values exist when absent; ranges and branches format consistently', () => {
    const empty = core.getDeliveryEstimateTagValues(null);
    assert.equal(Object.keys(empty).length, 10);
    assert.ok(Object.values(empty).every(v => v === ''));
    const s = sample();
    assert.equal(core.getDeliveryEstimateTagValues(metadata(s))['order.estimatedDelivery'], '25 Sept 2026 – 28 Sept 2026');
    s.fulfilmentType = 'collection'; s.collection = { min: '2026-09-24', max: '2026-09-24' }; s.delivery = null;
    const tags = core.getDeliveryEstimateTagValues(metadata(s));
    assert.equal(tags['order.estimatedDelivery'], '');
    assert.equal(tags['order.estimatedCollection'], '24 Sept 2026');
    assert.equal(tags['order.estimatedFulfilment'], tags['order.estimatedCollection']);
    assert.match(core.renderDeliveryEstimateEmailBlock(metadata(s)), /Estimated collection/);
});
test('safe block options and URI tokens never interpolate arbitrary CSS or HTML', () => {
    const html = core.resolveDeliveryEstimateEmailTokens('{{delivery_estimate heading:%3Cimg%20src=x%20onerror=alert(1)%3E textColor:%23abc%3Bbackground:url(x) mutedColor:%2301234 backgroundColor:%23ffffff accentColor:%23123456 showDispatch:true}}', metadata(sample()));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('url(x)'));
    assert.match(html, /&lt;img/);
    assert.match(html, /color:#0f172a/);
    assert.match(html, /color:#64748b/);
    assert.match(html, /Estimated dispatch/);
    assert.match(html, /solid #123456/);
    assert.equal(core.renderDeliveryEstimateEmailBlock(null, { heading: 'Title' }), '');
    assert.equal(core.resolveDeliveryEstimateEmailTokens('a{{delivery_estimate heading:Title}}b', null), 'ab');
    assert.match(core.resolveDeliveryEstimateEmailTokens('{{delivery_estimate heading:%ZZ}}', metadata(sample())), /Estimated delivery/);
});
test('quoted and unquoted designer fallbacks are HTML escaped, missing tokens blank', () => {
    for (const fallback of ['"<img>"', "'<img>'", '<img>']) {
        assert.equal(core.resolveDeliveryEstimateEmailTokens(`{{ order.estimatedDelivery | fallback: ${fallback} }}`, null), '&lt;img&gt;');
    }
    assert.equal(core.resolveDeliveryEstimateEmailTokens('{{order.estimatedCollection}}', metadata(sample())), '');
    assert.equal(core.resolveDeliveryEstimateEmailTokens('{{other.tag}}', null), '{{other.tag}}');
});
test('heading text cannot smuggle second-pass merge tokens', () => {
    const html = core.renderDeliveryEstimateEmailBlock(metadata(sample()), { heading: '{{order.customerNote}}' });
    assert.ok(!html.includes('{{order.customerNote}}'));
    assert.match(html, /&#123;&#123;order.customerNote&#125;&#125;/);
});
test('email block carries a validated theme font through token rendering', () => {
    const html = core.resolveDeliveryEstimateEmailTokens(`{{delivery_estimate fontFamily:${encodeURIComponent("'Times New Roman', Georgia, serif")}}}`, metadata(sample()));
    assert.match(html, /font-family:&#39;Times New Roman&#39;, Georgia, serif;/);
    for (const fontFamily of ['Arial;color:red', 'url(https://example.test/font)', 'Arial\nserif']) {
        const safe = core.renderDeliveryEstimateEmailBlock(metadata(sample()), { fontFamily });
        assert.match(safe, /font-family:Arial, Helvetica, sans-serif;/);
        assert.ok(!safe.includes(fontFamily));
    }
});

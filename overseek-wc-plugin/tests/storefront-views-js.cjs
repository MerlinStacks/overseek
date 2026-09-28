const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/storefront-views.js'), 'utf8');

function visit(config = {}, documentOverrides = {}, extraWindow = {}) {
    const listeners = {}, calls = [];
    const document = { title: 'Cached product', referrer: 'https://www.google.com/',
        visibilityState: 'visible', readyState: 'complete',
        addEventListener(name, callback) { (listeners[name] ||= []).push(callback); }, ...documentOverrides };
    const window = { overseekViews: { endpoint: '/?wc-ajax=overseek_view', context: '{"product_id":42}', signature: 'public-signature', productId: 42, ...config },
        location: { href: 'https://store.test/product/?utm_source=google#details' },
        crypto: require('node:crypto').webcrypto, ...extraWindow };
    const context = vm.createContext({ window, document, URL, URLSearchParams, fetch(url, options) { calls.push({ url, options }); return Promise.resolve({ ok: true }); } });
    vm.runInContext(code, context);
    return { window, document, calls, context, emit(name) { for (const callback of listeners[name] || []) callback(); } };
}

test('same cached HTML counts separate visits with fresh IDs and actual campaign URL', () => {
    const a = visit(), b = visit();
    for (const v of [a, b]) {
        assert.equal(v.calls.length, 1);
        const { options } = v.calls[0];
        assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
        assert.equal(options.body.get('url'), 'https://store.test/product/?utm_source=google');
        assert.equal(options.body.get('referrer'), 'https://www.google.com/');
        assert.equal(options.body.get('eventId'), v.window.overseekGetViewEventId('product:42'));
        v.emit('visibilitychange'); v.emit('wp_listen_for_consent_change');
        vm.runInContext(code, v.context);
        assert.equal(v.calls.length, 1, 'one event per visit even when scripts/listeners repeat');
    }
    assert.notEqual(a.calls[0].options.body.get('eventId'), b.calls[0].options.body.get('eventId'));
});
test('consent is evaluated per visitor, not copied from cached HTML', () => {
    const v = visit({ requiresConsent: true }, {}, { wp_has_consent: () => false });
    assert.equal(v.calls.length, 0);
    v.window.wp_has_consent = () => true;
    v.emit('wp_listen_for_consent_change');
    assert.equal(v.calls.length, 1);
});
test('prefetched/prerendered documents count only once actually displayed', () => {
    const v = visit({}, { prerendering: true, visibilityState: 'hidden' });
    assert.equal(v.calls.length, 0);
    v.document.prerendering = false; v.emit('prerenderingchange');
    assert.equal(v.calls.length, 0);
    v.document.visibilityState = 'visible'; v.emit('visibilitychange');
    assert.equal(v.calls.length, 1);
});
test('search event shares its browser ID and delayed optimization retains earlier pixel IDs', () => {
    const v = visit({ productId: 0, search: true }, {}, { __overseekViewIds: { search: 'existing-pixel-event-id' } });
    assert.equal(v.calls[0].options.body.get('eventId'), 'existing-pixel-event-id');
});

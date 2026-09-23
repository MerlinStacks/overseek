/* Standalone DOM/fetch harness: node tests/delivery-storefront-js.cjs. No dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/delivery-estimate.js'), 'utf8');

function fixture(count = 1, jquery = true) {
    const listeners = {}, timers = new Map(), calls = [], pending = [];
    let nextTimer = 0, wooEvent;
    const forms = Array.from({ length: count }, (_, index) => {
        const quantity = { value: '1' }, variation = { value: '0' };
        return {
            dataset: { product_id: String(index + 10) }, quantity, variation, inputs: [],
            querySelectorAll() { return this.inputs; },
            querySelector: selector => selector.includes('quantity') ? quantity : variation
        };
    });
    const scopes = forms.map(form => ({ forms: [form], querySelectorAll() { return this.forms; } }));
    const quantity = forms[0]?.quantity, variation = forms[0]?.variation;
    const nodes = Array.from({ length: count }, (_, index) => ({
        dataset: { productId: String(index + 10), requestId: `request-${index}` },
        innerHTML: '', scope: scopes[index], enclosing: null,
        set textContent(value) { this.innerHTML = value; },
        closest(selector) { return selector === 'form.cart' ? this.enclosing : this.scope; }
    }));
    const document = {
        readyState: 'complete', querySelectorAll: selector => selector === 'form.cart' ? forms : nodes,
        addEventListener: (event, callback) => { listeners[event] = callback; }
    };
    const window = {
        overseekDelivery: { url: '/?wc-ajax=overseek_delivery_estimates' }, AbortController,
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        fetch: (url, options) => {
            calls.push({ url, options, items: JSON.parse(options.body).items });
            return new Promise(resolve => pending.push(resolve));
        }
    };
    if (jquery) window.jQuery = () => ({ on: (events, selector, callback) => { wooEvent = callback; } });
    vm.runInNewContext(source, { window, document });
    const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    return {
        nodes, calls, quantity, variation, timers, forms, scopes,
        event: () => listeners.input({ target: { matches: () => true } }),
        woo: () => wooEvent(),
        flush: () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); },
        respond: async (index, html = 'safe') => {
            pending[index]({ ok: true, json: async () => ({ items: calls[index].items.map(item => ({ ...item, html })) }) });
            await tick();
        }
    };
}

(async () => {
    const f = fixture(2);
    assert.equal(f.timers.size, 1, 'initial debounced refresh');
    f.flush();
    assert.equal(f.calls.length, 1, 'all placeholders batched');
    assert.equal(f.calls[0].items.length, 2);
    assert.equal(f.calls[0].options.cache, 'no-store');
    assert.equal(f.calls[0].options.credentials, 'same-origin');
    f.quantity.value = '3'; f.event(); f.event();
    assert.equal(f.timers.size, 1, 'rapid events collapse');
    assert.equal(f.calls[0].options.signal.aborted, true, 'old request aborted immediately');
    await f.respond(0, 'stale');
    assert.equal(f.nodes[0].innerHTML, '', 'stale response ignored during debounce');
    f.flush();
    assert.equal(f.calls[1].items[0].quantity, 3);
    f.variation.value = '11'; f.woo(); f.flush();
    assert.equal(f.calls[2].items[0].variation_id, 11, 'Woo variation event reads selected identity');
    await f.respond(2, 'new'); await f.respond(1, 'old');
    assert.equal(f.nodes[0].innerHTML, 'new', 'out-of-order response cannot overwrite');
    assert.equal(f.timers.size, 0, 'no polling');
    f.variation.value = '0'; f.woo(); f.flush();
    assert.equal(f.calls[3].items[0].variation_id, 0, 'reset drops selected variation');
    f.quantity.value = '1.5'; f.event(); f.flush();
    assert.equal(f.calls[4].items[0].quantity, 0, 'fractional quantity never rounded');
    const many = fixture(41, false);
    many.flush();
    assert.equal(many.calls[0].items.length, 20, 'bounded first chunk without jQuery');
    await many.respond(0); assert.equal(many.calls[1].items.length, 20);
    await many.respond(1); assert.equal(many.calls[2].items.length, 1);
    await many.respond(2);
    assert.equal(many.nodes[40].innerHTML, 'safe', 'all chunks refreshed');
    const empty = fixture(0, false); empty.flush();
    assert.equal(empty.calls.length, 0, 'no empty network request');
    const cards = fixture(3);
    cards.nodes[1].dataset.productId = '10'; cards.forms[1].dataset.product_id = '10';
    cards.forms[0].quantity.value = '2'; cards.forms[0].variation.value = '101';
    cards.forms[1].quantity.value = '7'; cards.forms[1].variation.value = '102';
    cards.nodes[2].scope = cards.scopes[0]; // Explicit product 12 shortcode in product 10's card.
    cards.forms[2].quantity.value = '4'; cards.forms[2].variation.value = '121';
    cards.flush();
    assert.deepEqual(cards.calls[0].items.map(row => [row.quantity, row.variation_id]),
        [[2, 101], [7, 102], [4, 121]], 'duplicate cards retain local forms; explicit ID uses only matching form');
    cards.nodes[2].dataset.productId = '99'; cards.event(); cards.flush();
    assert.deepEqual([cards.calls[1].items[2].quantity, cards.calls[1].items[2].variation_id], [1, 0],
        'unrelated shortcode never borrows surrounding form quantity/variation');
    cards.nodes[2].dataset.productId = '10'; cards.nodes[2].scope = null; cards.event(); cards.flush();
    assert.deepEqual([cards.calls[2].items[2].quantity, cards.calls[2].items[2].variation_id], [1, 0],
        'outside placement does not guess between duplicate same-product forms');
    cards.nodes[1].enclosing = cards.forms[1]; cards.nodes[1].scope = cards.scopes[0];
    cards.event(); cards.flush();
    assert.equal(cards.calls[3].items[1].variation_id, 102, 'enclosing matching form wins');
    cards.forms[1].inputs = [{ value: '999' }]; cards.event(); cards.flush();
    assert.equal(cards.calls[4].items[1].variation_id, 0, 'conflicting form identities fail closed');
    cards.forms[1].inputs = []; cards.nodes[2].scope = cards.scopes[0];
    cards.scopes[0].forms = [cards.forms[0], cards.forms[1]]; cards.event(); cards.flush();
    assert.equal(cards.calls[5].items[2].variation_id, 0, 'duplicate local forms are ambiguous too');
    cards.nodes[2].dataset.productId = '12'; cards.nodes[2].enclosing = cards.forms[0];
    cards.event(); cards.flush();
    assert.equal(cards.calls[6].items[2].variation_id, 0, 'unrelated enclosing form never wins by DOM proximity');
    const outside = fixture(1, false);
    outside.nodes[0].scope = null; outside.forms[0].quantity.value = '6';
    outside.forms[0].dataset = {}; outside.forms[0].inputs = [{ value: '10' }];
    outside.flush();
    assert.equal(outside.calls[0].items[0].quantity, 6, 'outside shortcode binds unique native add-to-cart identity');
    outside.forms[0].inputs = []; outside.event(); outside.flush();
    assert.equal(outside.calls[1].items[0].quantity, 1, 'unidentified page form not borrowed');
    console.log('Delivery storefront JS: batching, debounce, quantity, variation, abort/race, identity scopes and no-polling checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

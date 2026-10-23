const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeInvoiceEntities, stringifyInvoiceValue } = require('../dist/cjs');

test('unknown entities matching inherited object properties remain unchanged', () => {
    for (const value of ['&constructor;', '&toString;', '&valueOf;', '&hasOwnProperty;', '&unknown;']) {
        assert.equal(decodeInvoiceEntities(value), value);
        assert.equal(stringifyInvoiceValue(value), value);
    }
});

test('supported named and numeric entities still decode in invoice values', () => {
    assert.equal(decodeInvoiceEntities('Caf&eacute; &amp; &#169; &#x1F381;'), 'Café & © 🎁');
    assert.equal(stringifyInvoiceValue('Caf&eacute; &amp; &#169;'), 'Café & ©');
});

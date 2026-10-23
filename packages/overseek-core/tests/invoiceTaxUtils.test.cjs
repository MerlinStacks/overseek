const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldDisplayInvoicePricesIncludingTax, getInvoiceLineDisplayTotal } = require('../dist/cjs');

test('explicit tax display flag overrides how prices were entered', () => {
    for (const flag of ['display_prices_including_tax', 'displayPricesIncludingTax']) {
        const inclusive = shouldDisplayInvoicePricesIncludingTax({ [flag]: false, prices_include_tax: true });
        assert.equal(inclusive, false);
        assert.equal(getInvoiceLineDisplayTotal({ total: '100', total_tax: '10' }, inclusive), 100);
        assert.equal(shouldDisplayInvoicePricesIncludingTax({ [flag]: true, prices_include_tax: false }), true);
    }
});

test('cart tax display takes precedence over shop display and stored price mode', () => {
    for (const field of ['tax_display_cart', 'taxDisplayCart']) {
        assert.equal(shouldDisplayInvoicePricesIncludingTax({ [field]: 'excl', tax_display_shop: 'incl', prices_include_tax: true }), false);
        assert.equal(shouldDisplayInvoicePricesIncludingTax({ [field]: 'incl', tax_display_shop: 'excl', prices_include_tax: false }), true);
    }
});

test('shop display takes precedence over stored price mode', () => {
    for (const field of ['tax_display_shop', 'taxDisplayShop']) {
        assert.equal(shouldDisplayInvoicePricesIncludingTax({ [field]: 'excl', prices_include_tax: true }), false);
        assert.equal(shouldDisplayInvoicePricesIncludingTax({ [field]: 'incl', prices_include_tax: false }), true);
    }
});

test('missing or unrecognised display settings fall back to stored price mode', () => {
    assert.equal(shouldDisplayInvoicePricesIncludingTax(null), false);
    assert.equal(shouldDisplayInvoicePricesIncludingTax({}), false);
    assert.equal(shouldDisplayInvoicePricesIncludingTax({ pricesIncludeTax: true }), true);
    assert.equal(shouldDisplayInvoicePricesIncludingTax({ tax_display_cart: '', prices_include_tax: true }), true);
});

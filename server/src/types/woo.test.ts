import { describe, expect, it } from 'vitest';
import { asWooCustomerRawData, asWooOrderRawData, asWooProductRawData, asWooReviewRawData } from './woo';
const fields = (keys: string[]) => Object.fromEntries(keys.map(key => [key, '']));
const address = { first_name: '', last_name: '' };
const dates = fields(['date_created', 'date_created_gmt', 'date_modified', 'date_modified_gmt']);
const order = () => ({ id: 1, ...dates, ...fields(['status', 'currency', 'discount_total', 'discount_tax', 'shipping_total', 'shipping_tax', 'cart_tax', 'total', 'total_tax', 'number']), customer_id: 0, billing: address, shipping: address, line_items: [], extension_data: { preserved: true } });
const product = () => ({ id: 1, ...dates, ...fields(['name', 'slug', 'type', 'sku', 'price', 'regular_price']), status: 'publish', stock_quantity: null, stock_status: 'instock', categories: [], images: [] });
const customer = () => ({ id: 1, ...dates, ...fields(['email', 'first_name', 'last_name']), billing: address, shipping: address });
const review = () => ({ id: 1, product_id: 2, date_created: '', date_created_gmt: '', status: 'approved', reviewer: '', reviewer_email: '', review: '', rating: 5, verified: true });
describe('WooCommerce full-data guards', () => {
    it('accepts complete required shapes without stripping extension data', () => {
        const data = order(); expect(asWooOrderRawData(data)).toBe(data);
        expect(asWooProductRawData(product())).not.toBeNull(); expect(asWooCustomerRawData(customer())).not.toBeNull(); expect(asWooReviewRawData(review())).not.toBeNull();
    });
    it('does not assert full response types from identifying fields alone', () => {
        expect(asWooOrderRawData({ id: 1, total: '5', billing: true })).toBeNull();
        expect(asWooProductRawData({ id: 1, name: 'Product' })).toBeNull();
        expect(asWooCustomerRawData({ id: 1, email: 'a@b.test' })).toBeNull();
        expect(asWooReviewRawData({ id: 1, product_id: 2 })).toBeNull();
    });
    it('checks nested fields and known optional values', () => {
        expect(asWooOrderRawData({ ...order(), line_items: [{ id: 1 }] })).toBeNull();
        expect(asWooOrderRawData({ ...order(), billing: { first_name: 42, last_name: '' } })).toBeNull();
        expect(asWooProductRawData({ ...product(), manage_stock: 'yes' })).toBeNull();
        expect(asWooCustomerRawData({ ...customer(), is_paying_customer: 'yes' })).toBeNull();
        expect(asWooReviewRawData({ ...review(), reviewer_avatar_urls: { thumbnail: 42 } })).toBeNull();
    });
    it.each([null, [], 'text', 1, { id: NaN }])('rejects malformed values: %j', data => {
        for (const guard of [asWooOrderRawData, asWooProductRawData, asWooCustomerRawData, asWooReviewRawData]) expect(guard(data)).toBeNull();
    });
});

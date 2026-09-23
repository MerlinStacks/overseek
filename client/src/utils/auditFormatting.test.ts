import { describe, expect, it } from 'vitest';
import { auditActionText, auditChangeText, auditFieldLabel, auditValueText } from './auditFormatting';

describe('plain-language audit formatting', () => {
    it('labels both WooCommerce and editor field names', () => {
        expect(auditChangeText('stockStatus', 'instock')).toBe('Stock availability: In stock.');
        expect(auditChangeText('stock_status', 'outofstock')).toBe('Stock availability: Out of stock.');
        expect(auditFieldLabel('customField_name')).toBe('Custom field name');
    });

    it('uses previous values only when recorded, including zero and false', () => {
        expect(auditChangeText('stock_quantity', 9, { stockQuantity: 12 })).toBe('Stock quantity changed from 12 to 9.');
        expect(auditChangeText('stock_quantity', 3, { stock_quantity: 0 })).toBe('Stock quantity changed from 0 to 3.');
        expect(auditChangeText('manageStock', true, { manage_stock: false })).toBe('Stock tracking changed from No to Yes.');
        expect(auditChangeText('regular_price', '19.95')).toBe('Regular price: 19.95.');
    });

    it('summarizes rich content without displaying HTML or internal metadata', () => {
        expect(auditChangeText('description', '<p>New description</p>')).toBe('Description updated.');
        expect(auditChangeText('short_description', '[updated]')).toBe('Short description updated.');
        expect(auditChangeText('description', '')).toBe('Description cleared.');
        expect(auditChangeText('meta_data', [{ key: '_internal', value: 'code' }])).toBe('Additional information updated.');
    });

    it('formats categories and nested changes without JSON syntax', () => {
        expect(auditValueText('categories', [{ id: 8 }, { id: 9, name: 'Gifts' }])).toBe('Category #8; Gifts');
        expect(auditValueText('components', [{ childWooId: 42, requiredQty: 2, childStock: 10, buildableUnits: 5 }]))
            .toBe('Component product ID: 42, Quantity required: 2, Component stock: 10, Units that can be built: 5');
        expect(auditValueText('dimensions', { length: '5', width: '3' })).toBe('Length: 5, Width: 3');
    });

    it('preserves identifiers and handles empty values honestly', () => {
        expect(auditValueText('sku', 'MY_Product-123')).toBe('MY_Product-123');
        expect(auditValueText('categories', [])).toBe('None');
        expect(auditValueText('supplierId', null)).toBe('Not set');
        expect(auditValueText('manageStock', false)).toBe('No');
        expect(auditValueText('stock_quantity', 0)).toBe('0');
    });

    it('explains system events and uses correct action wording for shared history', () => {
        expect(auditValueText('trigger', 'BOM_INVENTORY_SYNC')).toBe('Stock recalculated from component availability');
        expect(auditActionText('UPDATE', 'PRODUCT')).toBe('Updated this product');
        expect(auditActionText('BATCH_UPDATE', 'PRODUCT')).toBe('Updated this product');
        expect(auditActionText('CREATE', 'ORDER')).toBe('Created this order');
        expect(auditActionText('UNKNOWN', 'ORDER')).toBe('Recorded activity for this order');
    });
});

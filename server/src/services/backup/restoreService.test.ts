import { describe, expect, it } from 'vitest';
import { getUnsupportedRestoreTables } from './restoreService';
import type { AccountBackup } from './types';

function createBackup(data: AccountBackup['data']): AccountBackup {
    return {
        exportedAt: new Date(0).toISOString(),
        version: '1',
        account: {},
        data,
    };
}

describe('getUnsupportedRestoreTables', () => {
    it('blocks product and customer sections that cannot be safely restored', () => {
        const backup = createBackup({
            products: [{ id: 'product-1' }],
            customers: [{ id: 'customer-1' }],
            cannedResponses: [{ id: 'response-1' }],
        });

        expect(getUnsupportedRestoreTables(backup)).toEqual(['products', 'customers']);
    });

    it('allows supported sections and empty unsupported sections', () => {
        const backup = createBackup({
            products: [],
            customers: [],
            cannedResponses: [{ id: 'response-1' }],
        });

        expect(getUnsupportedRestoreTables(backup)).toEqual([]);
    });
});

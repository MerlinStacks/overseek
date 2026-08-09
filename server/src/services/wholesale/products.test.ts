import { describe, expect, it } from 'vitest';
import { WholesaleProductService } from './products';

describe('wholesale pricing audit snapshots', () => {
    it('records complete pricing fields and only a hash of notes', () => {
        const audit = WholesaleProductService.auditSnapshot({
            priceTaxBasis: 'EXCLUSIVE', personalisationTypes: ['UV', 'ENGRAVE'], notesDocument: 'Confidential note body',
            priceTiers: [{ minimumQuantity: 10, unitPrice: { toString: () => '8.2500' }, isPoa: false, leadTimeDays: 5, sortOrder: 0 }, { minimumQuantity: 100, unitPrice: null, isPoa: true, leadTimeDays: null, sortOrder: 1 }],
        }, 3);
        expect(audit).toMatchObject({
            priceTaxBasis: 'EXCLUSIVE', personalisationTypes: ['ENGRAVE', 'UV'],
            priceTiers: [
                { minimumQuantity: 10, unitPrice: '8.2500', isPoa: false, leadTimeDays: 5, sortOrder: 0 },
                { minimumQuantity: 100, unitPrice: null, isPoa: true, leadTimeDays: null, sortOrder: 1 },
            ],
            baseTurnaroundDays: 3,
        });
        expect(audit.notesHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(audit)).not.toContain('Confidential note body');
    });
});

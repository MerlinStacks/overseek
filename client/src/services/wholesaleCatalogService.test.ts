import { describe, expect, it, vi } from 'vitest';
import { createWholesaleCatalogService, type WholesaleApiClient } from './wholesaleCatalogService';

describe('wholesale catalog client service', () => {
    it('uses dedicated history, notification, and password rotation endpoints', async () => {
        const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as WholesaleApiClient;
        const service = createWholesaleCatalogService(api);
        await service.getProductHistory('product-1', 2, 5);
        await service.setShareNotificationsMuted('share-1', true);
        await service.rotateSharePassword('share-1');

        expect(api.get).toHaveBeenCalledWith('/api/wholesale-catalog/products/product-1/history?page=2&limit=5');
        expect(api.patch).toHaveBeenCalledWith('/api/wholesale-catalog/shares/share-1/notifications', { muted: true });
        expect(api.post).toHaveBeenCalledWith('/api/wholesale-catalog/shares/share-1/rotate-password', {});
    });

    it('serializes base turnaround and quantity-break lead times', async () => {
        const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as WholesaleApiClient;
        await createWholesaleCatalogService(api).saveProduct('product-1', {
            notesDocument: '', personalisationTypes: [], imageUrl: null, priceTaxBasis: 'EXCLUSIVE',
            priceTiers: [{ minimumQuantity: 10, unitPrice: '5.00', isPoa: false, leadTimeDays: 7 }],
        }, 4);
        expect(api.put).toHaveBeenCalledWith('/api/wholesale-catalog/products/product-1', expect.objectContaining({
            baseTurnaroundDays: 4,
            priceTiers: [{ minimumQuantity: 10, unitPrice: '5.00', isPoa: false, leadTimeDays: 7 }],
        }));
    });
});

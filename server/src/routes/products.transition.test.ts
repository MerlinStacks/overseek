import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { db, woo } = vi.hoisted(() => ({
    db: {
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
        wooProduct: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
        productVariation: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
        bOMItem: { updateMany: vi.fn() }, bOM: { deleteMany: vi.fn() }
    },
    woo: { getProduct: vi.fn(), getProductVariations: vi.fn() }
}));
vi.mock('zod', async () => { const actual = await vi.importActual<any>('zod'); return { ...actual, z: actual.z ?? actual.default }; });
vi.mock('../utils/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (req: any) => { req.accountId = 'a'; } }));
vi.mock('../services/woo', () => ({ WooService: { forAccount: async () => woo } }));
vi.mock('../services/products', () => ({ ProductValidationError: class extends Error {}, ProductsService: { getProductByWooId: vi.fn() } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/redis', () => ({ redisClient: {} }));
vi.mock('../utils/cache', () => ({ invalidateCache: vi.fn(), CacheTTL: {} }));
vi.mock('../services/SeoScoringService', () => ({ SeoScoringService: { calculateScore: () => ({ score: 0, tests: [] }) } }));
vi.mock('../services/MerchantCenterService', () => ({ MerchantCenterService: { validateCompliance: () => ({ score: 0, issues: [] }) } }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: { indexProduct: vi.fn(), deleteProduct: vi.fn() } }));
vi.mock('../services/search-console/SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('../services/AuditService', () => ({ AuditService: {} }));
vi.mock('../services/wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));
vi.mock('../services/WebhookDeliveryService', () => ({ WebhookDeliveryService: {} }));
vi.mock('../services/CampaignTrackingService', () => ({ campaignTrackingService: {} }));
vi.mock('../services/EmailListService', () => ({ emailListService: {} }));
vi.mock('../services/ContactMaterialization', () => ({ materializeContact: vi.fn() }));
vi.mock('../services/ContactProjection', () => ({ queueContactProjection: vi.fn() }));
vi.mock('../services/events', () => ({ EventBus: { emit: vi.fn() }, EVENTS: {} }));

import routes from './products';
import { processWebhookPayload } from './webhook';
import { IndexingService } from '../services/search/IndexingService';
import { ProductsService } from '../services/products';
import { reconcileWholesaleProductsBestEffort } from '../services/wholesale/reconciliation';

describe('Woo product transition entry paths', () => {
    let app: ReturnType<typeof Fastify>;
    const payload = { id: 10, name: 'Converted', type: 'simple', manage_stock: true, stock_quantity: 7, variations: [11] };
    beforeEach(async () => {
        vi.resetAllMocks();
        db.$transaction.mockImplementation(async work => work(db));
        db.$queryRaw.mockResolvedValue([]);
        db.productVariation.findMany.mockResolvedValue([]);
        db.productVariation.updateMany.mockResolvedValue({ count: 0 });
        db.wooProduct.updateMany.mockResolvedValue({ count: 1 });
        db.bOMItem.updateMany.mockResolvedValue({ count: 0 });
        db.wooProduct.upsert.mockResolvedValue({ id: 'p', wooId: 10 });
        db.wooProduct.findUnique.mockResolvedValue({ id: 'p', wooId: 10, rawData: { type: 'variable' } });
        db.wooProduct.deleteMany.mockResolvedValue({ count: 1 });
        woo.getProduct.mockResolvedValue(payload);
        woo.getProductVariations.mockResolvedValue([{ id: 11 }]);
        vi.mocked(ProductsService.getProductByWooId).mockResolvedValue({ id: 'p' } as any);
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });

    it.each(['/10/stock', '/10/variants/11/stock'])('blocks stock mutation on trash at %s', async url => {
        db.wooProduct.findUnique.mockResolvedValue({ id: 'p', status: 'trash' });
        expect((await app.inject({ method: 'PUT', url, payload: { stockQuantity: 5 } })).statusCode).toBe(409);
        expect(db.wooProduct.update).not.toHaveBeenCalled();
    });

    it.each(['webhook', 'force sync'])('%s retains trash even if its reported type is simple', async path => {
        const trash = { ...payload, status: 'trash' };
        if (path === 'webhook') await processWebhookPayload('a', 'product.updated', trash);
        else {
            woo.getProduct.mockResolvedValue(trash);
            const response = await app.inject({ method: 'POST', url: '/10/sync' });
            expect(response.statusCode).toBe(404);
            expect(response.json().error).toContain('preserved');
        }
        expect(db.wooProduct.update).toHaveBeenCalledWith({ where: { id: 'p', accountId: 'a' }, data: { status: 'trash', rawData: { type: 'variable', status: 'trash' } } });
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(db.bOMItem.updateMany).not.toHaveBeenCalled();
        expect(IndexingService.deleteProduct).toHaveBeenCalledWith('a', 10);
        expect(IndexingService.indexProduct).not.toHaveBeenCalled();
    });

    it('force sync preserves history even after a product-specific Woo 404', async () => {
        woo.getProduct.mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } });
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(404);
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(db.bOMItem.updateMany).not.toHaveBeenCalled();
        expect(IndexingService.deleteProduct).not.toHaveBeenCalled();
    });

    it.each(['webhook', 'force sync'])('%s restores by the same account/Woo key without replacing local fields', async path => {
        await processWebhookPayload('a', 'product.updated', { ...payload, status: 'trash' });
        const restored = { ...payload, type: 'variable', status: 'publish' };
        if (path === 'webhook') await processWebhookPayload('a', 'product.updated', restored);
        else {
            woo.getProduct.mockResolvedValue(restored);
            expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(200);
        }
        const write = db.wooProduct.upsert.mock.calls[0][0];
        expect(write.where).toEqual({ accountId_wooId: { accountId: 'a', wooId: 10 } });
        expect(write.update.status).toBe('publish');
        for (const key of ['id', 'cogs', 'miscCosts', 'supplierId', 'binLocation']) expect(write.update).not.toHaveProperty(key);
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(db.bOMItem.updateMany).not.toHaveBeenCalled();
        expect(IndexingService.indexProduct).toHaveBeenCalled();
    });

    it.each(['rest_no_route', 'woocommerce_rest_cannot_view', undefined])('does not delete on unrelated 404 %s', async code => {
        woo.getProduct.mockRejectedValue({ response: { status: 404, data: { code } } });
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(500);
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
        expect(IndexingService.deleteProduct).not.toHaveBeenCalled();
    });

    it.each(['product.deleted', 'product.updated'])('propagates %s search failures for retry', async topic => {
        vi.mocked(IndexingService.deleteProduct).mockRejectedValueOnce(new Error('search unavailable'));
        await expect(processWebhookPayload('a', topic, { ...payload, status: 'trash' })).rejects.toThrow('search unavailable');
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
        await processWebhookPayload('a', topic, { ...payload, status: 'trash' });
        expect(IndexingService.deleteProduct).toHaveBeenCalledTimes(2);
    });

    it('propagates permanent deletion DB failures from webhook', async () => {
        db.bOMItem.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
        await expect(processWebhookPayload('a', 'product.deleted', payload)).rejects.toThrow('database unavailable');
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
    });

    it('force missing reports preservation without invoking destructive search cleanup', async () => {
        woo.getProduct.mockRejectedValue({ response: { status: 404, data: { code: 'woocommerce_rest_product_invalid_id' } } });
        const response = await app.inject({ method: 'POST', url: '/10/sync' });
        expect(response.statusCode).toBe(404);
        expect(response.json().error).toContain('history preserved');
        expect(IndexingService.deleteProduct).not.toHaveBeenCalled();
        expect(db.wooProduct.deleteMany).not.toHaveBeenCalled();
    });

    it('force sync bypasses cache and ignores contradictory variation IDs on simple products', async () => {
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(200);
        expect(woo.getProduct).toHaveBeenCalledWith(10, { bypassCache: true });
        expect(woo.getProductVariations).not.toHaveBeenCalled();
        expect(db.productVariation.upsert).not.toHaveBeenCalled();
        expect(db.productVariation.findMany).toHaveBeenCalled();
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(db.bOMItem.updateMany).toHaveBeenNthCalledWith(2, {
            where: { bom: { productId: 'p', product: { accountId: 'a' }, variationId: { not: 0 } }, OR: [{ isActive: true }, { deactivatedReason: null }, { deactivatedReason: { not: 'VARIATION_DELETED_IN_WOO' } }] },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }
        });
        expect(db.bOM.deleteMany).not.toHaveBeenCalled();
    });

    it.each(['variable', undefined])('force sync preserves supported variations for type %j', async type => {
        woo.getProduct.mockResolvedValue({ ...payload, type });
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(type ? 200 : 500);
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        if (type) expect(db.productVariation.upsert).toHaveBeenCalled();
        else {
            expect(db.productVariation.upsert).not.toHaveBeenCalled();
            expect(db.wooProduct.upsert).not.toHaveBeenCalled();
        }
    });
    it('force sync fetches an uncached empty variable listing and retires delivery membership', async () => {
        woo.getProduct.mockResolvedValue({ ...payload, type: 'variable', variations: [] });
        woo.getProductVariations.mockResolvedValue([]);
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(200);
        expect(woo.getProductVariations).toHaveBeenCalledExactlyOnceWith(10, { bypassCache: true });
        expect(db.productVariation.updateMany).toHaveBeenCalledWith({ where: {
            productId: 'p', product: { accountId: 'a' }, wooId: { notIn: [] }, deliveryActive: true,
        }, data: { deliveryActive: false } });
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
    });
    it.each(['force sync', 'webhook'])('%s stops after a stale variable observation is rejected', async path => {
        db.wooProduct.findUnique.mockResolvedValue({ id: 'p', deliveryMembershipObservedAt: new Date('2099-01-01') });
        const stale = { ...payload, type: 'variable', variations: [11, 99] };
        woo.getProduct.mockResolvedValue(stale);
        woo.getProductVariations.mockResolvedValue([{ id: 11, stock_quantity: 999 }, { id: 99, stock_quantity: 999 }]);
        if (path === 'force sync') expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(409);
        else await processWebhookPayload('a', 'product.updated', stale);
        expect(db.wooProduct.upsert).not.toHaveBeenCalled();
        expect(db.wooProduct.update).not.toHaveBeenCalled();
        expect(db.productVariation.upsert).not.toHaveBeenCalled();
        expect(db.productVariation.updateMany).not.toHaveBeenCalled();
        expect(IndexingService.indexProduct).not.toHaveBeenCalled();
        expect(reconcileWholesaleProductsBestEffort).not.toHaveBeenCalled();
    });
    it.each(['error', 'quarantine', 'parent-mismatch'])('force sync never replaces membership on %s', async failure => {
        woo.getProduct.mockResolvedValue({ ...payload, type: 'variable', variations: [11, 12] });
        if (failure === 'error') woo.getProductVariations.mockRejectedValue(new Error('incomplete listing'));
        else woo.getProductVariations.mockResolvedValue([{ id: 11, status: 'private', image: null },
            ...(failure === 'quarantine' ? [{ id: 12, image: 'invalid' }] : [])]);
        expect((await app.inject({ method: 'POST', url: '/10/sync' })).statusCode).toBe(500);
        expect(db.productVariation.updateMany).not.toHaveBeenCalled();
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(db.productVariation.upsert).not.toHaveBeenCalled();
        expect(db.wooProduct.upsert).not.toHaveBeenCalled();
    });

    it.each(['product.created', 'product.updated'])('%s cleans stale variations even on repeated simple snapshots', async topic => {
        await processWebhookPayload('a', topic, payload);
        await processWebhookPayload('a', topic, payload);
        expect(db.productVariation.findMany).toHaveBeenCalledTimes(2);
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        expect(db.bOMItem.updateMany).toHaveBeenCalledWith({
            where: { bom: { productId: 'p', product: { accountId: 'a' }, variationId: { not: 0 } }, OR: [{ isActive: true }, { deactivatedReason: null }, { deactivatedReason: { not: 'VARIATION_DELETED_IN_WOO' } }] },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }
        });
        expect(db.bOM.deleteMany).not.toHaveBeenCalled();
        expect(db.wooProduct.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ manageStock: true, stockQuantity: 7 }),
            create: expect.objectContaining({ manageStock: true, stockQuantity: 7 })
        }));
    });

    it.each(['variable', undefined])('webhook retains variations for type %j and persists manageStock=false', async type => {
        await processWebhookPayload('a', 'product.updated', { ...payload, type, manage_stock: false });
        expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        if (type) expect(db.wooProduct.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ manageStock: false }), create: expect.objectContaining({ manageStock: false })
        }));
        else expect(db.wooProduct.upsert).not.toHaveBeenCalled();
    });

    it.each([
        ['webhook', 'variations'], ['force sync', 'variations'],
        ['webhook', 'recipes'], ['force sync', 'recipes']
    ])('%s surfaces %s cleanup failures before external side effects', async (path, stage) => {
        if (stage === 'recipes') {
            db.bOMItem.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('cleanup failed'));
        } else {
            db.productVariation.findMany.mockRejectedValueOnce(new Error('cleanup failed'));
        }
        if (path === 'webhook') {
            await expect(processWebhookPayload('a', 'product.updated', payload)).rejects.toThrow('cleanup failed');
        } else {
            const response = await app.inject({ method: 'POST', url: '/10/sync' });
            expect(response.statusCode).toBe(500);
            expect(response.json().error).toContain('cleanup failed');
        }
        expect(IndexingService.indexProduct).not.toHaveBeenCalled();
        expect(reconcileWholesaleProductsBestEffort).not.toHaveBeenCalled();
        if (stage === 'recipes') {
            expect(db.bOMItem.updateMany).toHaveBeenCalledTimes(2);
            expect(db.productVariation.deleteMany).not.toHaveBeenCalled();
        }
    });
});

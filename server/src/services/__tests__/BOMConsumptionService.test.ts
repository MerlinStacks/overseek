import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    ledgerFindFirst: vi.fn(),
    ledgerFindMany: vi.fn(),
    ledgerUpdate: vi.fn(),
    productFindFirst: vi.fn(),
    productFindUnique: vi.fn(),
    bomFindUnique: vi.fn(),
    bomItemFindMany: vi.fn(),
    wooUpdateProduct: vi.fn(),
    redisGet: vi.fn(),
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        $transaction: mocks.transaction,
        bOMDeductionLedger: {
            findFirst: mocks.ledgerFindFirst,
            findMany: mocks.ledgerFindMany,
            update: mocks.ledgerUpdate,
            updateMany: vi.fn(),
        },
        wooProduct: {
            findFirst: mocks.productFindFirst,
            findUnique: mocks.productFindUnique,
        },
        bOM: { findUnique: mocks.bomFindUnique },
        bOMItem: { findMany: mocks.bomItemFindMany },
    },
}));

vi.mock('../../utils/redis', () => ({
    redisClient: {
        get: mocks.redisGet,
        setex: vi.fn(),
        setnx: vi.fn().mockResolvedValue(1),
        expire: vi.fn(),
        del: vi.fn(),
        keys: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('../woo', () => ({
    WooService: {
        forAccount: vi.fn().mockResolvedValue({
            updateProduct: mocks.wooUpdateProduct,
            updateProductVariation: vi.fn(),
        }),
    },
}));

vi.mock('../../utils/logger', () => ({
    Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BOMConsumptionService } from '../BOMConsumptionService';

describe('BOMConsumptionService durability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.redisGet.mockResolvedValue(null);
        mocks.ledgerFindFirst.mockResolvedValue(null);
        mocks.ledgerFindMany.mockResolvedValue([]);
        mocks.ledgerUpdate.mockResolvedValue({});
        mocks.bomItemFindMany.mockResolvedValue([]);
        mocks.productFindFirst.mockImplementation(async ({ where }: any) => where.wooId === 10
            ? { id: 'parent', wooId: 10, name: 'Parent' }
            : { id: 'component', wooId: 20, name: 'Component' });
        mocks.productFindUnique.mockResolvedValue({ stockQuantity: 8, rawData: {} });
        mocks.bomFindUnique.mockReset();
        mocks.bomFindUnique.mockResolvedValueOnce({
            items: [{
                id: 'bom-item',
                childProductId: 'component',
                childVariationId: null,
                internalProductId: null,
                supplierItemId: null,
                quantity: 2,
                wasteFactor: 0,
                childProduct: { id: 'component', wooId: 20, name: 'Component', stockQuantity: 10, rawData: {} },
                childVariation: null,
                internalProduct: null,
            }],
        }).mockResolvedValue(null);
        mocks.wooUpdateProduct.mockResolvedValue(undefined);
    });

    it('commits the local decrement and EXECUTED ledger row in one transaction', async () => {
        mocks.ledgerFindMany.mockResolvedValue([{
            id: 'ledger-1',
            componentType: 'WooProduct',
            componentId: 'component',
            wooId: 20,
            parentWooId: null,
        }]);
        const tx = {
            $executeRaw: vi.fn(),
            wooProduct: { update: vi.fn().mockResolvedValue({ stockQuantity: 8, rawData: {} }) },
            productVariation: { update: vi.fn() },
            internalProduct: { update: vi.fn() },
            bOMDeductionLedger: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ id: 'ledger-1' })
            },
        };
        mocks.transaction.mockImplementation(async callback => callback(tx));

        await BOMConsumptionService.consumeOrderComponents('account', {
            id: 100,
            status: 'processing',
            line_items: [{ product_id: 10, variation_id: 0, quantity: 1, name: 'Parent' }],
        });

        expect(tx.wooProduct.update).toHaveBeenCalledOnce();
        expect(tx.bOMDeductionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'EXECUTED', previousStock: 10, newStock: 8 }),
        }));
        expect(mocks.bomFindUnique).toHaveBeenCalledTimes(1);
        expect(mocks.ledgerUpdate).toHaveBeenCalledWith({
            where: { id: 'ledger-1' },
            data: { status: 'COMPLETED' },
        });
    });

    it('resumes Woo synchronization without decrementing stock again', async () => {
        mocks.ledgerFindFirst.mockResolvedValue({ id: 'ledger-1', status: 'EXECUTED' });
        mocks.ledgerFindMany.mockResolvedValue([{
            id: 'ledger-1',
            componentType: 'WooProduct',
            componentId: 'component',
            wooId: 20,
            parentWooId: null,
        }]);

        await BOMConsumptionService.consumeOrderComponents('account', {
            id: 100,
            status: 'processing',
            line_items: [{ product_id: 10, variation_id: 0, quantity: 1, name: 'Parent' }],
        });

        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.wooUpdateProduct).toHaveBeenCalledWith(20, { stock_quantity: 8, manage_stock: true });
        expect(mocks.ledgerUpdate).toHaveBeenCalledWith({
            where: { id: 'ledger-1' },
            data: { status: 'COMPLETED' },
        });
    });

    it('ignores supplier-only cost components without failing the order', async () => {
        mocks.bomFindUnique.mockReset();
        mocks.bomFindUnique.mockResolvedValue({
            items: [{
                id: 'supplier-item',
                childProductId: null,
                childVariationId: null,
                internalProductId: null,
                supplierItemId: 'supplier-1',
                quantity: 1,
                wasteFactor: 0,
                childProduct: null,
                childVariation: null,
                internalProduct: null,
            }],
        });

        const result = await BOMConsumptionService.consumeOrderComponents('account', {
            id: 101,
            status: 'processing',
            line_items: [{ product_id: 10, variation_id: 0, quantity: 1, name: 'Parent' }],
        });

        expect(result).toEqual({ consumed: [], errors: [] });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});

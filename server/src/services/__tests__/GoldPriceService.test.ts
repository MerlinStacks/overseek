import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoldPriceService } from '../GoldPriceService';
import { ProductsService } from '../products';
import { prisma } from '../../utils/prisma';

// Mock Prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        wooProduct: {
            findUnique: vi.fn(),
            update: vi.fn(),
        }
    }
}));

// Mock Gold API fetch
global.fetch = vi.fn();

describe('GoldPrice Feature Verification', () => {
    const accountId = 'test-account-id';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should calculate gold prices correctly with margin', async () => {
        // Mock account with margin
        (prisma.account.findUnique as any).mockResolvedValue({
            id: accountId,
            currency: 'USD',
            goldPriceMargin: 10 // 10%
        });

        // Mock Fetch response for Gold API (Fallback structure since no API Key)
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                items: [{ xauPrice: 2000 }] // USD per Ounce
            })
        });

        // 2000 USD/oz ~ 64.30 USD/g
        // Margin 10% => 70.73
        // 18ct = 70.73 * 0.75 = 53.05
        // 9ct = 70.73 * 0.375 = 26.52

        await GoldPriceService.updateAccountPrices(accountId);

        expect(prisma.account.update).toHaveBeenCalledTimes(1);
        const updateArgs = (prisma.account.update as any).mock.calls[0][0];
        const data = updateArgs.data;

        expect(data.goldPrice).toBeCloseTo(64.30, 1); // Base price
        expect(data.goldPrice18ct).toBeCloseTo(53.05, 1);
        expect(data.goldPrice9ct).toBeCloseTo(26.52, 1);
        expect(data.goldPrice18ctWhite).toBeCloseTo(53.05, 1);
    });

    it('should update manual prices correctly', async () => {
        const manualData = {
            goldPrice18ct: 50,
            goldPrice9ct: 25,
            goldPrice18ctWhite: 52,
            goldPrice9ctWhite: 26,
            goldPriceMargin: 15
        };

        await GoldPriceService.updateAccountPrices(accountId, manualData);

        expect(prisma.account.update).toHaveBeenCalledWith({
            where: { id: accountId },
            data: manualData
        });
    });

    it('should save goldPriceType in product update', async () => {
        const wooId = 123;

        (prisma.wooProduct.findUnique as any).mockResolvedValue({
            id: 'product-id',
            accountId,
            wooId,
            rawData: {}
        });

        (prisma.wooProduct.update as any).mockResolvedValue({
            id: 'product-id'
        });

        await ProductsService.updateProduct(accountId, wooId, {
            goldPriceType: '18ct',
            isGoldPriceApplied: true
        });

        expect(prisma.wooProduct.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId_wooId: { accountId, wooId } },
            data: expect.objectContaining({
                goldPriceType: '18ct',
                isGoldPriceApplied: true
            })
        }));
    });
});

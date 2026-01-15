import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketingService } from './MarketingService';

// Define mocks using vi.hoisted to allow access inside vi.mock factory
const mocks = vi.hoisted(() => ({
    prisma: {
        marketingCampaign: {
            findFirst: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
            create: vi.fn(),
            deleteMany: vi.fn(),
            findMany: vi.fn(),
        },
        wooCustomer: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
        emailTemplate: {
            findMany: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            deleteMany: vi.fn(),
        },
        marketingAutomation: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            deleteMany: vi.fn(),
        }
    },
    logger: {
        info: vi.fn(),
        error: vi.fn(),
    },
    segmentService: {
        getCustomerIdsInSegment: vi.fn(),
        getSegmentCount: vi.fn(),
        iterateCustomersInSegment: vi.fn(),
    }
}));

vi.mock('../utils/prisma', () => ({
    prisma: mocks.prisma,
}));

vi.mock('../utils/logger', () => ({
    Logger: mocks.logger,
}));

vi.mock('./SegmentService', () => {
    return {
        SegmentService: vi.fn().mockImplementation(() => mocks.segmentService)
    };
});

describe('MarketingService Optimization', () => {
    let marketingService: MarketingService;

    beforeEach(() => {
        marketingService = new MarketingService();
        vi.clearAllMocks();
    });

    it('should fetch customers in batches using pagination (Optimized)', async () => {
        const accountId = 'acc-1';
        const campaignId = 'camp-1';
        const batchSize = 1000;

        mocks.prisma.marketingCampaign.findFirst.mockResolvedValue({
            id: campaignId,
            accountId,
            segmentId: null
        });

        // Mock count
        mocks.prisma.wooCustomer.count.mockResolvedValue(1005); // slightly more than one batch

        // Mock findMany for batches
        // 1st call: returns 1000
        // 2nd call: returns 5
        // 3rd call: returns 0 (break) or logic handles it

        const batch1 = new Array(1000).fill(0).map((_, i) => ({ id: `1-${i}`, email: `a${i}@b.com` }));
        const batch2 = new Array(5).fill(0).map((_, i) => ({ id: `2-${i}`, email: `c${i}@d.com` }));

        mocks.prisma.wooCustomer.findMany
            .mockResolvedValueOnce(batch1)
            .mockResolvedValueOnce(batch2)
            .mockResolvedValueOnce([]); // 3rd call empty? Or code stops because batch2 < batchSize

        await marketingService.sendCampaign(campaignId, accountId);

        // Verify count is called
        expect(mocks.prisma.wooCustomer.count).toHaveBeenCalledWith({
            where: { accountId, email: { not: '' } }
        });

        // Verify findMany called with take: 1000
        expect(mocks.prisma.wooCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({
            take: batchSize,
            orderBy: { id: 'asc' }
        }));

        // Verify multiple calls
        expect(mocks.prisma.wooCustomer.findMany).toHaveBeenCalledTimes(2); // Should be 2 because 2nd batch < batchSize, so loop breaks.
    });

    it('should use SegmentService iterator when segmentId is present', async () => {
        const accountId = 'acc-1';
        const campaignId = 'camp-2';
        const segmentId = 'seg-1';

        mocks.prisma.marketingCampaign.findFirst.mockResolvedValue({
            id: campaignId,
            accountId,
            segmentId
        });

        mocks.segmentService.getSegmentCount.mockResolvedValue(500);

        // Mock async iterator
        async function* mockIterator() {
            yield [{ id: 's1', email: 's@s.com' }];
        }

        mocks.segmentService.iterateCustomersInSegment.mockReturnValue(mockIterator());

        await marketingService.sendCampaign(campaignId, accountId);

        expect(mocks.segmentService.getSegmentCount).toHaveBeenCalledWith(accountId, segmentId);
        expect(mocks.segmentService.iterateCustomersInSegment).toHaveBeenCalledWith(accountId, segmentId, 1000);
    });
});

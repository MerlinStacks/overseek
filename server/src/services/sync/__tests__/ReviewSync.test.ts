import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewSync } from '../ReviewSync';
import { prisma } from '../../../utils/prisma';
import { recordCriticalEvent } from '../../CriticalEventOutbox';
import { EventBus, EVENTS } from '../../events';
import { IndexingService } from '../../search/IndexingService';

vi.mock('../../../utils/prisma', () => ({ prisma: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    wooCustomer: { findMany: vi.fn() },
    wooReview: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    syncState: { findUnique: vi.fn() }
} }));
vi.mock('../../../utils/logger', () => ({ Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
vi.mock('../SyncCancellationService', () => ({ SyncCancellationService: { assertNotRequested: vi.fn(), isCancellation: vi.fn(), clear: vi.fn() } }));
vi.mock('../../CriticalEventOutbox', () => ({ recordCriticalEvent: vi.fn() }));
vi.mock('../../search/IndexingService', () => ({ IndexingService: { bulkIndexReviews: vi.fn() } }));
vi.mock('../../events', () => ({ EventBus: { emit: vi.fn() }, EVENTS: { REVIEW: { LEFT: 'review:left', SYNCED: 'review:synced' } } }));

describe('targeted review sync', () => {
    const accountId = 'a';
    const review = { id: 42, product_id: 10, reviewer: 'Customer', reviewer_email: 'customer@example.com', review: 'Great', rating: 5, status: 'approved', date_created: new Date().toISOString() };
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(prisma.$transaction).mockImplementation(async (work: any) => work(prisma));
        vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
        vi.mocked(prisma.wooCustomer.findMany).mockResolvedValue([]);
        vi.mocked(prisma.wooReview.findMany).mockResolvedValue([]);
        vi.mocked(prisma.wooReview.findUnique).mockResolvedValue(null);
    });

    it('fetches only the requested review and preserves pending moderation without review-left actions', async () => {
        const woo = { getReview: vi.fn().mockResolvedValue({ data: { ...review, status: 'hold' } }), getReviews: vi.fn() };
        const result = await (new ReviewSync() as any).sync(woo, accountId, false, undefined, undefined, { accountId, wooReviewId: 42 });
        expect(result).toEqual({ itemsProcessed: 1, itemsDeleted: 0 });
        expect(woo.getReview).toHaveBeenCalledExactlyOnceWith(42);
        expect(woo.getReviews).not.toHaveBeenCalled();
        expect(prisma.syncState.findUnique).not.toHaveBeenCalled();
        expect(prisma.wooReview.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ accountId, wooId: 42, status: 'hold' }) }));
        expect(prisma.wooReview.deleteMany).not.toHaveBeenCalled();
        expect(recordCriticalEvent).not.toHaveBeenCalled();
        expect(EventBus.emit).not.toHaveBeenCalledWith(EVENTS.REVIEW.LEFT, expect.anything());
        expect(IndexingService.bulkIndexReviews).toHaveBeenCalled();
    });

    it('emits approval once based on status rechecked under the transaction lock', async () => {
        const woo = { getReview: vi.fn().mockResolvedValue({ data: review }) };
        vi.mocked(prisma.wooReview.findUnique).mockResolvedValueOnce({ id: 'local', status: 'hold' } as any).mockResolvedValueOnce({ id: 'local', status: 'approved' } as any);
        for (let i = 0; i < 2; i++) await (new ReviewSync() as any).sync(woo, accountId, true, undefined, undefined, { accountId, wooReviewId: 42 });
        expect(recordCriticalEvent).toHaveBeenCalledTimes(1);
        expect(vi.mocked(EventBus.emit).mock.calls.filter(([type]) => type === EVENTS.REVIEW.LEFT)).toHaveLength(1);
    });

    it('does not replay review-left actions when a formerly approved review is approved again', async () => {
        vi.mocked(prisma.wooReview.findUnique).mockResolvedValue({ id: 'local', status: 'hold', rawData: { overseekReviewApproved: true } } as any);
        const woo = { getReview: vi.fn().mockResolvedValue({ data: review }) };
        await (new ReviewSync() as any).sync(woo, accountId, true, undefined, undefined, { accountId, wooReviewId: 42 });
        expect(recordCriticalEvent).not.toHaveBeenCalled();
        expect(prisma.wooReview.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ rawData: expect.objectContaining({ overseekReviewApproved: true }) }) }));
    });

    it.each([undefined, { ...review, id: 99 }, { ...review, rating: 6 }])('rejects unavailable/mismatched/invalid review data %j', async data => {
        const woo = { getReview: vi.fn().mockResolvedValue({ data }) };
        await expect((new ReviewSync() as any).sync(woo, accountId, true, undefined, undefined, { accountId, wooReviewId: 42 })).rejects.toThrow();
        expect(prisma.wooReview.upsert).not.toHaveBeenCalled();
    });
});

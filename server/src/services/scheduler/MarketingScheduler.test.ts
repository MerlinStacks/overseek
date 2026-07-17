import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../queue/QueueFactory', () => ({
    QueueFactory: {
        createQueue: vi.fn(() => ({ add: vi.fn() })),
        getQueue: vi.fn()
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

const prismaMocks = vi.hoisted(() => ({
    analyticsSession: {
        findMany: vi.fn(),
        updateMany: vi.fn()
    }
}));

vi.mock('../../utils/prisma', () => ({ prisma: prismaMocks }));

const automationEngineMock = vi.hoisted(() => ({
    processTrigger: vi.fn(),
    runTicker: vi.fn()
}));

vi.mock('../AutomationEngine', () => ({
    automationEngine: {
        ...automationEngineMock
    }
}));

import { MarketingScheduler } from './MarketingScheduler';

describe('MarketingScheduler lifecycle ticker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        MarketingScheduler.stop();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('checks lifecycle automations immediately on startup', () => {
        const lifecycleCheck = vi.spyOn(MarketingScheduler, 'checkLifecycleAutomations')
            .mockResolvedValue(undefined);

        MarketingScheduler.start();

        expect(lifecycleCheck).toHaveBeenCalledTimes(1);
    });

    it('identifies abandoned-cart enrollments by analytics session ID', async () => {
        prismaMocks.analyticsSession.findMany.mockResolvedValue([{
            id: 'session-1',
            accountId: 'account-1',
            email: 'customer@example.com',
            wooCustomerId: null,
            cartValue: 12.41,
            cartItems: [],
            currency: 'GBP',
            currentPath: '/checkout',
            visitorId: 'visitor-1'
        }]);
        automationEngineMock.processTrigger.mockResolvedValue({ enrolled: 1 });
        prismaMocks.analyticsSession.updateMany.mockResolvedValue({ count: 1 });

        await MarketingScheduler.checkAbandonedCarts();

        expect(automationEngineMock.processTrigger).toHaveBeenCalledWith(
            'account-1',
            'ABANDONED_CART',
            expect.objectContaining({
                sessionId: 'session-1',
                visitorId: 'visitor-1'
            })
        );
        expect(prismaMocks.analyticsSession.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['session-1'] } },
            data: { abandonedNotificationSentAt: expect.any(Date) }
        });
    });
});

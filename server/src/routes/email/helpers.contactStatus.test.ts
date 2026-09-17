import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    emailLog: { findFirst: vi.fn(), update: vi.fn() },
    emailSettings: { findUnique: vi.fn() },
    messageTrackingEvent: { findFirst: vi.fn(), create: vi.fn() },
    emailUnsubscribe: { upsert: vi.fn() }
}));
vi.mock('../../utils/prisma', () => ({ prisma: mocks }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));

import { applyDeliveryEventToLog } from './helpers';

describe('delivery suppression classification', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.emailLog.findFirst.mockResolvedValue({ id: 'log-1', to: 'Customer@Example.com' });
        mocks.emailSettings.findUnique.mockResolvedValue({ bounceTrackingEnabled: true });
    });

    it.each([
        ['COMPLAINT', 'Provider feedback 123', 'COMPLAINT', 'COMPLAINED'],
        ['BOUNCE', 'Not a complaint: mailbox unavailable', 'BOUNCED', 'BOUNCED'],
        ['COMPLAINT', undefined, 'COMPLAINT', 'COMPLAINED'],
        ['BOUNCE', undefined, 'BOUNCED', 'BOUNCED']
    ] as const)('classifies %s with reason %s from the event type', async (eventType, reason, contactStatus, logStatus) => {
        await applyDeliveryEventToLog({ logId: 'log-1', accountId: 'account-1', eventType, reason });

        expect(mocks.emailUnsubscribe.upsert).toHaveBeenCalledWith({
            where: { accountId_email: { accountId: 'account-1', email: 'customer@example.com' } },
            create: expect.objectContaining({ accountId: 'account-1', email: 'customer@example.com', scope: 'ALL', contactStatus }),
            update: expect.objectContaining({ scope: 'ALL', contactStatus })
        });
        expect(mocks.emailLog.update).toHaveBeenCalledWith({
            where: { id: 'log-1' },
            data: { status: logStatus, canRetry: false, errorMessage: reason || expect.any(String) }
        });
    });

    it('still updates classification when a delivery tracking event already exists', async () => {
        mocks.messageTrackingEvent.findFirst.mockResolvedValue({ id: 'event-1' });
        await applyDeliveryEventToLog({ logId: 'log-1', accountId: 'account-1', eventType: 'COMPLAINT', reason: 'Feedback loop' });
        expect(mocks.messageTrackingEvent.create).not.toHaveBeenCalled();
        expect(mocks.emailUnsubscribe.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: { scope: 'ALL', reason: 'Feedback loop', contactStatus: 'COMPLAINT' }
        }));
    });

    it('leaves suppression untouched when bounce tracking is disabled', async () => {
        mocks.emailSettings.findUnique.mockResolvedValue({ bounceTrackingEnabled: false });
        await applyDeliveryEventToLog({ logId: 'log-1', accountId: 'account-1', eventType: 'BOUNCE' });
        expect(mocks.emailUnsubscribe.upsert).not.toHaveBeenCalled();
    });
});

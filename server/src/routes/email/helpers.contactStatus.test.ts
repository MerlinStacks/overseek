import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    emailLog: { findFirst: vi.fn(), update: vi.fn() },
    emailSettings: { findUnique: vi.fn() },
    messageTrackingEvent: { findFirst: vi.fn(), create: vi.fn() },
    emailUnsubscribe: { upsert: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: mocks }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));

import { applyDeliveryEventToLog, normalizeDeliveryWebhookEntries } from './helpers';

describe('delivery suppression classification', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.$transaction.mockImplementation(task => task(mocks));
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
    it('records temporary failures without permanent suppression', async () => {
        const outcome = await applyDeliveryEventToLog({ logId: 'log-1', accountId: 'account-1', eventType: 'SOFT_BOUNCE' });
        expect(outcome.deliveryEventApplied).toBe(false); expect(mocks.messageTrackingEvent.create).toHaveBeenCalled(); expect(mocks.emailUnsubscribe.upsert).not.toHaveBeenCalled(); expect(mocks.emailLog.update).not.toHaveBeenCalled();
    });
    it('serializes duplicate checks and never downgrades an existing complaint', async () => {
        mocks.emailUnsubscribe.findUnique.mockResolvedValue({ contactStatus: 'COMPLAINT' });
        await applyDeliveryEventToLog({ logId: 'log-1', accountId: 'account-1', eventType: 'BOUNCE' });
        expect(mocks.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.messageTrackingEvent.findFirst.mock.invocationCallOrder[0]);
        expect(mocks.emailUnsubscribe.upsert.mock.calls[0][0].update).toEqual({ scope: 'ALL' });
    });
    it('does not infer permanent suppression from generic failure events', () => {
        expect(normalizeDeliveryWebhookEntries({ event: 'bounce' })[0].eventType).toBe('DELIVERY_FAILURE');
        expect(normalizeDeliveryWebhookEntries({ event: 'bounce', severity: 'permanent' })[0].eventType).toBe('BOUNCE');
        expect(normalizeDeliveryWebhookEntries({ RecordType: 'Bounce', Type: 'SoftBounce' })[0].eventType).toBe('SOFT_BOUNCE');
        expect(normalizeDeliveryWebhookEntries({ event: 'click', severity: 'permanent' })).toEqual([]);
    });
});

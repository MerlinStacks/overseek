import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        conversionDelivery: {
            findMany: vi.fn(),
            updateMany: vi.fn(),
            update: vi.fn(),
        },
        accountFeature: { findUnique: vi.fn() },
    },
}));
vi.mock('../../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../../utils/prisma';
import { buildRawRequest, retryFailedConversions } from '../ConversionRetryService';

describe('ConversionRetryService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('replays the stored payload and updates the same delivery row', async () => {
        const payload = { data: [{ event_name: 'Purchase', event_id: 'event-1' }] };
        vi.mocked(prisma.conversionDelivery.findMany).mockResolvedValue([{
            id: 'delivery-1', accountId: 'account-1', platform: 'META', payload,
            attempts: 1, status: 'FAILED', lastAttemptAt: null,
        }] as any);
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue({
            isEnabled: true,
            config: { pixelId: 'pixel-1', accessToken: 'secret' },
        } as any);
        vi.mocked(prisma.conversionDelivery.updateMany).mockResolvedValue({ count: 1 } as any);
        vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

        const result = await retryFailedConversions();

        expect(fetch).toHaveBeenCalledWith(
            'https://graph.facebook.com/v25.0/pixel-1/events',
            expect.objectContaining({ body: JSON.stringify(payload) }),
        );
        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'delivery-1' },
            data: expect.objectContaining({ status: 'SENT' }),
        }));
        expect(result).toMatchObject({ totalAttempted: 1, totalRecovered: 1 });
    });

    it('returns a claimed row to FAILED after a network error', async () => {
        vi.mocked(prisma.conversionDelivery.findMany).mockResolvedValue([{
            id: 'delivery-1', accountId: 'account-1', platform: 'SNAPCHAT', payload: { data: [] },
            attempts: 1, status: 'FAILED', lastAttemptAt: null,
        }] as any);
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue({
            isEnabled: true,
            config: { pixelId: 'snap-pixel', accessToken: 'secret' },
        } as any);
        vi.mocked(prisma.conversionDelivery.updateMany).mockResolvedValue({ count: 1 } as any);
        vi.mocked(fetch).mockRejectedValue(new Error('offline'));

        await retryFailedConversions();

        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'delivery-1' },
            data: expect.objectContaining({ status: 'FAILED', lastError: 'offline' }),
        }));
    });

    it('restores the Microsoft wire envelope without mutating the stored payload', () => {
        const payload = { event_id: 'event-1' };
        const request = buildRawRequest('MICROSOFT', { accessToken: 'secret' }, payload);

        expect(request.body).toEqual({ events: [payload] });
        expect(payload).toEqual({ event_id: 'event-1' });
    });

    it('uses the Snapchat v3 pixel endpoint for retries', () => {
        const request = buildRawRequest(
            'SNAPCHAT',
            { pixelId: 'snap-pixel', accessToken: 'snap-token' },
            { data: [] },
        );

        expect(request.url).toBe('https://tr.snapchat.com/v3/snap-pixel/events?access_token=snap-token');
        expect(request.headers.Authorization).toBeUndefined();
    });

    it('returns stale pending rows to failed when configuration is unavailable', async () => {
        vi.mocked(prisma.conversionDelivery.findMany).mockResolvedValue([{
            id: 'delivery-1', accountId: 'account-1', platform: 'META', payload: { data: [] },
            attempts: 2, status: 'PENDING', lastAttemptAt: new Date(0),
        }] as any);
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.conversionDelivery.updateMany).mockResolvedValue({ count: 1 } as any);

        await retryFailedConversions();

        expect(prisma.conversionDelivery.updateMany).toHaveBeenCalledWith({
            where: { id: 'delivery-1', status: 'PENDING' },
            data: { status: 'FAILED', lastError: 'Enabled platform config is unavailable' },
        });
        expect(fetch).not.toHaveBeenCalled();
    });
});

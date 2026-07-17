import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import artworkEventsRoutes, { normalizeArtworkStatus } from './artworkEvents';
import { EventBus, EVENTS } from '../services/events';

vi.mock('../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
    }
}));

describe('artwork events', () => {
    afterEach(() => {
        EventBus.removeAllListeners();
        vi.clearAllMocks();
    });

    it('normalizes artwork status and event-name variants', () => {
        expect(normalizeArtworkStatus('approval-requested')).toBe('approval_requested');
        expect(normalizeArtworkStatus(undefined, 'artwork_approval_requested')).toBe('approval_requested');
        expect(normalizeArtworkStatus('Artwork Changes Requested')).toBe('changes_requested');
        expect(normalizeArtworkStatus('proof_uploaded')).toBe('uploaded');
    });

    it('emits approval requests identified by event name with proof context', async () => {
        const fastify = Fastify();
        await fastify.register(artworkEventsRoutes);
        const listener = vi.fn();
        EventBus.on(EVENTS.ARTWORK.APPROVAL_REQUESTED, listener);

        const response = await fastify.inject({
            method: 'POST',
            url: '/account-1',
            payload: {
                event: {
                    event_name: 'artwork_approval_requested',
                    order_id: 1001,
                    customer_email: 'buyer@example.com',
                    proof_version: 2
                }
            }
        });

        expect(response.statusCode, response.body).toBe(202);
        expect(listener).toHaveBeenCalledWith({
            accountId: 'account-1',
            artwork: expect.objectContaining({
                email: 'buyer@example.com',
                eventStatus: 'approval_requested',
                orderId: 1001,
                proofVersion: 2
            })
        });

        await fastify.close();
    });

    it('accepts the wp-json compatibility URL with account_id in the payload', async () => {
        const fastify = Fastify();
        await fastify.register(artworkEventsRoutes, { prefix: '/wp-json/overseek/v1/artwork-events' });
        const listener = vi.fn();
        EventBus.on(EVENTS.ARTWORK.APPROVED, listener);

        const response = await fastify.inject({
            method: 'POST',
            url: '/wp-json/overseek/v1/artwork-events',
            payload: {
                account_id: 'account-1',
                event: { event_status: 'approved', order_id: 1001 }
            }
        });

        expect(response.statusCode, response.body).toBe(202);
        expect(listener).toHaveBeenCalledWith({
            accountId: 'account-1',
            artwork: expect.objectContaining({ eventStatus: 'approved', orderId: 1001 })
        });

        await fastify.close();
    });
});

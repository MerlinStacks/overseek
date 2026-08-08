import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatService } from '../../services/ChatService';

const mocks = vi.hoisted(() => ({
    accountUserFindUnique: vi.fn(),
    conversationFindFirst: vi.fn(),
    conversationUpdate: vi.fn(),
    messageFindFirst: vi.fn(),
    messageCreate: vi.fn(),
    messageUpdate: vi.fn(),
    messageUpdateMany: vi.fn(),
    socketTo: vi.fn(),
    socketEmit: vi.fn(),
    routeMessage: vi.fn(),
    validateChannel: vi.fn(),
    addMessage: vi.fn()
}));

vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = 'account-1';
    }
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        accountUser: { findUnique: mocks.accountUserFindUnique },
        conversation: { findFirst: mocks.conversationFindFirst, update: mocks.conversationUpdate },
        message: {
            findFirst: mocks.messageFindFirst,
            create: mocks.messageCreate,
            update: mocks.messageUpdate,
            updateMany: mocks.messageUpdateMany
        },
        messageReaction: {}
    }
}));

vi.mock('../../utils/ChannelRouter', () => ({
    routeMessageToChannel: mocks.routeMessage,
    sendEmailWithAttachments: vi.fn(),
    validateMessageChannel: mocks.validateChannel
}));

vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: vi.fn().mockResolvedValue(true) }));

import { createMessageRoutes } from './messages';

describe('authenticated inbox message security', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        mocks.accountUserFindUnique.mockResolvedValue({ role: 'STAFF' });
        mocks.conversationFindFirst.mockResolvedValue({
            id: 'conversation-1',
            accountId: 'account-1',
            channel: 'SMS',
            priority: 'NORMAL',
            assignedTo: null
        });
        mocks.conversationUpdate.mockResolvedValue({});
        mocks.messageFindFirst.mockResolvedValue(null);
        mocks.messageCreate.mockResolvedValue({
            id: 'message-1',
            conversationId: 'conversation-1',
            content: 'hello',
            deliveryStatus: 'PENDING',
            deliveryChannel: 'SMS'
        });
        mocks.messageUpdate.mockImplementation(async ({ data }: any) => ({
            id: 'message-1',
            conversationId: 'conversation-1',
            content: 'hello',
            deliveryChannel: 'SMS',
            ...data
        }));
        mocks.messageUpdateMany.mockResolvedValue({ count: 1 });
        mocks.validateChannel.mockResolvedValue(undefined);
        mocks.routeMessage.mockResolvedValue({ provider: 'TWILIO', providerMessageId: 'SM123' });
        mocks.addMessage.mockResolvedValue({ id: 'message-1', senderType: 'AGENT', deliveryStatus: 'SENT' });
        mocks.socketTo.mockReturnValue({ emit: mocks.socketEmit });
        app = Fastify();
        await app.register(multipart);
        await app.register(createMessageRoutes({
            addMessage: mocks.addMessage,
            io: { to: mocks.socketTo }
        } as unknown as ChatService));
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('rejects CUSTOMER sender spoofing before persistence', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'spoofed', type: 'CUSTOMER' }
        });

        expect(response.statusCode).toBe(400);
        expect(mocks.addMessage).not.toHaveBeenCalled();
    });

    it('denies VIEWER message sends', async () => {
        mocks.accountUserFindUnique.mockResolvedValueOnce({ role: 'VIEWER' });

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'not allowed' }
        });

        expect(response.statusCode).toBe(403);
        expect(mocks.addMessage).not.toHaveBeenCalled();
    });

    it('denies VIEWER reaction mutations', async () => {
        mocks.accountUserFindUnique.mockResolvedValueOnce({ role: 'VIEWER' });

        const response = await app.inject({
            method: 'POST',
            url: '/messages/message-1/reactions',
            payload: { emoji: 'thumbs-up' }
        });

        expect(response.statusCode).toBe(403);
        expect(mocks.messageFindFirst).not.toHaveBeenCalled();
    });

    it('persists FAILED state when external delivery fails', async () => {
        mocks.routeMessage.mockRejectedValueOnce(new Error('Provider unavailable'));

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', type: 'AGENT', channel: 'SMS', clientRequestId: 'request-failed' }
        });

        expect(response.statusCode).toBe(502);
        expect(mocks.validateChannel).toHaveBeenCalled();
        expect(mocks.messageCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'PENDING', deliveryChannel: 'SMS' })
        }));
        expect(mocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'FAILED', deliveryError: 'Delivery to customer failed' })
        }));
        expect(mocks.addMessage).not.toHaveBeenCalled();
        expect(response.json().message.deliveryStatus).toBe('FAILED');
        expect(mocks.socketEmit).not.toHaveBeenCalledWith('message:new', expect.anything());
    });

    it('does not create PENDING state until channel validation succeeds', async () => {
        mocks.validateChannel.mockRejectedValueOnce(new Error('SMS recipient is unavailable'));

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-invalid-channel' }
        });

        expect(response.statusCode).toBe(400);
        expect(mocks.messageCreate).not.toHaveBeenCalled();
        expect(mocks.routeMessage).not.toHaveBeenCalled();
    });

    it('persists internal notes directly as SENT without external delivery', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', isInternal: true }
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.addMessage).toHaveBeenCalledWith(
            'conversation-1', 'hello', 'AGENT', 'user-1', true, 'account-1', undefined
        );
        expect(mocks.routeMessage).not.toHaveBeenCalled();
        expect(mocks.messageCreate).not.toHaveBeenCalled();
    });

    it('requires a clientRequestId for external messages', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'clientRequestId is required for external messages' });
        expect(mocks.validateChannel).not.toHaveBeenCalled();
        expect(mocks.routeMessage).not.toHaveBeenCalled();
        expect(mocks.messageCreate).not.toHaveBeenCalled();
    });

    it('requires a clientRequestId for external messages with attachments', async () => {
        const boundary = 'test-boundary';
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/message-with-attachments',
            headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
            payload: [
                `--${boundary}`,
                'Content-Disposition: form-data; name="content"',
                '',
                'hello',
                `--${boundary}--`,
                ''
            ].join('\r\n')
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'clientRequestId is required for external messages' });
        expect(mocks.routeMessage).not.toHaveBeenCalled();
        expect(mocks.messageCreate).not.toHaveBeenCalled();
    });

    it('finalizes PENDING as SENT only after provider success', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-1' }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            deliveryStatus: 'SENT',
            deliveryProvider: 'TWILIO',
            providerMessageId: 'SM123',
            clientRequestId: 'request-1'
        });
        expect(mocks.messageCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.routeMessage.mock.invocationCallOrder[0]);
        expect(mocks.routeMessage.mock.invocationCallOrder[0]).toBeLessThan(mocks.messageUpdate.mock.invocationCallOrder[0]);
        expect(mocks.addMessage).not.toHaveBeenCalled();
        expect(mocks.socketEmit).toHaveBeenCalledWith('message:new', expect.objectContaining({ deliveryStatus: 'SENT' }));
    });

    it('does not mark delivery FAILED when provider succeeds but message finalization fails', async () => {
        const safelyClaimedMessage = {
            id: 'message-1',
            conversationId: 'conversation-1',
            content: 'hello',
            deliveryStatus: 'PENDING',
            deliveryChannel: 'SMS',
            clientRequestId: 'request-finalization-failed'
        };
        mocks.messageFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(safelyClaimedMessage);
        mocks.messageUpdate.mockRejectedValueOnce(new Error('Database unavailable'));
        mocks.messageUpdateMany.mockRejectedValueOnce(new Error('Database unavailable'));

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-finalization-failed' }
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({
            error: 'Message was delivered but server finalization failed',
            message: { deliveryStatus: 'PENDING' }
        });
        expect(mocks.routeMessage).toHaveBeenCalledTimes(1);
        expect(mocks.messageUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'SENT', providerMessageId: 'SM123' })
        }));
        expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'message-1', deliveryStatus: 'PENDING' },
            data: expect.objectContaining({ deliveryStatus: 'SENT', providerMessageId: 'SM123' })
        }));
        expect(mocks.conversationUpdate).not.toHaveBeenCalled();
        expect(mocks.socketEmit).not.toHaveBeenCalledWith('message:new', expect.anything());

        const retryResponse = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-finalization-failed' }
        });

        expect(retryResponse.statusCode).toBe(409);
        expect(retryResponse.json().message).toMatchObject({ deliveryStatus: 'PENDING' });
        expect(mocks.routeMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps the message SENT when conversation finalization fails after provider success', async () => {
        mocks.conversationUpdate.mockRejectedValueOnce(new Error('Database unavailable'));

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-conversation-failed' }
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({
            error: 'Message was delivered but server finalization failed',
            message: { deliveryStatus: 'SENT', providerMessageId: 'SM123' }
        });
        expect(mocks.routeMessage).toHaveBeenCalledTimes(1);
        expect(mocks.messageUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.messageUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'FAILED' })
        }));
        expect(mocks.socketEmit).not.toHaveBeenCalledWith('message:new', expect.anything());
    });

    it('returns an existing SENT request without duplicate provider delivery', async () => {
        mocks.messageFindFirst.mockResolvedValueOnce({
            id: 'message-existing',
            content: 'hello',
            deliveryStatus: 'SENT',
            deliveryChannel: 'SMS',
            clientRequestId: 'request-1'
        });

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-1' }
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().id).toBe('message-existing');
        expect(mocks.routeMessage).not.toHaveBeenCalled();
        expect(mocks.messageCreate).not.toHaveBeenCalled();
    });

    it('returns 409 for an in-flight request without duplicate provider delivery', async () => {
        mocks.messageFindFirst.mockResolvedValueOnce({
            id: 'message-existing',
            content: 'hello',
            deliveryStatus: 'PENDING',
            deliveryChannel: 'SMS',
            clientRequestId: 'request-1'
        });

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-1' }
        });

        expect(response.statusCode).toBe(409);
        expect(response.json().message.deliveryStatus).toBe('PENDING');
        expect(mocks.routeMessage).not.toHaveBeenCalled();
        expect(mocks.messageCreate).not.toHaveBeenCalled();
    });

    it('retries a FAILED request by claiming it as PENDING', async () => {
        const failed = {
            id: 'message-existing',
            content: 'hello',
            deliveryStatus: 'FAILED',
            deliveryChannel: 'SMS',
            clientRequestId: 'request-1'
        };
        mocks.messageFindFirst.mockResolvedValueOnce(failed).mockResolvedValueOnce({ ...failed, deliveryStatus: 'PENDING' });

        const response = await app.inject({
            method: 'POST',
            url: '/conversation-1/messages',
            payload: { content: 'hello', channel: 'SMS', clientRequestId: 'request-1' }
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'message-existing', deliveryStatus: 'FAILED' },
            data: expect.objectContaining({ deliveryStatus: 'PENDING', deliveryError: null })
        }));
        expect(mocks.routeMessage).toHaveBeenCalledTimes(1);
    });
});

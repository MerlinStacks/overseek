import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    emailAccountFindFirst: vi.fn(),
    sendEmail: vi.fn(),
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        message: { findMany: mocks.findMany, updateMany: mocks.updateMany, update: mocks.update },
        emailAccount: { findFirst: mocks.emailAccountFindFirst },
    },
}));
vi.mock('../../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/getDefaultEmailAccount', () => ({
    getDefaultEmailAccount: vi.fn().mockResolvedValue({ id: 'email-account-1' }),
}));
vi.mock('../EmailService', () => ({
    EmailService: class {
        sendEmail = mocks.sendEmail;
    },
}));

import { MessageScheduler } from './MessageScheduler';

describe('MessageScheduler attachment defense', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.emailAccountFindFirst.mockResolvedValue({ id: 'email-account-1' });
        MessageScheduler.stop();
    });

    it('does not send a persisted traversal path', async () => {
        mocks.findMany.mockResolvedValue([{
            id: 'message-1',
            conversationId: 'conversation-1',
            content: 'Scheduled content',
            attachmentPaths: [{
                storageKey: '../account-b/foreign.pdf',
                filename: 'foreign.pdf',
                contentType: 'application/pdf',
            }],
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        }]);

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'PENDING' }),
        }));
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'message-1' },
            data: {
                scheduledFor: null,
                deliveryStatus: 'FAILED',
                deliveryError: 'Scheduled delivery to customer failed',
            },
        });
    });

    it('delivers a due message only once across concurrent invocations', async () => {
        const message = {
            id: 'message-1',
            conversationId: 'conversation-1',
            content: 'Scheduled content',
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        };
        let claimed = false;
        mocks.findMany.mockResolvedValue([message]);
        mocks.updateMany.mockImplementation(async () => {
            if (claimed) return { count: 0 };
            claimed = true;
            return { count: 1 };
        });
        mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-1' });

        await Promise.all([
            (MessageScheduler as any).processScheduledMessages(),
            (MessageScheduler as any).processScheduledMessages(),
        ]);

        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        expect(mocks.update).toHaveBeenCalledTimes(2);
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'message-1' },
            data: expect.objectContaining({
                deliveryStatus: 'SENT',
                deliveryProvider: 'EMAIL',
                providerMessageId: 'provider-message-1',
                deliveryError: null,
            }),
        });
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'message-1' },
            data: { scheduledFor: null, attachmentPaths: null },
        });
    });

    it('marks unsupported scheduled channels as failed without sending', async () => {
        mocks.findMany.mockResolvedValue([{
            id: 'message-2',
            conversationId: 'conversation-2',
            content: 'Scheduled SMS',
            attachmentPaths: null,
            conversation: {
                channel: 'SMS',
                accountId: 'account-a',
                guestEmail: null,
                title: null,
                wooCustomer: null,
            },
        }]);

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'message-2' },
            data: {
                scheduledFor: null,
                deliveryStatus: 'FAILED',
                deliveryError: 'Scheduled delivery is not supported for this channel',
            },
        });
    });

    it('keeps provider failures explicit and safe', async () => {
        mocks.findMany.mockResolvedValue([{
            id: 'message-3',
            conversationId: 'conversation-3',
            content: 'Scheduled email',
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        }]);
        mocks.sendEmail.mockRejectedValue(new Error('SMTP credentials secret detail'));

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'message-3' },
            data: {
                scheduledFor: null,
                deliveryStatus: 'FAILED',
                deliveryError: 'Scheduled delivery to customer failed',
            },
        });
    });

    it('makes a due internal note visible without external delivery', async () => {
        mocks.findMany.mockResolvedValue([{
            id: 'internal-note-1',
            content: 'Follow up internally',
            isInternal: true,
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        }]);

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'internal-note-1' },
            data: expect.objectContaining({
                scheduledFor: null,
                deliveryStatus: 'SENT',
                deliveryChannel: null,
                deliveryProvider: null,
            }),
        });
    });

    it('reclaims a stale pending delivery lease', async () => {
        const staleAttempt = new Date(Date.now() - 10 * 60 * 1000);
        mocks.findMany.mockResolvedValue([{
            id: 'stale-message-1',
            content: 'Scheduled content',
            isInternal: false,
            deliveryStatus: 'PENDING',
            deliveryAttemptedAt: staleAttempt,
            providerMessageId: null,
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        }]);
        mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-stale' });

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                providerMessageId: null,
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        deliveryStatus: 'PENDING',
                        deliveryAttemptedAt: expect.objectContaining({ lte: expect.any(Date) }),
                    }),
                ]),
            }),
        }));
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not fail or redeliver after provider success when finalization fails', async () => {
        const deliveredMessage = {
            id: 'message-delivered-1',
            content: 'Scheduled content',
            isInternal: false,
            providerMessageId: null,
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        };
        mocks.findMany
            .mockResolvedValueOnce([deliveredMessage])
            .mockResolvedValueOnce([{ ...deliveredMessage, providerMessageId: 'provider-message-delivered' }]);
        mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-delivered' });
        mocks.update
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('database unavailable'));

        await (MessageScheduler as any).processScheduledMessages();
        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'FAILED' }),
        }));
        expect(mocks.updateMany).toHaveBeenLastCalledWith({
            where: {
                id: 'message-delivered-1',
                scheduledFor: { lte: expect.any(Date), not: null },
                providerMessageId: 'provider-message-delivered',
            },
            data: { scheduledFor: null, attachmentPaths: null },
        });
    });

    it('never marks a delivered message failed when acknowledgement persistence fails', async () => {
        mocks.findMany.mockResolvedValue([{
            id: 'message-ack-1',
            content: 'Scheduled content',
            isInternal: false,
            providerMessageId: null,
            attachmentPaths: null,
            conversation: {
                channel: 'EMAIL',
                accountId: 'account-a',
                guestEmail: 'customer@example.com',
                title: 'Subject',
                wooCustomer: null,
            },
        }]);
        mocks.sendEmail.mockResolvedValue({ messageId: 'provider-message-ack' });
        mocks.update.mockRejectedValue(new Error('database unavailable'));
        mocks.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockRejectedValueOnce(new Error('database unavailable'));

        await (MessageScheduler as any).processScheduledMessages();

        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ deliveryStatus: 'FAILED' }),
        }));
    });
});

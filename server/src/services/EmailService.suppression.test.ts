import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmailAccountFindFirst = vi.fn();
const mockEmailSettingsUpsert = vi.fn();
const mockEmailLogCount = vi.fn();
const mockEmailLogCreate = vi.fn();
const mockEmailUnsubscribeFindFirst = vi.fn();

vi.mock('../utils/prisma', () => ({
    prisma: {
        emailAccount: { findFirst: (...args: any[]) => mockEmailAccountFindFirst(...args) },
        emailSettings: { upsert: (...args: any[]) => mockEmailSettingsUpsert(...args) },
        emailLog: {
            count: (...args: any[]) => mockEmailLogCount(...args),
            create: (...args: any[]) => mockEmailLogCreate(...args)
        },
        emailUnsubscribe: {
            findFirst: (...args: any[]) => mockEmailUnsubscribeFindFirst(...args)
        }
    }
}));

vi.mock('../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}));

import { EmailService } from './EmailService';

describe('EmailService unsubscribe suppression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEmailAccountFindFirst.mockResolvedValue({
            id: 'email-account-1',
            accountId: 'account-1',
            email: 'support@example.com',
            name: 'Support',
            smtpEnabled: true,
            relayEndpoint: null,
            relayApiKey: null
        });
        mockEmailSettingsUpsert.mockResolvedValue({
            maxSendPerDay: 6000,
            maxSendPerSecond: 1
        });
        mockEmailLogCount.mockResolvedValue(0);
        mockEmailLogCreate.mockResolvedValue({ id: 'log-1' });
        mockEmailUnsubscribeFindFirst.mockResolvedValue({ id: 'unsubscribe-1', scope: 'ALL' });
    });

    it('sends a direct inbox reply when the recipient opted out of all email', async () => {
        const service = new EmailService();
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-1' });
        vi.spyOn(service, 'createTransporter').mockResolvedValue({
            sendMail,
            close: vi.fn()
        } as any);

        const result = await service.sendEmail(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'Re: Help needed',
            '<p>Here is the answer.</p>',
            undefined,
            {
                source: 'INBOX',
                sourceId: 'conversation-1',
                category: 'TRANSACTIONAL',
                isInboxReply: true
            }
        );

        expect(mockEmailUnsubscribeFindFirst).not.toHaveBeenCalled();
        expect(sendMail).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ messageId: 'message-1' });
    });

    it('continues to suppress non-inbox transactional email for an ALL opt-out', async () => {
        const service = new EmailService();
        const createTransporter = vi.spyOn(service, 'createTransporter');

        const result = await service.sendEmail(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'Order update',
            '<p>Your order was updated.</p>',
            undefined,
            { source: 'AUTOMATION', category: 'TRANSACTIONAL' }
        );

        expect(result).toEqual({ skipped: true, reason: 'unsubscribed_all' });
        expect(createTransporter).not.toHaveBeenCalled();
    });

    it('continues to suppress a newly composed inbox email for an ALL opt-out', async () => {
        const service = new EmailService();
        const createTransporter = vi.spyOn(service, 'createTransporter');

        const result = await service.sendEmail(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'New message',
            '<p>This is not a reply.</p>',
            undefined,
            { source: 'INBOX', category: 'TRANSACTIONAL' }
        );

        expect(result).toEqual({ skipped: true, reason: 'unsubscribed_all' });
        expect(createTransporter).not.toHaveBeenCalled();
    });
});

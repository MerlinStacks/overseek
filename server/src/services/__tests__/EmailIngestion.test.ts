import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmailAccountFindUnique = vi.fn();
const mockEmailAccountFindMany = vi.fn();
const mockMessageFindFirst = vi.fn();
const mockMessageCreate = vi.fn();
const mockWooCustomerFindFirst = vi.fn();
const mockWooCustomerAggregate = vi.fn();
const mockWooCustomerCreate = vi.fn();
const mockConversationFindFirst = vi.fn();
const mockConversationCreate = vi.fn();
const mockConversationUpdate = vi.fn();
const mockEmailUnsubscribeUpsert = vi.fn();
const mockEmailLogFindFirst = vi.fn();
const mockAccountFeatureFindFirst = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('../../utils/prisma', () => ({
    prisma: {
        emailAccount: {
            findUnique: (...args: any[]) => mockEmailAccountFindUnique(...args),
            findMany: (...args: any[]) => mockEmailAccountFindMany(...args)
        },
        message: {
            findFirst: (...args: any[]) => mockMessageFindFirst(...args),
            create: (...args: any[]) => mockMessageCreate(...args)
        },
        wooCustomer: {
            findFirst: (...args: any[]) => mockWooCustomerFindFirst(...args),
            aggregate: (...args: any[]) => mockWooCustomerAggregate(...args),
            create: (...args: any[]) => mockWooCustomerCreate(...args)
        },
        conversation: {
            findFirst: (...args: any[]) => mockConversationFindFirst(...args),
            create: (...args: any[]) => mockConversationCreate(...args),
            update: (...args: any[]) => mockConversationUpdate(...args)
        },
        emailLog: {
            findFirst: (...args: any[]) => mockEmailLogFindFirst(...args)
        },
        emailUnsubscribe: {
            upsert: (...args: any[]) => mockEmailUnsubscribeUpsert(...args)
        },
        accountFeature: {
            findFirst: (...args: any[]) => mockAccountFeatureFindFirst(...args)
        }
    }
}));

vi.mock('../BlockedContactService', () => ({
    BlockedContactService: {
        isBlocked: vi.fn().mockResolvedValue(false)
    }
}));

vi.mock('../events', () => ({
    EventBus: {
        emit: vi.fn()
    },
    EVENTS: {
        EMAIL: {
            RECEIVED: 'email:received'
        }
    }
}));

vi.mock('../EmailService', () => ({
    EmailService: class {
        sendEmail = mockSendEmail;
    }
}));

vi.mock('../../utils/cache', () => ({
    invalidateCache: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}));

import { EmailIngestion } from '../EmailIngestion';
import { BlockedContactService } from '../BlockedContactService';

describe('EmailIngestion', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockEmailAccountFindUnique.mockResolvedValue({ accountId: 'account-1' });
        mockEmailAccountFindMany.mockResolvedValue([{ email: 'support@store.com' }]);
        mockMessageFindFirst.mockResolvedValue(null);
        mockWooCustomerFindFirst.mockResolvedValue(null);
        mockWooCustomerAggregate.mockResolvedValue({ _min: { wooId: -7 } });
        mockWooCustomerCreate.mockResolvedValue({ id: 'cust-1', accountId: 'account-1', email: 'new@example.com', wooId: -8 });
        mockConversationFindFirst.mockResolvedValue(null);
        mockConversationCreate.mockResolvedValue({ id: 'conv-1', accountId: 'account-1', status: 'OPEN' });
        mockConversationUpdate.mockResolvedValue({ id: 'conv-1', status: 'OPEN' });
        mockEmailUnsubscribeUpsert.mockResolvedValue({ id: 'unsub-1' });
        mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
        mockEmailLogFindFirst.mockResolvedValue(null);
        mockAccountFeatureFindFirst.mockResolvedValue(null);
        mockSendEmail.mockResolvedValue(undefined);
        vi.mocked(BlockedContactService.isBlocked).mockResolvedValue(false);
    });

    it('creates customer profile for unknown inbound sender and marks unsubscribed', async () => {
        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'new@example.com',
            fromName: 'Jane Doe',
            subject: 'Need help with my order',
            body: 'Hello team',
            messageId: '<message-1@domain.com>'
        });

        expect(mockWooCustomerCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId: 'account-1',
                    email: 'new@example.com',
                    firstName: 'Jane',
                    lastName: 'Doe',
                    totalSpent: 0,
                    ordersCount: 0,
                    wooId: -8
                })
            })
        );

        expect(mockEmailUnsubscribeUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { accountId_email: { accountId: 'account-1', email: 'new@example.com' } },
                create: expect.objectContaining({
                    accountId: 'account-1',
                    email: 'new@example.com',
                    scope: 'MARKETING'
                }),
                update: { scope: 'MARKETING' }
            })
        );

        expect(mockConversationCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId: 'account-1',
                    wooCustomerId: 'cust-1',
                    guestEmail: undefined,
                    guestName: undefined,
                    channel: 'EMAIL'
                })
            })
        );
    });

    it('reuses existing customer profile and does not create or unsubscribe again', async () => {
        mockWooCustomerFindFirst.mockResolvedValue({
            id: 'cust-existing-1',
            accountId: 'account-1',
            email: 'existing@example.com',
            wooId: 123
        });

        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'existing@example.com',
            fromName: 'Existing Customer',
            subject: 'Question about shipping',
            body: 'Can you help?',
            messageId: '<message-2@domain.com>'
        });

        expect(mockWooCustomerCreate).not.toHaveBeenCalled();
        expect(mockEmailUnsubscribeUpsert).not.toHaveBeenCalled();

        expect(mockConversationCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId: 'account-1',
                    wooCustomerId: 'cust-existing-1',
                    guestEmail: undefined,
                    guestName: undefined,
                    channel: 'EMAIL'
                })
            })
        );
    });

    it('normalizes sender email casing before customer create and unsubscribe', async () => {
        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'New.User@Example.COM',
            fromName: 'New User',
            subject: 'Need support',
            body: 'Hello',
            messageId: '<message-3@domain.com>'
        });

        expect(mockWooCustomerCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    email: 'new.user@example.com'
                })
            })
        );

        expect(mockEmailUnsubscribeUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    accountId_email: {
                        accountId: 'account-1',
                        email: 'new.user@example.com'
                    }
                }
            })
        );
    });

    it('stores blocked inbound email without notifying the inbox', async () => {
        vi.mocked(BlockedContactService.isBlocked).mockResolvedValue(true);

        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'blocked@example.com',
            subject: 'Still emailing',
            body: 'Please reply',
            messageId: '<message-blocked@domain.com>'
        });

        expect(mockConversationUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'conv-1' },
                data: expect.not.objectContaining({ status: 'CLOSED' })
            })
        );
        expect(io.emit).not.toHaveBeenCalled();
    });

    it('sends a transactional offline auto-reply through the receiving SMTP account', async () => {
        mockEmailAccountFindUnique
            .mockResolvedValueOnce({ accountId: 'account-1' })
            .mockResolvedValueOnce({ id: 'email-account-1', smtpEnabled: true });
        mockAccountFeatureFindFirst.mockResolvedValue({
            isEnabled: true,
            config: {
                businessHours: {
                    enabled: true,
                    days: {
                        sun: { isOpen: false },
                        mon: { isOpen: false },
                        tue: { isOpen: false },
                        wed: { isOpen: false },
                        thu: { isOpen: false },
                        fri: { isOpen: false },
                        sat: { isOpen: false }
                    },
                    offlineMessage: 'We are closed right now.'
                }
            }
        });

        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'customer@example.com',
            subject: 'Order help',
            body: 'Hello',
            messageId: '<inbound-1@example.com>'
        });

        expect(mockEmailLogFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                sourceId: 'conv-1',
                source: 'AUTO_REPLY'
            })
        }));
        expect(mockSendEmail).toHaveBeenCalledWith(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'Re: Order help',
            expect.stringContaining('We are closed right now.'),
            undefined,
            expect.objectContaining({
                source: 'AUTO_REPLY',
                sourceId: 'conv-1',
                inReplyTo: '<inbound-1@example.com>',
                references: '<inbound-1@example.com>',
                category: 'TRANSACTIONAL'
            })
        );
        expect(addMessageFn).toHaveBeenCalledWith('conv-1', '[Auto-reply sent] We are closed right now.', 'SYSTEM');
    });

    it('allows offline auto-reply through a receiving HTTP relay account', async () => {
        mockEmailAccountFindUnique
            .mockResolvedValueOnce({ accountId: 'account-1' })
            .mockResolvedValueOnce({
                id: 'email-account-1',
                smtpEnabled: false,
                relayEndpoint: 'https://example.com/wp-json/overseek/v1/email-relay',
                relayApiKey: 'encrypted-key'
            });
        mockAccountFeatureFindFirst.mockResolvedValue({
            isEnabled: true,
            config: {
                businessHours: {
                    enabled: true,
                    days: {
                        sun: { isOpen: false },
                        mon: { isOpen: false },
                        tue: { isOpen: false },
                        wed: { isOpen: false },
                        thu: { isOpen: false },
                        fri: { isOpen: false },
                        sat: { isOpen: false }
                    },
                    offlineMessage: 'Closed.'
                }
            }
        });

        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const ingestion = new EmailIngestion(io, vi.fn().mockResolvedValue(undefined));

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'customer@example.com',
            subject: 'Re: Existing thread',
            body: 'Hello',
            messageId: '<inbound-2@example.com>'
        });

        expect(mockSendEmail).toHaveBeenCalledWith(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'Re: Existing thread',
            expect.any(String),
            undefined,
            expect.objectContaining({ source: 'AUTO_REPLY', category: 'TRANSACTIONAL' })
        );
    });

    it('does not send an offline auto-reply when one was sent recently', async () => {
        mockEmailAccountFindUnique.mockResolvedValue({ accountId: 'account-1' });
        mockEmailLogFindFirst.mockResolvedValue({ id: 'log-1', createdAt: new Date() });
        mockAccountFeatureFindFirst.mockResolvedValue({
            isEnabled: true,
            config: {
                businessHours: {
                    enabled: true,
                    days: {
                        sun: { isOpen: false },
                        mon: { isOpen: false },
                        tue: { isOpen: false },
                        wed: { isOpen: false },
                        thu: { isOpen: false },
                        fri: { isOpen: false },
                        sat: { isOpen: false }
                    },
                    offlineMessage: 'Closed.'
                }
            }
        });

        const io = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn()
        } as any;

        const addMessageFn = vi.fn().mockResolvedValue(undefined);
        const ingestion = new EmailIngestion(io, addMessageFn);

        await ingestion.handleIncomingEmail({
            emailAccountId: 'email-account-1',
            fromEmail: 'customer@example.com',
            subject: 'Order help',
            body: 'Hello',
            messageId: '<inbound-3@example.com>'
        });

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(addMessageFn).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining('[Auto-reply sent]'), 'SYSTEM');
    });
});

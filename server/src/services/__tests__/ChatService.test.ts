/**
 * ChatService Unit Tests
 * 
 * Tests core conversation and messaging functionality.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing ChatService
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockCount = vi.fn();
const mockAccountUserFindUnique = vi.fn();
const mockWooCustomerFindFirst = vi.fn();
const mockConversationUpdateMany = vi.fn();
const mockMessageCreate = vi.fn();
const mockMessageUpdateMany = vi.fn();

vi.mock('../../utils/prisma', () => ({
    prisma: {
        conversation: {
            findMany: (...args: any[]) => mockFindMany(...args),
            findFirst: (...args: any[]) => mockFindFirst(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            create: (...args: any[]) => mockCreate(...args),
            update: (...args: any[]) => mockUpdate(...args),
            updateMany: (...args: any[]) => mockConversationUpdateMany(...args),
            count: (...args: any[]) => mockCount(...args),
        },
        message: {
            findMany: vi.fn().mockResolvedValue([]),
            create: (...args: any[]) => mockMessageCreate(...args),
            updateMany: (...args: any[]) => mockMessageUpdateMany(...args),
        },
        wooCustomer: {
            findFirst: (...args: any[]) => mockWooCustomerFindFirst(...args),
        },
        accountUser: {
            findUnique: (...args: any[]) => mockAccountUserFindUnique(...args),
        },
        account: {
            findFirst: vi.fn().mockResolvedValue({ id: 'account-1', name: 'Test Account' }),
        },
        emailLog: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        accountFeature: {
            findFirst: vi.fn().mockResolvedValue(null),
        },
        $transaction: async (callback: any) => callback({
            conversation: { update: mockUpdate, updateMany: mockConversationUpdateMany },
            message: { create: mockMessageCreate, updateMany: mockMessageUpdateMany }
        })
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn()
    }
}));

vi.mock('../../utils/redis', () => ({
    redisClient: {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    }
}));

// Mock other services
vi.mock('../BlockedContactService', () => ({
    BlockedContactService: {
        isBlocked: vi.fn().mockResolvedValue(false),
        listBlockedEmails: vi.fn().mockResolvedValue([]),
    }
}));

// Mock AutomationEngine with processTrigger method
vi.mock('../AutomationEngine', () => ({
    AutomationEngine: class {
        processTrigger = vi.fn().mockResolvedValue(undefined);
    }
}));

vi.mock('../events', () => ({
    EventBus: {
        emit: vi.fn(),
    },
    EVENTS: {
        CHAT: {
            MESSAGE_RECEIVED: 'chat:message:received',
        }
    }
}));

vi.mock('../TwilioService', () => ({
    TwilioService: {
        sendSms: vi.fn().mockResolvedValue(undefined),
    }
}));

// Mock EmailIngestion
vi.mock('./EmailIngestion', () => ({
    EmailIngestion: class {
        constructor() { }
        handleIncomingEmail = vi.fn().mockResolvedValue({ id: 'conv-1' });
    }
}));

// Import ChatService after mocks
import { ChatService } from '../ChatService';
import { BlockedContactService } from '../BlockedContactService';
import { Server } from 'socket.io';

describe('ChatService', () => {
    const accountId = 'account-123';
    const conversationId = 'conv-abc';
    let chatService: ChatService;
    let mockIo: Server;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock Socket.IO server
        mockIo = {
            to: vi.fn().mockReturnThis(),
            emit: vi.fn(),
        } as unknown as Server;

        chatService = new ChatService(mockIo);
        mockAccountUserFindUnique.mockResolvedValue({ id: 'membership-1' });
        mockWooCustomerFindFirst.mockResolvedValue({ id: 'woo-cust-123' });
        mockMessageCreate.mockResolvedValue({ id: 'msg-1', content: 'Test' });
        mockMessageUpdateMany.mockResolvedValue({ count: 1 });
        mockConversationUpdateMany.mockResolvedValue({ count: 1 });
    });

    describe('listConversations', () => {
        const conversation = (id: string, priority: string, updatedAt: string) => ({
            id,
            accountId,
            priority,
            updatedAt: new Date(updatedAt),
            status: 'OPEN',
            isRead: true,
            messages: [],
            wooCustomer: null,
            assignee: null,
            labels: []
        });

        it('should return conversations for the account', async () => {
            const mockConversations = [
                {
                    id: 'conv-1',
                    accountId,
                    status: 'OPEN',
                    subject: 'Test Subject 1',
                    messages: [],
                    wooCustomer: null,
                    assignee: null,
                    labels: [],
                },
                {
                    id: 'conv-2',
                    accountId,
                    status: 'OPEN',
                    subject: 'Test Subject 2',
                    messages: [],
                    wooCustomer: { email: 'test@example.com' },
                    assignee: null,
                    labels: [],
                }
            ];

            mockFindMany.mockResolvedValueOnce(mockConversations);

            const result = await chatService.listConversations(accountId);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('conv-1');
            expect(mockFindMany).toHaveBeenCalledTimes(1);
            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        accountId
                    })
                })
            );
        });

        it('should filter by status when provided', async () => {
            mockFindMany.mockResolvedValueOnce([]);

            await chatService.listConversations(accountId, 'OPEN');

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        accountId,
                        status: 'OPEN'
                    })
                })
            );
        });

        it('should filter by assignedTo when provided', async () => {
            mockFindMany.mockResolvedValueOnce([]);
            const userId = 'user-123';

            await chatService.listConversations(accountId, undefined, userId);

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        accountId,
                        assignedTo: userId
                    })
                })
            );
        });

        it('should exclude blocked guest and customer emails', async () => {
            vi.mocked(BlockedContactService.listBlockedEmails).mockResolvedValueOnce(['blocked@example.com']);
            mockFindMany.mockResolvedValueOnce([]);

            await chatService.listConversations(accountId);

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [
                            {
                                OR: [
                                    { guestEmail: null },
                                    { guestEmail: { notIn: ['blocked@example.com'], mode: 'insensitive' } }
                                ]
                            },
                            {
                                OR: [
                                    { wooCustomerId: null },
                                    { wooCustomer: { email: { notIn: ['blocked@example.com'], mode: 'insensitive' } } }
                                ]
                            }
                        ]
                    })
                })
            );
        });

        it('paginates persisted priority tiers in one global order without duplicates', async () => {
            const rows = [
                conversation('high-new', 'HIGH', '2026-01-05T00:00:00.000Z'),
                conversation('high-old', 'HIGH', '2026-01-01T00:00:00.000Z'),
                conversation('medium-new', 'MEDIUM', '2026-01-06T00:00:00.000Z'),
                conversation('medium-old', 'MEDIUM', '2026-01-02T00:00:00.000Z'),
                conversation('low-new', 'LOW', '2026-01-07T00:00:00.000Z')
            ];
            mockFindMany.mockImplementation(async ({ where, take }) => {
                const priority = where.priority;
                let matches = rows.filter(row => priority === 'HIGH' || priority === 'LOW'
                    ? row.priority === priority
                    : !['HIGH', 'LOW'].includes(row.priority));
                const boundary = where.OR?.[0]?.updatedAt?.lt as Date | undefined;
                const boundaryId = where.OR?.[1]?.id?.lt as string | undefined;
                if (boundary) {
                    matches = matches.filter(row => row.updatedAt < boundary
                        || (row.updatedAt.getTime() === boundary.getTime() && row.id < boundaryId!));
                }
                return matches
                    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id))
                    .slice(0, take);
            });

            const first = await chatService.listConversations(accountId, undefined, undefined, 3, undefined, { sort: 'priority' });
            const cursor = ChatService.createConversationCursor(first[2], 'priority');
            const second = await chatService.listConversations(accountId, undefined, undefined, 3, cursor, { sort: 'priority' });
            const ids = [...first, ...second].map(row => row.id);

            expect(ids).toEqual(['high-new', 'high-old', 'medium-new', 'medium-old', 'low-new']);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('uses updatedAt and id as the updated-order keyset', async () => {
            const rows = [
                conversation('z', 'MEDIUM', '2026-01-05T00:00:00.000Z'),
                conversation('y', 'HIGH', '2026-01-05T00:00:00.000Z'),
                conversation('x', 'LOW', '2026-01-04T00:00:00.000Z')
            ];
            mockFindMany.mockImplementation(async ({ where, take }) => {
                const boundary = where.OR?.[0]?.updatedAt?.lt as Date | undefined;
                const boundaryId = where.OR?.[1]?.id?.lt as string | undefined;
                return rows
                    .filter(row => !boundary || row.updatedAt < boundary
                        || (row.updatedAt.getTime() === boundary.getTime() && row.id < boundaryId!))
                    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id))
                    .slice(0, take);
            });

            const first = await chatService.listConversations(accountId, undefined, undefined, 2, undefined, { sort: 'updated' });
            const cursor = ChatService.createConversationCursor(first[1], 'updated');
            const second = await chatService.listConversations(accountId, undefined, undefined, 2, cursor, { sort: 'updated' });

            expect([...first, ...second].map(row => row.id)).toEqual(['z', 'y', 'x']);
        });
    });

    describe('createConversation', () => {
        it('rejects a customer from another account before creating', async () => {
            mockWooCustomerFindFirst.mockResolvedValueOnce(null);

            await expect(chatService.createConversation(accountId, 'foreign-customer')).rejects.toThrow(
                'Customer not found in this account'
            );
            expect(mockCreate).not.toHaveBeenCalled();
        });

        it('should return existing open conversation if found', async () => {
            const existingConversation = {
                id: 'existing-conv-1',
                accountId,
                status: 'OPEN',
            };

            mockFindFirst.mockResolvedValueOnce(existingConversation);

            const result = await chatService.createConversation(accountId);

            expect(result).toEqual(existingConversation);
            expect(mockCreate).not.toHaveBeenCalled();
        });

        it('should create a new conversation when no existing found', async () => {
            const mockConversation = {
                id: 'new-conv-1',
                accountId,
                status: 'OPEN',
            };

            mockFindFirst.mockResolvedValueOnce(null);
            mockCreate.mockResolvedValueOnce(mockConversation);

            const result = await chatService.createConversation(accountId);

            expect(result).toEqual(mockConversation);
            expect(mockCreate).toHaveBeenCalledTimes(1);
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        accountId,
                        status: 'OPEN'
                    })
                })
            );
        });
    });

    describe('getConversation', () => {
        it('should return null when conversation not found', async () => {
            mockFindFirst.mockResolvedValueOnce(null);

            const result = await chatService.getConversation(accountId, conversationId);

            expect(result).toBeNull();
        });

        it('should return conversation with enriched messages', async () => {
            const mockConversation = {
                id: conversationId,
                accountId,
                messages: [
                    { id: 'msg-1', senderType: 'AGENT', createdAt: new Date(), content: 'Hello' }
                ],
                wooCustomer: null,
                assignee: null,
                mergedFrom: [],
            };

            mockFindFirst.mockResolvedValueOnce(mockConversation);

            const result = await chatService.getConversation(accountId, conversationId);

            expect(result).not.toBeNull();
            expect(result!.id).toBe(conversationId);
        });

        it('uses the oldest returned message as the cursor across pages without overlap', async () => {
            const messages = [
                { id: 'm5', senderType: 'CUSTOMER', createdAt: new Date('2026-01-05T00:00:00.000Z'), content: '5' },
                { id: 'm4', senderType: 'CUSTOMER', createdAt: new Date('2026-01-04T00:00:00.000Z'), content: '4' },
                { id: 'm3', senderType: 'CUSTOMER', createdAt: new Date('2026-01-04T00:00:00.000Z'), content: '3' },
                { id: 'm2', senderType: 'CUSTOMER', createdAt: new Date('2026-01-02T00:00:00.000Z'), content: '2' },
                { id: 'm1', senderType: 'CUSTOMER', createdAt: new Date('2026-01-01T00:00:00.000Z'), content: '1' }
            ];
            mockFindFirst.mockImplementation(async ({ include }) => {
                const where = include.messages.where;
                const boundary = where?.OR?.[0]?.createdAt?.lt as Date | undefined;
                const boundaryId = where?.OR?.[1]?.id?.lt as string | undefined;
                const page = messages
                    .filter(message => !boundary || message.createdAt < boundary
                        || (message.createdAt.getTime() === boundary.getTime() && message.id < boundaryId!))
                    .slice(0, include.messages.take);
                return { id: conversationId, accountId, messages: page, wooCustomer: null, assignee: null, mergedFrom: [] };
            });

            const first = await chatService.getConversation(accountId, conversationId, { messageLimit: 2 });
            const second = await chatService.getConversation(accountId, conversationId, {
                messageLimit: 2,
                before: first!.nextMessageCursor!
            });
            const third = await chatService.getConversation(accountId, conversationId, {
                messageLimit: 2,
                before: second!.nextMessageCursor!
            });
            const ids = [...first!.messages, ...second!.messages, ...third!.messages].map(message => message.id);

            expect(first!.messages.map(message => message.id)).toEqual(['m4', 'm5']);
            expect(second!.messages.map(message => message.id)).toEqual(['m2', 'm3']);
            expect(third!.messages.map(message => message.id)).toEqual(['m1']);
            expect(first!.hasMoreMessages).toBe(true);
            expect(second!.hasMoreMessages).toBe(true);
            expect(third!.hasMoreMessages).toBe(false);
            expect(ids).toHaveLength(messages.length);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    describe('updateStatus', () => {
        it('should update conversation status', async () => {
            const newStatus = 'CLOSED';
            mockFindFirst.mockResolvedValueOnce({ id: conversationId });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, status: newStatus });

            const result = await chatService.updateStatus(accountId, conversationId, newStatus);

            expect(result.status).toBe(newStatus);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { status: newStatus }
                })
            );
        });
    });

    describe('assignConversation', () => {
        it('should assign conversation to a user', async () => {
            const userId = 'user-456';
            mockFindFirst.mockResolvedValueOnce({ id: conversationId });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, assignedTo: userId });

            const result = await chatService.assignConversation(accountId, conversationId, userId);

            expect(result.assignedTo).toBe(userId);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { assignedTo: userId }
                })
            );
        });

        it('rejects an assignee who is not an account member', async () => {
            mockAccountUserFindUnique.mockResolvedValueOnce(null);

            await expect(chatService.assignConversation(accountId, conversationId, 'foreign-user')).rejects.toThrow(
                'Assignee is not a member of this account'
            );
            expect(mockUpdate).not.toHaveBeenCalled();
        });
    });

    describe('markAsRead', () => {
        it('should mark conversation as read', async () => {
            mockFindFirst.mockResolvedValueOnce({ id: conversationId });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, isRead: true });

            const result = await chatService.markAsRead(accountId, conversationId);

            expect(result.isRead).toBe(true);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { isRead: true }
                })
            );
        });
    });

    describe('getUnreadCount', () => {
        it('should return count of unread conversations', async () => {
            mockCount.mockResolvedValueOnce(5);

            const result = await chatService.getUnreadCount(accountId);

            expect(result).toBe(5);
            expect(mockCount).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        accountId,
                        isRead: false,
                        status: 'OPEN',
                        mergedIntoId: null
                    })
                })
            );
        });
    });

    describe('mergeConversations', () => {
        it('rejects conversations that are already merged', async () => {
            mockFindFirst
                .mockResolvedValueOnce({ id: 'target', mergedIntoId: null, isRead: true })
                .mockResolvedValueOnce({ id: 'source', mergedIntoId: 'other', isRead: false });

            await expect(chatService.mergeConversations(accountId, 'target', 'source')).rejects.toThrow(
                'Already merged conversations cannot be merged again'
            );
            expect(mockMessageUpdateMany).not.toHaveBeenCalled();
        });

        it('atomically redirects merge children and notifies the account room', async () => {
            mockFindFirst
                .mockResolvedValueOnce({ id: 'target', mergedIntoId: null, isRead: true })
                .mockResolvedValueOnce({ id: 'source', mergedIntoId: null, isRead: false });
            mockUpdate.mockResolvedValue({ id: 'updated', accountId });

            await chatService.mergeConversations(accountId, 'target', 'source');

            expect(mockConversationUpdateMany).toHaveBeenNthCalledWith(1, {
                where: { id: 'source', accountId, mergedIntoId: null },
                data: { status: 'CLOSED', mergedIntoId: 'target' }
            });
            expect(mockConversationUpdateMany).toHaveBeenCalledWith({
                where: { accountId, mergedIntoId: 'source' },
                data: { mergedIntoId: 'target' }
            });
            expect(mockConversationUpdateMany).toHaveBeenCalledWith({
                where: { id: 'target', accountId, mergedIntoId: null },
                data: { updatedAt: expect.any(Date), isRead: false }
            });
            expect(mockIo.to).toHaveBeenCalledWith(`account:${accountId}`);
            expect(mockIo.emit).toHaveBeenCalledWith('conversation:merged', { targetId: 'target', sourceId: 'source' });
        });

        it('rolls back A <- B when A becomes merged into C during the transaction', async () => {
            mockFindFirst
                .mockResolvedValueOnce({ id: 'A', mergedIntoId: null, isRead: true })
                .mockResolvedValueOnce({ id: 'B', mergedIntoId: null, isRead: true });
            let targetMergedInto: string | null = null;
            mockConversationUpdateMany.mockImplementation(async ({ where }) => {
                if (where.mergedIntoId === 'B' && !where.id) {
                    targetMergedInto = 'C';
                    return { count: 0 };
                }
                if (where.id === 'A') return { count: targetMergedInto === null ? 1 : 0 };
                return { count: 1 };
            });

            await expect(chatService.mergeConversations(accountId, 'A', 'B')).rejects.toThrow(
                'Already merged conversations cannot be merged again'
            );

            expect(mockConversationUpdateMany).toHaveBeenNthCalledWith(3, {
                where: { id: 'A', accountId, mergedIntoId: null },
                data: { updatedAt: expect.any(Date) }
            });
            expect(mockMessageCreate).not.toHaveBeenCalled();
            expect(mockIo.emit).not.toHaveBeenCalledWith('conversation:merged', expect.anything());
        });

        it('allows only one concurrent transaction to claim the same source', async () => {
            mockFindFirst.mockImplementation(async ({ where }) => ({
                id: where.id,
                mergedIntoId: null,
                isRead: true
            }));
            let sourceClaimed = false;
            mockConversationUpdateMany.mockImplementation(async ({ where }) => {
                if (where.id === 'source') {
                    if (sourceClaimed) return { count: 0 };
                    sourceClaimed = true;
                }
                return { count: 1 };
            });

            const results = await Promise.allSettled([
                chatService.mergeConversations(accountId, 'target-a', 'source'),
                chatService.mergeConversations(accountId, 'target-b', 'source')
            ]);

            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
            expect(results.find(result => result.status === 'rejected')).toMatchObject({
                reason: expect.objectContaining({ message: 'Already merged conversations cannot be merged again' })
            });
            expect(mockMessageUpdateMany).toHaveBeenCalledTimes(1);
            expect(mockMessageCreate).toHaveBeenCalledTimes(1);
            expect(mockConversationUpdateMany).toHaveBeenCalledWith({
                where: { id: 'source', accountId, mergedIntoId: null },
                data: { status: 'CLOSED', mergedIntoId: expect.stringMatching(/^target-/) }
            });
        });
    });

    describe('addMessage', () => {
        it('does not reopen a closed conversation for an internal note', async () => {
            mockFindFirst.mockResolvedValueOnce({
                id: conversationId,
                accountId,
                status: 'CLOSED',
                wooCustomer: null,
                guestEmail: null,
                priority: 'MEDIUM',
                assignedTo: null,
                channel: 'EMAIL'
            });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, status: 'CLOSED' });

            await chatService.addMessage(conversationId, 'Private note', 'AGENT', 'user-1', true, accountId);

            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.not.objectContaining({ status: 'OPEN' })
            }));
        });

        it('should not emit inbox updates for blocked customer messages', async () => {
            vi.mocked(BlockedContactService.isBlocked).mockResolvedValueOnce(true);
            mockFindFirst.mockResolvedValueOnce({
                id: conversationId,
                accountId,
                status: 'OPEN',
                wooCustomer: { email: 'blocked@example.com' },
                guestEmail: null,
                priority: 'MEDIUM',
                assignedTo: null,
                channel: 'CHAT'
            });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, status: 'CLOSED' });

            await chatService.addMessage(conversationId, 'Blocked message', 'CUSTOMER', undefined, false, accountId);

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: expect.objectContaining({ status: 'CLOSED' })
                })
            );
            expect(mockIo.to).not.toHaveBeenCalled();
            expect(mockIo.emit).not.toHaveBeenCalled();
        });
    });

    describe('linkCustomer', () => {
        it('should link a customer to a conversation', async () => {
            const wooCustomerId = 'woo-cust-123';
            mockFindFirst.mockResolvedValueOnce({ id: conversationId });
            mockUpdate.mockResolvedValueOnce({ id: conversationId, wooCustomerId });

            const result = await chatService.linkCustomer(accountId, conversationId, wooCustomerId);

            expect(result.wooCustomerId).toBe(wooCustomerId);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { wooCustomerId }
                })
            );
        });

        it('rejects a customer owned by another account', async () => {
            mockFindFirst.mockResolvedValueOnce({ id: conversationId });
            mockWooCustomerFindFirst.mockResolvedValueOnce(null);

            await expect(chatService.linkCustomer(accountId, conversationId, 'foreign-customer')).rejects.toThrow(
                'Customer not found in this account'
            );
            expect(mockUpdate).not.toHaveBeenCalled();
        });
    });
});

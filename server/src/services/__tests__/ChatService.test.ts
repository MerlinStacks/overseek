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

vi.mock('../../utils/prisma', () => ({
    prisma: {
        conversation: {
            findMany: (...args: any[]) => mockFindMany(...args),
            findFirst: (...args: any[]) => mockFindFirst(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            create: (...args: any[]) => mockCreate(...args),
            update: (...args: any[]) => mockUpdate(...args),
            count: (...args: any[]) => mockCount(...args),
        },
        message: {
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'Test' }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        wooCustomer: {
            findFirst: vi.fn().mockResolvedValue(null),
        },
        account: {
            findFirst: vi.fn().mockResolvedValue({ id: 'account-1', name: 'Test Account' }),
        },
        emailLog: {
            findMany: vi.fn().mockResolvedValue([]),
        },
        accountFeature: {
            findFirst: vi.fn().mockResolvedValue(null),
        }
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
    });

    describe('listConversations', () => {
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
    });

    describe('createConversation', () => {
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
            mockFindUnique.mockResolvedValueOnce(null);

            const result = await chatService.getConversation(conversationId);

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

            mockFindUnique.mockResolvedValueOnce(mockConversation);

            const result = await chatService.getConversation(conversationId);

            expect(result).not.toBeNull();
            expect(result!.id).toBe(conversationId);
        });
    });

    describe('updateStatus', () => {
        it('should update conversation status', async () => {
            const newStatus = 'CLOSED';
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, status: newStatus });

            const result = await chatService.updateStatus(conversationId, newStatus);

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
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, assignedTo: userId });

            const result = await chatService.assignConversation(conversationId, userId);

            expect(result.assignedTo).toBe(userId);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { assignedTo: userId }
                })
            );
        });
    });

    describe('markAsRead', () => {
        it('should mark conversation as read', async () => {
            mockUpdate.mockResolvedValueOnce({ id: conversationId, accountId, isRead: true });

            const result = await chatService.markAsRead(conversationId);

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

    describe('linkCustomer', () => {
        it('should link a customer to a conversation', async () => {
            const wooCustomerId = 'woo-cust-123';
            mockUpdate.mockResolvedValueOnce({ id: conversationId, wooCustomerId });

            const result = await chatService.linkCustomer(conversationId, wooCustomerId);

            expect(result.wooCustomerId).toBe(wooCustomerId);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: conversationId },
                    data: { wooCustomerId }
                })
            );
        });
    });
});

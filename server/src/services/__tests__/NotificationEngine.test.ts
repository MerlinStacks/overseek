/**
 * NotificationEngine Unit Tests
 * 
 * Tests notification handler methods directly (unit tests).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationEngine } from '../NotificationEngine';
import { prisma } from '../../utils/prisma';
import { PushNotificationService } from '../PushNotificationService';

// Mock prisma - note: actual implementation uses prisma.notification, not inAppNotification
vi.mock('../../utils/prisma', () => ({
    prisma: {
        notification: {
            create: vi.fn(),
        },
        notificationDelivery: {
            create: vi.fn(),
        },
    }
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

// Mock PushNotificationService - actual method is sendToAccountWithDiagnostics
vi.mock('../PushNotificationService', () => ({
    PushNotificationService: {
        sendToAccountWithDiagnostics: vi.fn(),
    }
}));

// Mock Socket.IO
vi.mock('../../socket', () => ({
    getIO: vi.fn(() => ({
        to: vi.fn(() => ({
            emit: vi.fn()
        }))
    }))
}));

// Mock EventBus - just needs to exist, we're not testing subscriptions
vi.mock('../events', async () => {
    const actual = await vi.importActual('../events');
    return {
        ...(actual as any),
        EventBus: {
            on: vi.fn(),
            emit: vi.fn(),
        },
    };
});

describe('NotificationEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('handleOrderCreated', () => {
        it('should create in-app notification and send push', async () => {
            const mockOrder = {
                id: 'order_1',
                number: '1234',
                total: '150.00',
                currency: 'AUD',
                line_items: [{ name: 'Widget' }],
                billing: { first_name: 'John', last_name: 'Doe' }
            };

            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 1,
                failed: 0,
                diagnostics: {}
            });

            await (NotificationEngine as any).handleOrderCreated({
                accountId: 'acc_123',
                order: mockOrder
            });

            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    accountId: 'acc_123',
                    type: 'SUCCESS',
                    title: 'New Order Received',
                })
            });
        });

        it('should handle missing order data gracefully', async () => {
            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 0,
                failed: 0,
                diagnostics: {}
            });

            // Should not throw even with minimal order data
            await expect(
                (NotificationEngine as any).handleOrderCreated({
                    accountId: 'acc_123',
                    order: { number: '1234' }
                })
            ).resolves.not.toThrow();
        });
    });

    describe('handleReviewLeft', () => {
        it('should create notification for new review', async () => {
            const mockReview = {
                id: 'review_1',
                product: 'Widget',
                rating: 5,
                reviewer: 'Jane Doe',
                content: 'Great product!'
            };

            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 1,
                failed: 0,
                diagnostics: {}
            });

            await (NotificationEngine as any).handleReviewLeft({
                accountId: 'acc_123',
                review: mockReview
            });

            expect(prisma.notification.create).toHaveBeenCalled();
        });
    });

    describe('handleStockMismatch', () => {
        it('should create notification for stock discrepancy', async () => {
            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 1,
                failed: 0,
                diagnostics: {}
            });

            await (NotificationEngine as any).handleStockMismatch({
                accountId: 'acc_123',
                productId: 101,
                productName: 'Widget A',
                wooStock: 10,
                expectedStock: 15,
                newStock: 10
            });

            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: 'WARNING',
                })
            });
        });
    });

    describe('handleStockoutAlert', () => {
        it('should create notification for stockout risk', async () => {
            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 1,
                failed: 0,
                diagnostics: {}
            });

            await (NotificationEngine as any).handleStockoutAlert({
                accountId: 'acc_123',
                products: [
                    {
                        id: 'prod_1',
                        name: 'Widget A',
                        sku: 'WA-001',
                        currentStock: 5,
                        daysUntilStockout: 2,
                        stockoutRisk: 'CRITICAL',
                        recommendedReorderQty: 50
                    }
                ]
            });

            expect(prisma.notification.create).toHaveBeenCalled();
        });

        it('should skip notification if no products at risk', async () => {
            await (NotificationEngine as any).handleStockoutAlert({
                accountId: 'acc_123',
                products: []
            });

            expect(prisma.notification.create).not.toHaveBeenCalled();
        });
    });

    describe('handleAdAlert', () => {
        it('should create notification for ad performance alert', async () => {
            (prisma.notification.create as any).mockResolvedValue({ id: 'notif_1' });
            (prisma.notificationDelivery.create as any).mockResolvedValue({});
            (PushNotificationService.sendToAccountWithDiagnostics as any).mockResolvedValue({
                sent: 1,
                failed: 0,
                diagnostics: {}
            });

            await (NotificationEngine as any).handleAdAlert({
                accountId: 'acc_123',
                alert: {
                    severity: 'high',
                    type: 'BUDGET_DEPLETED',
                    title: 'Campaign Budget Depleted',
                    message: 'Your campaign "Summer Sale" has run out of budget.',
                    campaignName: 'Summer Sale'
                }
            });

            expect(prisma.notification.create).toHaveBeenCalled();
        });
    });

    describe('logDelivery', () => {
        it('should log delivery attempt to database', async () => {
            (prisma.notificationDelivery.create as any).mockResolvedValue({});

            await (NotificationEngine as any).logDelivery({
                accountId: 'acc_123',
                eventType: 'order.created',
                channels: ['in_app', 'push'],
                results: { in_app: 'created', push: 'sent' }
            });

            expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    accountId: 'acc_123',
                    eventType: 'order.created',
                })
            });
        });
    });
});

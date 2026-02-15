/**
 * NotificationEngine - Centralized notification handling
 * 
 * Subscribes to EventBus events and delivers notifications across all channels
 * (in-app, push) with full delivery logging for debugging.
 */

import { EventBus, EVENTS } from './events';
import { prisma } from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { Logger } from '../utils/logger';
import { PushNotificationService } from './PushNotificationService';
import { getIO } from '../socket';

interface NotificationConfig {
    accountId: string;
    eventType: string;
    channels: ('in_app' | 'push' | 'socket')[];
    inApp?: {
        title: string;
        message: string;
        type?: string;
        link?: string;
    };
    push?: {
        title: string;
        body: string;
        data?: Record<string, unknown>;
    };
    pushType?: 'order' | 'message';
    socket?: {
        event: string;
        payload: Record<string, unknown>;
    };
    payload?: Record<string, unknown>;
}

export class NotificationEngine {
    private static initialized = false;

    /**
     * Initialize the notification engine by subscribing to all notification-worthy events.
     * Call this once during app startup.
     */
    static init(): void {
        if (this.initialized) {
            Logger.debug('[NotificationEngine] Already initialized, skipping');
            return;
        }

        Logger.info('[NotificationEngine] Initializing notification engine');

        // Order Events
        EventBus.on(EVENTS.ORDER.CREATED, this.handleOrderCreated.bind(this));

        // Review Events
        EventBus.on(EVENTS.REVIEW.LEFT, this.handleReviewLeft.bind(this));

        // Email Events
        EventBus.on(EVENTS.EMAIL.RECEIVED, this.handleEmailReceived.bind(this));

        // Chat Events (live chat widget)
        EventBus.on(EVENTS.CHAT.MESSAGE_RECEIVED, this.handleChatMessage.bind(this));

        // Stock Events
        EventBus.on(EVENTS.STOCK.MISMATCH, this.handleStockMismatch.bind(this));

        // Social Message Events
        EventBus.on(EVENTS.SOCIAL.MESSAGE_RECEIVED, this.handleSocialMessage.bind(this));

        // Ad Performance Alerts (AI Marketing Co-Pilot Phase 6)
        EventBus.on(EVENTS.AD.ALERT, this.handleAdAlert.bind(this));

        // Inventory Stockout Alerts (Predictive Inventory Forecasting)
        EventBus.on(EVENTS.INVENTORY.STOCKOUT_ALERT, this.handleStockoutAlert.bind(this));

        // Sync Failure Alerts
        EventBus.on(EVENTS.SYNC.FAILURE_THRESHOLD, this.handleSyncFailureThreshold.bind(this));

        // SEO Rank Change Alerts (Keyword Tracker)
        EventBus.on(EVENTS.SEO.RANK_CHANGE, this.handleRankChange.bind(this));

        this.initialized = true;
        Logger.info('[NotificationEngine] Initialized - listening for 10 event types');
    }

    /**
     * Handle new order created event.
     * Builds a product list summary from line_items so the notification
     * shows exactly what was ordered, not just a count.
     */
    private static async handleOrderCreated(data: { accountId: string; order: any }): Promise<void> {
        const { accountId, order } = data;

        const lineItems = order.line_items as Array<{ name?: string; quantity?: number }> | undefined;
        const itemCount = lineItems?.length || 0;
        const itemText = itemCount === 1 ? '1 item' : `${itemCount} items`;
        const orderNumber = order.number || order.id;
        const total = parseFloat(String(order.total)) || 0;

        // Build a concise product list (cap at 5 to keep notifications readable)
        const MAX_VISIBLE = 5;
        const productLines = (lineItems || [])
            .slice(0, MAX_VISIBLE)
            .map(li => {
                const name = li.name || 'Unnamed product';
                const qty = li.quantity ?? 1;
                return `• ${name} ×${qty}`;
            });
        if (itemCount > MAX_VISIBLE) {
            productLines.push(`  …and ${itemCount - MAX_VISIBLE} more`);
        }
        const productListText = productLines.join('\n');

        // Single-line summary for push body (newlines don't render well on all platforms)
        const productSummary = (lineItems || [])
            .slice(0, MAX_VISIBLE)
            .map(li => `${li.name || 'Unnamed'} ×${li.quantity ?? 1}`)
            .join(', ')
            + (itemCount > MAX_VISIBLE ? `, +${itemCount - MAX_VISIBLE} more` : '');

        const headline = `Order #${orderNumber} - $${total} (${itemText})`;

        await this.sendNotification({
            accountId,
            eventType: 'ORDER_CREATED',
            channels: ['in_app', 'push', 'socket'],
            inApp: {
                title: 'New Order Received',
                message: productListText
                    ? `${headline}\n${productListText}`
                    : headline,
                type: 'SUCCESS',
                link: '/orders'
            },
            push: {
                title: '🛒 New Order!',
                body: productSummary
                    ? `${headline}\n${productSummary}`
                    : headline,
                data: { url: '/orders' }
            },
            pushType: 'order',
            socket: {
                event: 'order:new',
                payload: {
                    orderId: order.id,
                    orderNumber,
                    total,
                    itemCount,
                    products: (lineItems || []).map(li => ({
                        name: li.name || 'Unnamed product',
                        quantity: li.quantity ?? 1
                    })),
                    customerName: order.billing?.first_name
                        ? `${order.billing.first_name} ${order.billing.last_name || ''}`.trim()
                        : 'Guest'
                }
            },
            payload: { orderId: order.id, orderNumber, total }
        });
    }

    /**
     * Handle new review left event
     */
    private static async handleReviewLeft(data: { accountId: string; review: any }): Promise<void> {
        const { accountId, review } = data;

        await this.sendNotification({
            accountId,
            eventType: 'REVIEW_LEFT',
            channels: ['in_app', 'push'],
            inApp: {
                title: 'New Review',
                message: `${review.reviewer} left a ${review.rating}★ review`,
                type: review.rating >= 4 ? 'SUCCESS' : 'WARNING',
                link: '/reviews'
            },
            push: {
                title: review.rating >= 4 ? '⭐ New Review!' : '📝 New Review',
                body: `${review.reviewer}: ${review.rating}★ - "${(review.content || '').substring(0, 50)}..."`,
                data: { url: '/reviews' }
            },
            pushType: 'message', // Reviews use message preference for now
            payload: { reviewId: review.id, rating: review.rating }
        });
    }

    /**
     * Handle email received event
     */
    private static async handleEmailReceived(data: { accountId: string; conversationId: string; fromEmail?: string; fromName?: string; subject?: string }): Promise<void> {
        const { accountId, conversationId, fromEmail, fromName, subject } = data;

        await this.sendNotification({
            accountId,
            eventType: 'EMAIL_RECEIVED',
            channels: ['push'],
            push: {
                title: '📧 New Email',
                body: `${fromName || fromEmail}: ${subject || 'No subject'}`.substring(0, 100),
                data: { url: '/inbox', conversationId }
            },
            pushType: 'message',
            payload: { conversationId, fromEmail }
        });
    }

    /**
     * Handle chat message received (live chat widget)
     */
    private static async handleChatMessage(data: { accountId: string; conversationId: string; content: string }): Promise<void> {
        const { accountId, conversationId, content } = data;

        await this.sendNotification({
            accountId,
            eventType: 'CHAT_MESSAGE_RECEIVED',
            channels: ['push'],
            push: {
                title: '💬 New Chat Message',
                body: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
                data: { url: '/inbox', conversationId }
            },
            pushType: 'message',
            payload: { conversationId }
        });
    }

    /**
     * Handle stock mismatch detected
     */
    private static async handleStockMismatch(data: {
        accountId: string;
        productId: number;
        productName: string;
        wooStock: number;
        expectedStock: number;
        newStock: number;
        internalProductId?: string;
    }): Promise<void> {
        const { accountId, productId, productName, wooStock, expectedStock, newStock, internalProductId } = data;

        await this.sendNotification({
            accountId,
            eventType: 'STOCK_MISMATCH',
            channels: ['in_app', 'push'],
            inApp: {
                title: 'Stock Mismatch Detected',
                message: `"${productName}" had stock mismatch: Expected ${expectedStock}, WooCommerce had ${wooStock}. Updated to ${newStock}.`,
                type: 'WARNING',
                link: internalProductId ? `/products/${internalProductId}` : '/inventory'
            },
            push: {
                title: '⚠️ Stock Mismatch Detected',
                body: `"${productName}" had stock mismatch: Expected ${expectedStock}, WooCommerce had ${wooStock}. Updated to ${newStock}.`,
                data: {
                    type: 'stock_mismatch',
                    productId: internalProductId,
                    wooProductId: productId,
                    url: internalProductId ? `/products/${internalProductId}` : '/inventory'
                }
            },
            pushType: 'order', // Stock uses order notification preference
            payload: { productId, productName, wooStock, expectedStock, newStock }
        });
    }

    /**
     * Handle social message received event
     */
    private static async handleSocialMessage(data: { accountId: string; platform: string; conversationId: string }): Promise<void> {
        const { accountId, platform, conversationId } = data;

        const platformLabel = platform === 'FACEBOOK' ? '💬 Messenger'
            : platform === 'INSTAGRAM' ? '📷 Instagram'
                : '🎵 TikTok';

        await this.sendNotification({
            accountId,
            eventType: 'SOCIAL_MESSAGE_RECEIVED',
            channels: ['push'],
            push: {
                title: `${platformLabel} Message`,
                body: 'New message received',
                data: { url: '/inbox', conversationId }
            },
            pushType: 'message',
            payload: { platform, conversationId }
        });
    }

    /**
     * Handle ad performance alert (AI Marketing Co-Pilot Phase 6)
     */
    private static async handleAdAlert(data: {
        accountId: string;
        alert: {
            severity: string;
            type: string;
            title: string;
            message: string;
            campaignName?: string;
        };
    }): Promise<void> {
        const { accountId, alert } = data;

        const emoji = alert.severity === 'critical' ? '🚨' :
            alert.severity === 'warning' ? '⚠️' : 'ℹ️';

        await this.sendNotification({
            accountId,
            eventType: 'AD_ALERT',
            channels: ['in_app', 'push'],
            inApp: {
                title: alert.title,
                message: alert.message,
                type: alert.severity === 'critical' ? 'ERROR' : 'WARNING',
                link: '/marketing/ads'
            },
            push: {
                title: `${emoji} ${alert.title}`,
                body: alert.message,
                data: { url: '/marketing/ads', alertType: alert.type }
            },
            pushType: 'order', // Ad alerts use order notification preference
            payload: {
                alertType: alert.type,
                severity: alert.severity,
                campaignName: alert.campaignName
            }
        });
    }

    /**
     * Handle inventory stockout alert (Predictive Inventory Forecasting)
     */
    private static async handleStockoutAlert(data: {
        accountId: string;
        products: Array<{
            id: string;
            name: string;
            sku: string | null;
            currentStock: number;
            daysUntilStockout: number;
            stockoutRisk: string;
            recommendedReorderQty: number;
        }>;
    }): Promise<void> {
        const { accountId, products } = data;

        if (products.length === 0) return;

        const criticalCount = products.length;
        const productList = products.slice(0, 3).map(p => p.name).join(', ');
        const moreText = criticalCount > 3 ? ` and ${criticalCount - 3} more` : '';

        await this.sendNotification({
            accountId,
            eventType: 'STOCKOUT_ALERT',
            channels: ['in_app', 'push'],
            inApp: {
                title: 'Stockout Risk Alert',
                message: `${criticalCount} product${criticalCount > 1 ? 's' : ''} at risk: ${productList}${moreText}`,
                type: 'WARNING',
                link: '/inventory/forecasts'
            },
            push: {
                title: '⚠️ Stockout Risk Alert',
                body: `${criticalCount} product${criticalCount > 1 ? 's' : ''} may stock out soon: ${productList}${moreText}`,
                data: { url: '/inventory/forecasts' }
            },
            pushType: 'order', // Inventory uses order notification preference
            payload: {
                criticalCount,
                products: products.map(p => ({ id: p.id, name: p.name, daysLeft: p.daysUntilStockout }))
            }
        });
    }

    /**
     * Handle repeated sync failures for an entity.
     */
    private static async handleSyncFailureThreshold(data: {
        accountId: string;
        entityType: string;
        failureCount: number;
        lastError?: string;
    }): Promise<void> {
        const { accountId, entityType, failureCount, lastError } = data;
        const entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
        const eventType = `SYNC_FAILURE_THRESHOLD_${entityType.toUpperCase()}`;

        await this.sendNotification({
            accountId,
            eventType,
            channels: ['in_app', 'push'],
            inApp: {
                title: `${entityLabel} Sync Issues`,
                message: `${failureCount} failures in the last 24 hours. We will keep retrying automatically.`,
                type: 'WARNING',
                link: '/settings?tab=sync'
            },
            push: {
                title: `${entityLabel} Sync Issues`,
                body: `${failureCount} failures in the last 24 hours. Check sync health for details.`,
                data: { url: '/settings?tab=sync', entityType, lastError }
            },
            pushType: 'order',
            payload: { entityType, failureCount, lastError }
        });
    }

    /**
     * Handle SEO keyword rank change alert
     */
    private static async handleRankChange(data: {
        accountId: string;
        keyword: string;
        keywordId: string;
        oldPosition: number;
        newPosition: number;
        direction: 'up' | 'down';
        delta: number;
        crossedPageBoundary: boolean;
    }): Promise<void> {
        const { accountId, keyword, oldPosition, newPosition, direction, delta, crossedPageBoundary } = data;

        const emoji = direction === 'up' ? '📈' : '📉';
        const verb = direction === 'up' ? 'improved' : 'dropped';
        const oldRound = Math.round(oldPosition * 10) / 10;
        const newRound = Math.round(newPosition * 10) / 10;

        let message = `"${keyword}" ${verb} from #${oldRound} → #${newRound}`;
        if (crossedPageBoundary) {
            const page = Math.ceil(newPosition / 10);
            message += direction === 'down'
                ? ` (now on page ${page})`
                : ` (now on page ${page}!)`;
        }

        const severity = crossedPageBoundary ? 'WARNING' : 'INFO';

        await this.sendNotification({
            accountId,
            eventType: 'SEO_RANK_CHANGE',
            channels: ['in_app', 'push'],
            inApp: {
                title: `${emoji} Keyword Rank ${direction === 'up' ? 'Improved' : 'Dropped'}`,
                message,
                type: severity,
                link: '/seo/keywords'
            },
            push: {
                title: `${emoji} Rank ${direction === 'up' ? 'Improved' : 'Dropped'}`,
                body: message,
                data: { url: '/seo/keywords' }
            },
            pushType: 'order',
            payload: { keyword, oldPosition: oldRound, newPosition: newRound, delta, direction }
        });
    }

    /**
     * Core notification delivery method
     */
    private static async sendNotification(config: NotificationConfig): Promise<void> {
        // Guard: Skip if accountId is missing
        if (!config.accountId) {
            Logger.info('[NotificationEngine] Skipping notification - accountId is undefined', {
                eventType: config.eventType
            });
            return;
        }

        const results: Record<string, unknown> = {};
        let subscriptionLookup: Record<string, unknown> | null = null;

        Logger.info('[NotificationEngine] Sending notification', {
            accountId: config.accountId,
            eventType: config.eventType,
            channels: config.channels
        });

        try {
            // 1. In-App Notification
            if (config.channels.includes('in_app') && config.inApp) {
                try {
                    await prisma.notification.create({
                        data: {
                            accountId: config.accountId,
                            title: config.inApp.title,
                            message: config.inApp.message,
                            type: config.inApp.type || 'INFO',
                            link: config.inApp.link
                        }
                    });
                    results.in_app = 'sent';
                } catch (error) {
                    Logger.error('[NotificationEngine] In-app notification failed', { error });
                    results.in_app = { error: (error as Error).message };
                }
            }

            // 2. Push Notification
            if (config.channels.includes('push') && config.push && config.pushType) {
                try {
                    const pushResult = await PushNotificationService.sendToAccountWithDiagnostics(
                        config.accountId,
                        config.push,
                        config.pushType
                    );
                    results.push = { sent: pushResult.sent, failed: pushResult.failed };
                    subscriptionLookup = pushResult.diagnostics;
                } catch (error) {
                    Logger.error('[NotificationEngine] Push notification failed', { error });
                    results.push = { error: (error as Error).message };
                }
            }

            // 3. Socket.IO Emit
            if (config.channels.includes('socket') && config.socket) {
                try {
                    const socketIO = getIO();
                    if (socketIO) {
                        socketIO.to(`account:${config.accountId}`).emit(config.socket.event, config.socket.payload);
                        results.socket = 'emitted';
                    } else {
                        results.socket = 'io_not_available';
                    }
                } catch (error) {
                    Logger.error('[NotificationEngine] Socket emit failed', { error });
                    results.socket = { error: (error as Error).message };
                }
            }

        } catch (error) {
            Logger.error('[NotificationEngine] Notification delivery failed', { error, config });
        }

        // Log delivery for debugging
        await this.logDelivery({
            accountId: config.accountId,
            eventType: config.eventType,
            channels: config.channels,
            results,
            subscriptionLookup,
            payload: config.payload
        });
    }

    /**
     * Log notification delivery for debugging
     */
    private static async logDelivery(data: {
        accountId: string;
        eventType: string;
        channels: string[];
        results: Record<string, unknown>;
        subscriptionLookup?: Record<string, unknown> | null;
        payload?: Record<string, unknown>;
    }): Promise<void> {
        try {
            // Guard: Skip logging if accountId is missing (required by schema)
            if (!data.accountId) {
                Logger.info('[NotificationEngine] Skipping delivery log - accountId is undefined', {
                    eventType: data.eventType,
                    channels: data.channels
                });
                return;
            }

            // Sanitize data to ensure valid JSON (removes undefined, functions, circular refs)
            const sanitize = <T>(obj: T, label = 'unknown'): T | undefined => {
                if (obj === null || obj === undefined) return undefined;
                try {
                    return JSON.parse(JSON.stringify(obj));
                } catch (err) {
                    Logger.warn('[NotificationEngine] Failed to serialize payload for delivery log', {
                        label,
                        error: (err as Error).message
                    });
                    return undefined;
                }
            };

            // Build data with optional fields only if they exist
            const sanitizedSubscriptionLookup = sanitize(data.subscriptionLookup);
            const sanitizedPayload = sanitize(data.payload);

            await prisma.notificationDelivery.create({
                data: {
                    accountId: data.accountId,
                    eventType: data.eventType,
                    channels: (sanitize(data.channels) ?? []) as Prisma.InputJsonValue,
                    results: (sanitize(data.results) ?? {}) as Prisma.InputJsonValue,
                    // Only include optional fields if they have values (not undefined)
                    ...(sanitizedSubscriptionLookup !== undefined && { subscriptionLookup: sanitizedSubscriptionLookup as Prisma.InputJsonValue }),
                    ...(sanitizedPayload !== undefined && { payload: sanitizedPayload as Prisma.InputJsonValue })
                }
            });
        } catch (error: any) {
            // Don't fail the notification if logging fails
            Logger.error('[NotificationEngine] Failed to log delivery', {
                error,
                errorMessage: error?.message || String(error),
                errorName: error?.name,
                debugData: {
                    accountId: data.accountId,
                    eventType: data.eventType,
                    channelsType: typeof data.channels,
                    resultsType: typeof data.results
                }
            });
        }
    }
}

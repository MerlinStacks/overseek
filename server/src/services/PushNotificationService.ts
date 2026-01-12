import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * Service for managing Web Push notifications.
 * 
 * Uses VAPID keys stored in PlatformCredentials for authentication.
 * Subscriptions are stored per-user/device in PushSubscription table.
 */
export class PushNotificationService {
    private static vapidKeysCache: { publicKey: string; privateKey: string } | null = null;
    private static cacheExpiry: number = 0;
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Retrieves VAPID keys from platform credentials with TTL caching.
     */
    private static async getVapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
        const now = Date.now();
        if (this.vapidKeysCache && now < this.cacheExpiry) {
            return this.vapidKeysCache;
        }

        try {
            const credential = await prisma.platformCredentials.findUnique({
                where: { platform: 'WEB_PUSH_VAPID' }
            });

            if (!credential?.credentials) {
                Logger.warn('[PushNotificationService] No VAPID keys configured in platform credentials');
                return null;
            }

            const keys = credential.credentials as { publicKey: string; privateKey: string };
            if (!keys.publicKey || !keys.privateKey) {
                Logger.warn('[PushNotificationService] Invalid VAPID key format');
                return null;
            }

            this.vapidKeysCache = keys;
            this.cacheExpiry = now + this.CACHE_TTL_MS;
            return keys;
        } catch (error) {
            Logger.error('[PushNotificationService] Failed to fetch VAPID keys', { error });
            return null;
        }
    }

    /**
     * Returns the public VAPID key for client-side subscription.
     */
    static async getVapidPublicKey(): Promise<string | null> {
        const keys = await this.getVapidKeys();
        return keys?.publicKey || null;
    }

    /**
     * Subscribes a user's device to push notifications.
     */
    static async subscribe(
        userId: string,
        accountId: string,
        subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
        preferences: { notifyNewMessages?: boolean; notifyNewOrders?: boolean } = {}
    ): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            const result = await prisma.pushSubscription.upsert({
                where: {
                    userId_endpoint: {
                        userId,
                        endpoint: subscription.endpoint
                    }
                },
                update: {
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    accountId,
                    notifyNewMessages: preferences.notifyNewMessages ?? true,
                    notifyNewOrders: preferences.notifyNewOrders ?? true,
                    updatedAt: new Date()
                },
                create: {
                    userId,
                    accountId,
                    endpoint: subscription.endpoint,
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    notifyNewMessages: preferences.notifyNewMessages ?? true,
                    notifyNewOrders: preferences.notifyNewOrders ?? true
                }
            });

            Logger.warn('[PushNotificationService] Subscription saved', { userId, accountId, subscriptionId: result.id });
            return { success: true, id: result.id };
        } catch (error) {
            Logger.error('[PushNotificationService] Subscribe failed', { error, userId });
            return { success: false, error: 'Failed to save subscription' };
        }
    }

    /**
     * Removes a push subscription.
     */
    static async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
        try {
            await prisma.pushSubscription.deleteMany({
                where: { userId, endpoint }
            });
            Logger.info('[PushNotificationService] Unsubscribed', { userId });
            return true;
        } catch (error) {
            Logger.error('[PushNotificationService] Unsubscribe failed', { error, userId });
            return false;
        }
    }

    /**
     * Updates notification preferences for a subscription.
     */
    static async updatePreferences(
        userId: string,
        endpoint: string,
        preferences: { notifyNewMessages?: boolean; notifyNewOrders?: boolean }
    ): Promise<boolean> {
        try {
            await prisma.pushSubscription.updateMany({
                where: { userId, endpoint },
                data: {
                    ...(preferences.notifyNewMessages !== undefined && { notifyNewMessages: preferences.notifyNewMessages }),
                    ...(preferences.notifyNewOrders !== undefined && { notifyNewOrders: preferences.notifyNewOrders })
                }
            });
            return true;
        } catch (error) {
            Logger.error('[PushNotificationService] Update preferences failed', { error, userId });
            return false;
        }
    }

    /**
     * Gets the current subscription status for a user.
     */
    static async getSubscription(userId: string, accountId: string): Promise<{
        isSubscribed: boolean;
        endpoint?: string;
        preferences?: { notifyNewMessages: boolean; notifyNewOrders: boolean };
    }> {
        try {
            const sub = await prisma.pushSubscription.findFirst({
                where: { userId, accountId },
                orderBy: { updatedAt: 'desc' }
            });

            if (!sub) {
                return { isSubscribed: false };
            }

            return {
                isSubscribed: true,
                endpoint: sub.endpoint,
                preferences: {
                    notifyNewMessages: sub.notifyNewMessages,
                    notifyNewOrders: sub.notifyNewOrders
                }
            };
        } catch (error) {
            Logger.error('[PushNotificationService] Get subscription failed', { error, userId });
            return { isSubscribed: false };
        }
    }

    /**
     * Sends a push notification to all devices for users in an account.
     * Filters by notification type preference.
     */
    static async sendToAccount(
        accountId: string,
        notification: { title: string; body: string; data?: Record<string, unknown> },
        type: 'message' | 'order'
    ): Promise<{ sent: number; failed: number }> {
        const keys = await this.getVapidKeys();
        if (!keys) {
            Logger.warn('[PushNotificationService] Skipping notification - No VAPID keys configured. Run generate-vapid-keys script.', { accountId, type });
            return { sent: 0, failed: 0 };
        }

        // Configure web-push
        webpush.setVapidDetails(
            'mailto:notifications@overseek.io',
            keys.publicKey,
            keys.privateKey
        );

        // Find all subscriptions for this account with matching preference
        const whereClause: Record<string, unknown> = { accountId };
        if (type === 'message') {
            whereClause.notifyNewMessages = true;
        } else if (type === 'order') {
            whereClause.notifyNewOrders = true;
        }

        const subscriptions = await prisma.pushSubscription.findMany({
            where: whereClause
        });

        // Diagnostic: log when no subscriptions found (common issue)
        if (subscriptions.length === 0) {
            Logger.warn('[PushNotificationService] No subscriptions found for account', {
                accountId,
                type,
                title: notification.title
            });
            return { sent: 0, failed: 0 };
        }

        Logger.warn('[PushNotificationService] Sending push notifications', {
            accountId,
            type,
            subscriptionCount: subscriptions.length
        });

        let sent = 0;
        let failed = 0;

        for (const sub of subscriptions) {
            try {
                const pushSubscription: WebPushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };

                await webpush.sendNotification(
                    pushSubscription,
                    JSON.stringify(notification)
                );
                sent++;
            } catch (error: unknown) {
                failed++;
                // If subscription is invalid (410 Gone), remove it
                const statusCode = (error as { statusCode?: number })?.statusCode;
                if (statusCode === 410 || statusCode === 404) {
                    await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => { });
                    Logger.info('[PushNotificationService] Removed stale subscription', { subId: sub.id });
                } else {
                    Logger.error('[PushNotificationService] Send failed', { error, subId: sub.id });
                }
            }
        }

        if (sent > 0) {
            Logger.info('[PushNotificationService] Notifications sent', { accountId, sent, failed, type });
        }

        return { sent, failed };
    }

    /**
     * Sends a test notification to a specific user's subscribed devices.
     * Used to verify push notification setup is working correctly.
     */
    static async sendTestNotification(
        userId: string,
        accountId: string
    ): Promise<{ success: boolean; sent: number; failed: number; error?: string }> {
        Logger.warn('[PushNotificationService] sendTestNotification called', { userId, accountId });

        const keys = await this.getVapidKeys();
        if (!keys) {
            Logger.warn('[PushNotificationService] Test failed - no VAPID keys');
            return { success: false, sent: 0, failed: 0, error: 'VAPID keys not configured' };
        }

        webpush.setVapidDetails(
            'mailto:notifications@overseek.io',
            keys.publicKey,
            keys.privateKey
        );

        const subscriptions = await prisma.pushSubscription.findMany({
            where: { userId, accountId }
        });

        Logger.warn('[PushNotificationService] Test subscription lookup', {
            userId,
            accountId,
            foundCount: subscriptions.length
        });

        if (subscriptions.length === 0) {
            return { success: false, sent: 0, failed: 0, error: 'No subscriptions found' };
        }

        const notification = {
            title: '🔔 Test Notification',
            body: 'Push notifications are working correctly!',
            data: { type: 'test', timestamp: Date.now() }
        };

        let sent = 0;
        let failed = 0;

        for (const sub of subscriptions) {
            try {
                const pushSubscription: WebPushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };

                await webpush.sendNotification(
                    pushSubscription,
                    JSON.stringify(notification)
                );
                sent++;
            } catch (error: unknown) {
                failed++;
                const statusCode = (error as { statusCode?: number })?.statusCode;
                if (statusCode === 410 || statusCode === 404) {
                    await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => { });
                    Logger.info('[PushNotificationService] Removed stale subscription during test', { subId: sub.id });
                } else {
                    Logger.error('[PushNotificationService] Test notification failed', { error, subId: sub.id });
                }
            }
        }

        Logger.info('[PushNotificationService] Test notification sent', { userId, sent, failed });
        return { success: sent > 0, sent, failed };
    }
}

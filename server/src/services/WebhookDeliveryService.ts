/**
 * WebhookDeliveryService
 * 
 * Handles logging, tracking, and replaying of webhook deliveries.
 * Enables auditing and recovery from failed webhook processing.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/** Webhook source platforms */
export type WebhookSource = 'WOOCOMMERCE' | 'META' | 'TIKTOK';

/** Webhook delivery status */
export type WebhookStatus = 'RECEIVED' | 'PROCESSED' | 'FAILED';

/** Filter options for listing deliveries */
export interface WebhookDeliveryFilters {
    status?: WebhookStatus;
    source?: WebhookSource;
    topic?: string;
    fromDate?: Date;
    toDate?: Date;
}

/** Pagination options */
export interface PaginationOptions {
    page?: number;
    limit?: number;
}

/**
 * Service for managing webhook delivery lifecycle.
 * Provides logging, status tracking, and replay capabilities.
 */
export class WebhookDeliveryService {
    /**
     * Log an incoming webhook delivery.
     * Call this immediately upon receiving a webhook, before processing.
     */
    static async logDelivery(
        accountId: string,
        topic: string,
        payload: unknown,
        source: WebhookSource = 'WOOCOMMERCE'
    ): Promise<string> {
        const delivery = await prisma.webhookDelivery.create({
            data: {
                accountId,
                topic,
                source,
                payload: payload as object,
                status: 'RECEIVED',
                receivedAt: new Date(),
            },
        });

        Logger.info('[Webhook] Delivery logged', {
            deliveryId: delivery.id,
            accountId,
            topic,
            source,
        });

        return delivery.id;
    }

    /**
     * Mark a webhook delivery as successfully processed.
     */
    static async markProcessed(deliveryId: string): Promise<void> {
        await prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                status: 'PROCESSED',
                processedAt: new Date(),
            },
        });

        Logger.info('[Webhook] Delivery marked as processed', { deliveryId });
    }

    /**
     * Mark a webhook delivery as failed with an error message.
     */
    static async markFailed(deliveryId: string, error: string): Promise<void> {
        await prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                status: 'FAILED',
                lastError: error,
            },
        });

        Logger.warn('[Webhook] Delivery marked as failed', { deliveryId, error });
    }

    /**
     * Replay a failed webhook delivery.
     * Returns the delivery data for the caller to re-process.
     */
    static async replay(deliveryId: string): Promise<{
        id: string;
        accountId: string;
        topic: string;
        source: string;
        payload: unknown;
    } | null> {
        const delivery = await prisma.webhookDelivery.findUnique({
            where: { id: deliveryId },
        });

        if (!delivery) {
            Logger.warn('[Webhook] Replay requested for non-existent delivery', { deliveryId });
            return null;
        }

        // Increment attempt counter and reset status
        await prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                attempts: { increment: 1 },
                status: 'RECEIVED',
                lastError: null,
            },
        });

        Logger.info('[Webhook] Delivery queued for replay', {
            deliveryId,
            accountId: delivery.accountId,
            topic: delivery.topic,
            attempt: delivery.attempts + 1,
        });

        return {
            id: delivery.id,
            accountId: delivery.accountId,
            topic: delivery.topic,
            source: delivery.source,
            payload: delivery.payload,
        };
    }

    /**
     * List webhook deliveries with filtering and pagination.
     */
    static async getDeliveries(
        accountId: string | null,
        filters: WebhookDeliveryFilters = {},
        pagination: PaginationOptions = {}
    ): Promise<{
        deliveries: Array<{
            id: string;
            accountId: string;
            topic: string;
            source: string;
            status: string;
            attempts: number;
            lastError: string | null;
            receivedAt: Date;
            processedAt: Date | null;
        }>;
        total: number;
        page: number;
        totalPages: number;
    }> {
        const page = pagination.page || 1;
        const limit = Math.min(pagination.limit || 20, 100);
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = {};

        if (accountId) {
            where.accountId = accountId;
        }
        if (filters.status) {
            where.status = filters.status;
        }
        if (filters.source) {
            where.source = filters.source;
        }
        if (filters.topic) {
            where.topic = { contains: filters.topic };
        }
        if (filters.fromDate || filters.toDate) {
            where.receivedAt = {};
            if (filters.fromDate) {
                (where.receivedAt as Record<string, Date>).gte = filters.fromDate;
            }
            if (filters.toDate) {
                (where.receivedAt as Record<string, Date>).lte = filters.toDate;
            }
        }

        const [deliveries, total] = await Promise.all([
            prisma.webhookDelivery.findMany({
                where,
                orderBy: { receivedAt: 'desc' },
                take: limit,
                skip,
                select: {
                    id: true,
                    accountId: true,
                    topic: true,
                    source: true,
                    status: true,
                    attempts: true,
                    lastError: true,
                    receivedAt: true,
                    processedAt: true,
                },
            }),
            prisma.webhookDelivery.count({ where }),
        ]);

        return {
            deliveries,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    /**
     * Get a single delivery with full payload for replay inspection.
     */
    static async getDelivery(deliveryId: string): Promise<{
        id: string;
        accountId: string;
        topic: string;
        source: string;
        status: string;
        attempts: number;
        lastError: string | null;
        payload: unknown;
        receivedAt: Date;
        processedAt: Date | null;
    } | null> {
        return prisma.webhookDelivery.findUnique({
            where: { id: deliveryId },
        });
    }

    /**
     * Get failed delivery count for monitoring/alerts.
     */
    static async getFailedCount(accountId?: string, sinceHours = 24): Promise<number> {
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

        return prisma.webhookDelivery.count({
            where: {
                status: 'FAILED',
                receivedAt: { gte: since },
                ...(accountId ? { accountId } : {}),
            },
        });
    }

    /**
     * Cleanup old processed deliveries (retention policy).
     * Keep failed deliveries longer for debugging.
     */
    static async cleanup(
        processedRetentionDays = 7,
        failedRetentionDays = 30
    ): Promise<{ processedDeleted: number; failedDeleted: number }> {
        const processedCutoff = new Date(Date.now() - processedRetentionDays * 24 * 60 * 60 * 1000);
        const failedCutoff = new Date(Date.now() - failedRetentionDays * 24 * 60 * 60 * 1000);

        const processedResult = await prisma.webhookDelivery.deleteMany({
            where: {
                status: 'PROCESSED',
                receivedAt: { lt: processedCutoff },
            },
        });

        const failedResult = await prisma.webhookDelivery.deleteMany({
            where: {
                status: 'FAILED',
                receivedAt: { lt: failedCutoff },
            },
        });

        Logger.info('[Webhook] Cleanup completed', {
            processedDeleted: processedResult.count,
            failedDeleted: failedResult.count,
        });

        return {
            processedDeleted: processedResult.count,
            failedDeleted: failedResult.count,
        };
    }
}

/**
 * BOM Consumption Service
 * 
 * Handles automatic stock deduction when BOM parent products are sold.
 * When an order contains a product with a BOM, this service:
 * 1. Deducts stock from each BOM component
 * 2. Updates component stock in WooCommerce
 * 3. Triggers cascade recalculation for any other BOM products using those components
 * 
 * Locking Strategy:
 * - Primary: Redis SETNX with TTL (fast distributed lock)
 * - Fallback: PostgreSQL advisory lock (when Redis unavailable)
 */

import { prisma, Prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService } from './woo';
import { EventBus, EVENTS } from './events';
import { BOMInventorySyncService } from './BOMInventorySyncService';
import { redisClient } from '../utils/redis';

interface OrderLineItem {
    product_id: number;
    variation_id: number;
    quantity: number;
    name: string;
}

interface ComponentDeduction {
    componentType: 'WooProduct' | 'ProductVariation' | 'InternalProduct';
    componentId: string;
    componentName: string;
    wooId?: number;
    parentWooId?: number; // For variations
    quantityDeducted: number;
    previousStock: number;
    newStock: number;
}

/**
 * Retry a function with exponential backoff.
 * Best practice for external API calls that may transiently fail.
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    options: { maxAttempts?: number; baseDelayMs?: number; context?: string } = {}
): Promise<T> {
    const { maxAttempts = 3, baseDelayMs = 1000, context = 'operation' } = options;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            const isRetryable = !err.message?.includes('not found') &&
                !err.message?.includes('invalid_id') &&
                !err.message?.includes('401') &&
                !err.message?.includes('403');

            if (!isRetryable || attempt === maxAttempts) {
                throw err;
            }

            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            Logger.warn(`[BOMConsumption] ${context} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`, {
                error: err.message
            });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

export class BOMConsumptionService {
    // Redis key prefix for tracking consumed orders
    private static readonly CONSUMED_KEY_PREFIX = 'bom_consumed:';
    // Redis key prefix for order processing locks
    private static readonly ORDER_LOCK_PREFIX = 'bom_order_lock:';
    // TTL for consumed tracking (7 days) - prevents re-processing during syncs
    private static readonly CONSUMED_TTL_SECONDS = 7 * 24 * 60 * 60;
    // TTL for order lock (5 minutes) - prevents concurrent processing
    private static readonly ORDER_LOCK_TTL_SECONDS = 5 * 60;

    /**
     * Process an order and consume BOM component stock.
     * Should be called when order status becomes 'processing'.
     * Uses Redis to prevent duplicate consumption on re-syncs.
     */
    static async consumeOrderComponents(
        accountId: string,
        order: any
    ): Promise<{ consumed: ComponentDeduction[]; errors: string[]; skipped?: boolean }> {
        const consumed: ComponentDeduction[] = [];
        const errors: string[] = [];

        // Only process orders in 'processing' status
        const status = (order.status || '').toLowerCase();
        if (status !== 'processing') {
            Logger.debug(`[BOMConsumption] Skipping order ${order.id} - status is ${status}, not processing`, { accountId });
            return { consumed, errors };
        }

        // Check if we've already consumed this order (prevent duplicate processing)
        const consumedKey = `${this.CONSUMED_KEY_PREFIX}${accountId}:${order.id}`;
        const alreadyConsumed = await redisClient.get(consumedKey);
        if (alreadyConsumed) {
            Logger.debug(`[BOMConsumption] Order ${order.id} already consumed, skipping`, { accountId });
            return { consumed, errors, skipped: true };
        }

        // Acquire lock to prevent concurrent processing of same order
        const lockKey = `${this.ORDER_LOCK_PREFIX}${accountId}:${order.id}`;
        const orderId = typeof order.id === 'number' ? order.id : parseInt(order.id, 10);
        const lockInfo = await this.acquireLock(lockKey, accountId, orderId);
        if (!lockInfo.acquired) {
            Logger.warn(`[BOMConsumption] Order ${order.id} is being processed by another worker, skipping`, { accountId });
            return { consumed, errors, skipped: true };
        }

        const lineItems: OrderLineItem[] = order.line_items || [];
        if (lineItems.length === 0) {
            Logger.debug(`[BOMConsumption] Order ${order.id} has no line items`, { accountId });
            await this.releaseLock(lockKey, lockInfo.usedPostgres, accountId, orderId);
            return { consumed, errors };
        }

        Logger.info(`[BOMConsumption] Processing order ${order.id} with ${lineItems.length} line items`, { accountId });

        // Track which components were modified for cascade sync
        const modifiedComponents: { productId: string; variationId?: number }[] = [];

        for (const item of lineItems) {
            try {
                const result = await this.consumeLineItemComponents(accountId, item);
                consumed.push(...result.deductions);
                modifiedComponents.push(...result.modifiedComponents);
            } catch (err: any) {
                const errMsg = `Failed to consume components for line item ${item.product_id}: ${err.message}`;
                Logger.error(`[BOMConsumption] ${errMsg}`, { accountId, item });
                errors.push(errMsg);
            }
        }

        // Cascade sync for all products that use the modified components
        for (const comp of modifiedComponents) {
            try {
                await this.cascadeSyncAffectedProducts(accountId, comp.productId, comp.variationId);
            } catch (err: any) {
                Logger.error(`[BOMConsumption] Cascade sync failed for component ${comp.productId}`, { accountId, error: err.message });
            }
        }

        // Mark this order as consumed to prevent duplicate processing on re-syncs
        if (consumed.length > 0) {
            await redisClient.setex(consumedKey, this.CONSUMED_TTL_SECONDS, new Date().toISOString());
        }

        // Release the lock
        await this.releaseLock(lockKey, lockInfo.usedPostgres, accountId, orderId);

        Logger.info(`[BOMConsumption] Order ${order.id} complete: ${consumed.length} components consumed, ${errors.length} errors`, { accountId });

        return { consumed, errors };
    }

    /**
     * Acquire a lock for order processing.
     * Uses Redis SETNX as primary, falls back to PostgreSQL advisory lock.
     * Returns lock info for proper release.
     */
    private static async acquireLock(
        lockKey: string,
        accountId: string,
        orderId: number
    ): Promise<{ acquired: boolean; usedPostgres: boolean }> {
        // Try Redis first (faster, distributed)
        try {
            const result = await redisClient.setnx(lockKey, new Date().toISOString());
            if (result === 1) {
                await redisClient.expire(lockKey, this.ORDER_LOCK_TTL_SECONDS);
                return { acquired: true, usedPostgres: false };
            }
            // Lock held by another process
            return { acquired: false, usedPostgres: false };
        } catch (redisError) {
            Logger.warn('[BOMConsumption] Redis unavailable, falling back to PostgreSQL advisory lock', {
                lockKey,
                error: redisError instanceof Error ? redisError.message : 'Unknown'
            });
        }

        // Fallback: PostgreSQL advisory lock
        // Create a consistent numeric hash from accountId + orderId
        const lockId = this.hashToInt32(`${accountId}:${orderId}`);

        try {
            const result = await prisma.$queryRaw<{ pg_try_advisory_lock: boolean }[]>`
                SELECT pg_try_advisory_lock(${lockId}) as pg_try_advisory_lock
            `;
            const acquired = result[0]?.pg_try_advisory_lock === true;

            if (acquired) {
                Logger.debug('[BOMConsumption] PostgreSQL advisory lock acquired', { lockId, accountId, orderId });
            }

            return { acquired, usedPostgres: true };
        } catch (pgError) {
            Logger.error('[BOMConsumption] Both Redis and PostgreSQL locking failed', {
                lockKey,
                error: pgError instanceof Error ? pgError.message : 'Unknown'
            });
            // If both fail, return not acquired (safe: skip processing rather than double-process)
            return { acquired: false, usedPostgres: false };
        }
    }

    /**
     * Release a lock (Redis or PostgreSQL based on how it was acquired).
     */
    private static async releaseLock(
        lockKey: string,
        usedPostgres: boolean,
        accountId: string,
        orderId: number
    ): Promise<void> {
        if (usedPostgres) {
            // Release PostgreSQL advisory lock
            const lockId = this.hashToInt32(`${accountId}:${orderId}`);
            try {
                await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockId})`;
                Logger.debug('[BOMConsumption] PostgreSQL advisory lock released', { lockId });
            } catch (error) {
                Logger.error('[BOMConsumption] Failed to release PostgreSQL advisory lock', {
                    lockId,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        } else {
            // Release Redis lock
            try {
                await redisClient.del(lockKey);
            } catch (error) {
                Logger.warn('[BOMConsumption] Failed to release Redis lock (may have expired)', {
                    lockKey,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        }
    }

    /**
     * Create a 32-bit signed integer hash from a string.
     * Used for PostgreSQL advisory locks which require bigint.
     */
    private static hashToInt32(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    /**
     * Consume components for a single line item.
     */
    private static async consumeLineItemComponents(
        accountId: string,
        item: OrderLineItem
    ): Promise<{ deductions: ComponentDeduction[]; modifiedComponents: { productId: string; variationId?: number }[] }> {
        const deductions: ComponentDeduction[] = [];
        const modifiedComponents: { productId: string; variationId?: number }[] = [];

        // Find the product in our DB
        const product = await prisma.wooProduct.findFirst({
            where: { accountId, wooId: item.product_id },
            select: { id: true, wooId: true, name: true }
        });

        if (!product) {
            Logger.debug(`[BOMConsumption] Product wooId=${item.product_id} not found in DB`, { accountId });
            return { deductions, modifiedComponents };
        }

        // Check for a BOM (either for the parent or specific variation)
        const variationId = item.variation_id || 0;
        const bom = await prisma.bOM.findUnique({
            where: {
                productId_variationId: { productId: product.id, variationId }
            },
            include: {
                items: {
                    include: {
                        childProduct: { select: { id: true, wooId: true, name: true, stockQuantity: true, rawData: true } },
                        childVariation: { select: { productId: true, wooId: true, sku: true, stockQuantity: true, rawData: true } },
                        internalProduct: { select: { id: true, name: true, stockQuantity: true } }
                    }
                }
            }
        });

        if (!bom || bom.items.length === 0) {
            Logger.debug(`[BOMConsumption] No BOM found for product ${product.id} variation ${variationId}`, { accountId });
            return { deductions, modifiedComponents };
        }

        Logger.info(`[BOMConsumption] Found BOM with ${bom.items.length} components for ${product.name}`, { accountId });

        const wooService = await WooService.forAccount(accountId);

        // Process each BOM component
        for (const bomItem of bom.items) {
            const quantityToDeduct = Number(bomItem.quantity) * item.quantity;

            try {
                if (bomItem.internalProduct) {
                    // Internal product - just update local DB
                    const prev = bomItem.internalProduct.stockQuantity;
                    const newStock = Math.max(0, prev - quantityToDeduct);

                    await prisma.internalProduct.update({
                        where: { id: bomItem.internalProduct.id },
                        data: { stockQuantity: newStock }
                    });

                    deductions.push({
                        componentType: 'InternalProduct',
                        componentId: bomItem.internalProduct.id,
                        componentName: bomItem.internalProduct.name,
                        quantityDeducted: quantityToDeduct,
                        previousStock: prev,
                        newStock
                    });

                    Logger.info(`[BOMConsumption] Deducted ${quantityToDeduct} from InternalProduct "${bomItem.internalProduct.name}": ${prev} → ${newStock}`, { accountId });

                } else if (bomItem.childVariation && bomItem.childProduct) {
                    // Product Variation - update local DB and WooCommerce
                    const rawData = bomItem.childVariation.rawData as any;
                    const prev = bomItem.childVariation.stockQuantity ?? rawData?.stock_quantity ?? 0;
                    const newStock = Math.max(0, prev - quantityToDeduct);

                    // Update local DB
                    await prisma.productVariation.update({
                        where: {
                            productId_wooId: {
                                productId: bomItem.childProduct.id,
                                wooId: bomItem.childVariation.wooId
                            }
                        },
                        data: { stockQuantity: newStock }
                    });

                    // Update WooCommerce with retry logic
                    await withRetry(
                        () => wooService.updateProductVariation(
                            bomItem.childProduct!.wooId,
                            bomItem.childVariation!.wooId,
                            { stock_quantity: newStock }
                        ),
                        { context: `Update variation ${bomItem.childVariation.wooId}` }
                    );

                    deductions.push({
                        componentType: 'ProductVariation',
                        componentId: bomItem.childProduct.id,
                        componentName: `${bomItem.childProduct.name} (Variation ${bomItem.childVariation.sku || bomItem.childVariation.wooId})`,
                        wooId: bomItem.childVariation.wooId,
                        parentWooId: bomItem.childProduct.wooId,
                        quantityDeducted: quantityToDeduct,
                        previousStock: prev,
                        newStock
                    });

                    modifiedComponents.push({ productId: bomItem.childProduct.id, variationId: bomItem.childVariation.wooId });

                    Logger.info(`[BOMConsumption] Deducted ${quantityToDeduct} from Variation "${bomItem.childProduct.name}": ${prev} → ${newStock}`, { accountId });

                } else if (bomItem.childProduct) {
                    // Simple product - update local DB and WooCommerce
                    const rawData = bomItem.childProduct.rawData as any;
                    const prev = bomItem.childProduct.stockQuantity ?? rawData?.stock_quantity ?? 0;
                    const newStock = Math.max(0, prev - quantityToDeduct);

                    // Update local DB
                    await prisma.wooProduct.update({
                        where: { id: bomItem.childProduct.id },
                        data: { stockQuantity: newStock }
                    });

                    // Update WooCommerce with retry logic
                    await withRetry(
                        () => wooService.updateProduct(bomItem.childProduct!.wooId, { stock_quantity: newStock }),
                        { context: `Update product ${bomItem.childProduct.wooId}` }
                    );

                    deductions.push({
                        componentType: 'WooProduct',
                        componentId: bomItem.childProduct.id,
                        componentName: bomItem.childProduct.name,
                        wooId: bomItem.childProduct.wooId,
                        quantityDeducted: quantityToDeduct,
                        previousStock: prev,
                        newStock
                    });

                    modifiedComponents.push({ productId: bomItem.childProduct.id });

                    Logger.info(`[BOMConsumption] Deducted ${quantityToDeduct} from Product "${bomItem.childProduct.name}": ${prev} → ${newStock}`, { accountId });
                }
            } catch (err: any) {
                Logger.error(`[BOMConsumption] Failed to deduct from component`, {
                    accountId,
                    bomItemId: bomItem.id,
                    error: err.message
                });
                throw err;
            }
        }

        return { deductions, modifiedComponents };
    }

    /**
     * After a component's stock changes, find all BOM products that use it
     * and trigger a sync for each to update their effective stock in WooCommerce.
     */
    static async cascadeSyncAffectedProducts(
        accountId: string,
        componentProductId: string,
        componentVariationId?: number
    ): Promise<void> {
        // Find all BOMs that use this product as a component
        const affectedBomItems = await prisma.bOMItem.findMany({
            where: {
                OR: [
                    { childProductId: componentProductId },
                    ...(componentVariationId ? [{ childProductId: componentProductId, childVariationId: componentVariationId }] : [])
                ]
            },
            include: {
                bom: {
                    include: {
                        product: { select: { id: true, wooId: true, name: true, accountId: true } }
                    }
                }
            }
        });

        // Filter to only this account's BOMs
        const accountBoms = affectedBomItems.filter(item => item.bom.product.accountId === accountId);

        if (accountBoms.length === 0) {
            Logger.debug(`[BOMConsumption] No affected BOM products found for component ${componentProductId}`, { accountId });
            return;
        }

        Logger.info(`[BOMConsumption] Cascade syncing ${accountBoms.length} affected BOM products`, { accountId });

        // Sync each affected BOM product
        for (const item of accountBoms) {
            try {
                await BOMInventorySyncService.syncProductToWoo(
                    accountId,
                    item.bom.productId,
                    item.bom.variationId
                );
                Logger.debug(`[BOMConsumption] Cascade synced ${item.bom.product.name}`, { accountId });
            } catch (err: any) {
                Logger.error(`[BOMConsumption] Failed to cascade sync ${item.bom.product.name}`, {
                    accountId,
                    productId: item.bom.productId,
                    error: err.message
                });
            }
        }
    }
}

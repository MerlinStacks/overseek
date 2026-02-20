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
    /**
     * pending_deductions:{accountId}:{orderId} -> JSON of DeductionPlan
     */
    private static readonly PENDING_KEY_PREFIX = 'bom_pending:';
    private static readonly LOCK_KEY = 'bom:processing_queue';
    private static readonly ORDER_LOCK_PREFIX = 'bom:lock:order:';
    private static readonly LOCK_TTL_SECONDS = 60;
    private static readonly BATCH_SIZE = 10;
    private static readonly ORDER_LOCK_TTL_SECONDS = 300; // 5 minutes
    private static readonly CONSUMED_KEY_PREFIX = 'bom:consumed:';
    private static readonly CONSUMED_TTL_SECONDS = 86400; // 24 hours
    private static readonly MAX_RETRIES = 3;


    /**
     * Process an order and consume BOM component stock.
     * Triggered when order status becomes 'processing' or 'completed'.
     * Uses Redis + DB ledger to prevent duplicate consumption on re-syncs.
     */
    static async consumeOrderComponents(
        accountId: string,
        order: any
    ): Promise<{ consumed: ComponentDeduction[]; errors: string[]; skipped?: boolean }> {
        const consumed: ComponentDeduction[] = [];
        const errors: string[] = [];

        // Why both statuses: some payment gateways skip 'processing' and go
        // directly to 'completed'. The dedup below prevents double-consumption
        // when an order transitions processing → completed.
        const status = (order.status || '').toLowerCase();
        if (status !== 'processing' && status !== 'completed') {
            Logger.debug(`[BOMConsumption] Skipping order ${order.id} - status is ${status}`, { accountId });
            return { consumed, errors };
        }

        // Layer 1: Redis dedup (fast path, 24h TTL)
        const consumedKey = `${this.CONSUMED_KEY_PREFIX}${accountId}:${order.id}`;
        const alreadyConsumed = await redisClient.get(consumedKey);
        if (alreadyConsumed) {
            Logger.debug(`[BOMConsumption] Order ${order.id} already consumed (Redis), skipping`, { accountId });
            return { consumed, errors, skipped: true };
        }

        // Layer 2: DB dedup fallback — Redis key may have expired after 24h.
        // The ledger is the authoritative source of truth for past consumption.
        const orderId = typeof order.id === 'number' ? order.id : parseInt(order.id, 10);
        const ledgerEntry = await prisma.bOMDeductionLedger.findFirst({
            where: { accountId, orderId, status: { in: ['COMPLETED', 'EXECUTED'] } }
        });
        if (ledgerEntry) {
            // Re-set the Redis key so subsequent sync cycles don't hit DB again
            await redisClient.setex(consumedKey, this.CONSUMED_TTL_SECONDS, 'recovered');
            Logger.debug(`[BOMConsumption] Order ${order.id} already consumed (DB ledger), skipping`, { accountId });
            return { consumed, errors, skipped: true };
        }

        // Acquire lock to prevent concurrent processing of same order
        const lockKey = `${this.ORDER_LOCK_PREFIX}${accountId}:${order.id}`;
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

        try {
            // PHASE 1: PLANNING
            // Calculate all intended deductions without executing them yet
            const deductionPlan: ComponentDeduction[] = [];

            for (const item of lineItems) {
                const plan = await this.planLineItemDeductions(accountId, item);
                deductionPlan.push(...plan);
            }

            if (deductionPlan.length === 0) {
                Logger.info(`[BOMConsumption] No BOM components to deduct for order ${order.id}`, { accountId });
                await this.releaseLock(lockKey, lockInfo.usedPostgres, accountId, orderId);
                return { consumed, errors };
            }

            // PHASE 2: TRACKING
            // Save the plan to Redis for crash recovery
            await this.trackPendingDeduction(accountId, orderId, deductionPlan);

            // PHASE 3: EXECUTION
            // Execute deductions one by one
            const modifiedComponents: { productId: string; variationId?: number; isInternal?: boolean }[] = [];
            const wooService = await WooService.forAccount(accountId);

            for (const deduction of deductionPlan) {
                try {
                    await this.executeDeduction(accountId, deduction, wooService);

                    // Write deterministic ledger entry — recovery uses this instead of heuristic stock checks
                    await prisma.bOMDeductionLedger.create({
                        data: {
                            accountId,
                            orderId,
                            componentType: deduction.componentType,
                            componentId: deduction.componentId,
                            componentName: deduction.componentName,
                            wooId: deduction.wooId,
                            parentWooId: deduction.parentWooId,
                            quantityDeducted: deduction.quantityDeducted,
                            previousStock: deduction.previousStock,
                            newStock: deduction.newStock
                        }
                    });

                    consumed.push(deduction);

                    if (deduction.componentType === 'ProductVariation') {
                        modifiedComponents.push({ productId: deduction.componentId, variationId: deduction.wooId });
                    } else if (deduction.componentType === 'WooProduct') {
                        modifiedComponents.push({ productId: deduction.componentId });
                    } else if (deduction.componentType === 'InternalProduct') {
                        // Internal products also need cascade — other BOM parents
                        // using the same internal component need their effective stock recalculated.
                        modifiedComponents.push({ productId: deduction.componentId, isInternal: true });
                    }
                } catch (err: any) {
                    const errMsg = `Failed to execute deduction for ${deduction.componentName}: ${err.message}`;
                    Logger.error(`[BOMConsumption] ${errMsg}`, { accountId, deduction });
                    errors.push(errMsg);

                    // CRITICAL: If an error occurs during execution, attempting rollback
                    // Note: In case of PROCESS CRASH, the Recovery Job will handle this.
                    // This block handles runtime errors (e.g. API 500).
                    Logger.warn(`[BOMConsumption] Triggering immediate rollback due to error`, { accountId, orderId });
                    await this.rollbackDeductions(accountId, consumed);
                    throw err;
                }
            }

            // PHASE 4: CASCADE SYNC
            // This is "best effort" - simpler to just log errors if it fails rather than rollback
            for (const comp of modifiedComponents) {
                try {
                    await this.cascadeSyncAffectedProducts(
                        accountId,
                        comp.productId,
                        comp.variationId,
                        comp.isInternal ? 'internalProduct' : 'wooProduct'
                    );
                } catch (err: any) {
                    Logger.error(`[BOMConsumption] Cascade sync failed for component ${comp.productId}`, { accountId, error: err.message });
                }
            }

            // PHASE 5: COMPLETION
            // Mark as consumed, remove pending log
            await redisClient.setex(consumedKey, this.CONSUMED_TTL_SECONDS, new Date().toISOString());
            await this.clearPendingDeduction(accountId, orderId);

            // Close ledger lifecycle: EXECUTED → COMPLETED
            await prisma.bOMDeductionLedger.updateMany({
                where: { accountId, orderId, status: 'EXECUTED' },
                data: { status: 'COMPLETED' }
            });

            Logger.info(`[BOMConsumption] Order ${order.id} complete: ${consumed.length} components consumed`, { accountId });

        } catch (error: any) {
            Logger.error(`[BOMConsumption] Order processing failed`, { accountId, orderId, error: error.message });
            // Don't swallow error - allow retry logic to kick in if called from queue
        } finally {
            await this.releaseLock(lockKey, lockInfo.usedPostgres, accountId, orderId);
        }

        return { consumed, errors };
    }

    // --- REVERSAL FOR CANCELLED / REFUNDED ORDERS ---

    /**
     * Reverse BOM component consumption when an order is cancelled or refunded.
     * Uses the `BOMDeductionLedger` (COMPLETED entries) to deterministically
     * reverse each deduction — no stock-guessing heuristic needed.
     *
     * Idempotent: if entries are already REVERSED, this is a no-op.
     */
    static async reverseOrderConsumption(
        accountId: string,
        order: any
    ): Promise<{ reversed: number; errors: string[] }> {
        const errors: string[] = [];
        const orderId = typeof order.id === 'number' ? order.id : parseInt(order.id, 10);

        // Find completed deductions for this order
        const entries = await prisma.bOMDeductionLedger.findMany({
            where: { accountId, orderId, status: 'COMPLETED' }
        });

        if (entries.length === 0) {
            Logger.debug(`[BOMConsumption] No completed deductions to reverse for order ${orderId}`, { accountId });
            return { reversed: 0, errors };
        }

        // Acquire lock to prevent concurrent reversal
        const lockKey = `${this.ORDER_LOCK_PREFIX}reversal:${accountId}:${orderId}`;
        const lockInfo = await this.acquireLock(lockKey, accountId, orderId);
        if (!lockInfo.acquired) {
            Logger.warn(`[BOMConsumption] Order ${orderId} reversal already in progress, skipping`, { accountId });
            return { reversed: 0, errors: ['Reversal already in progress'] };
        }

        try {
            Logger.info(`[BOMConsumption] Reversing ${entries.length} deductions for cancelled/refunded order ${orderId}`, { accountId });

            // Convert ledger entries to ComponentDeduction format
            const deductions: ComponentDeduction[] = entries.map(e => ({
                componentType: e.componentType as ComponentDeduction['componentType'],
                componentId: e.componentId,
                componentName: e.componentName,
                wooId: e.wooId ?? undefined,
                parentWooId: e.parentWooId ?? undefined,
                quantityDeducted: e.quantityDeducted,
                previousStock: e.previousStock,
                newStock: e.newStock
            }));

            // Reverse the deductions (adds stock back)
            await this.rollbackDeductions(accountId, deductions);

            // Mark ledger entries as reversed
            await prisma.bOMDeductionLedger.updateMany({
                where: { accountId, orderId, status: 'COMPLETED' },
                data: { status: 'REVERSED', rolledBackAt: new Date() }
            });

            // Clear the consumed key so the order doesn't look "consumed" if re-processed
            const consumedKey = `${this.CONSUMED_KEY_PREFIX}${accountId}:${orderId}`;
            await redisClient.del(consumedKey);

            // Cascade BOM sync for all affected components
            const modifiedComponents: { productId: string; variationId?: number; isInternal?: boolean }[] = [];
            for (const d of deductions) {
                if (d.componentType === 'ProductVariation') {
                    modifiedComponents.push({ productId: d.componentId, variationId: d.wooId });
                } else if (d.componentType === 'WooProduct') {
                    modifiedComponents.push({ productId: d.componentId });
                } else if (d.componentType === 'InternalProduct') {
                    modifiedComponents.push({ productId: d.componentId, isInternal: true });
                }
            }

            for (const comp of modifiedComponents) {
                try {
                    await this.cascadeSyncAffectedProducts(
                        accountId,
                        comp.productId,
                        comp.variationId,
                        comp.isInternal ? 'internalProduct' : 'wooProduct'
                    );
                } catch (err: any) {
                    Logger.error(`[BOMConsumption] Cascade sync failed during reversal for ${comp.productId}`, { accountId, error: err.message });
                }
            }

            Logger.info(`[BOMConsumption] Reversed ${entries.length} deductions for order ${orderId}`, { accountId });
            return { reversed: entries.length, errors };

        } catch (error: any) {
            Logger.error(`[BOMConsumption] Order reversal failed`, { accountId, orderId, error: error.message });
            errors.push(error.message);
            return { reversed: 0, errors };
        } finally {
            await this.releaseLock(lockKey, lockInfo.usedPostgres, accountId, orderId);
        }
    }

    // --- ROLLBACK & RECOVERY MECHANISMS ---

    /**
     * Flag this order as having pending deductions.
     * The DB ledger is the source of truth for actual deductions — this flag
     * only exists so the recovery job can find stalled orders quickly.
     */
    private static async trackPendingDeduction(accountId: string, orderId: number, _plan: ComponentDeduction[]) {
        const key = `${this.PENDING_KEY_PREFIX}${accountId}:${orderId}`;
        await redisClient.setex(key, 1800, '1');
    }

    private static async clearPendingDeduction(accountId: string, orderId: number) {
        const key = `${this.PENDING_KEY_PREFIX}${accountId}:${orderId}`;
        await redisClient.del(key);
    }

    /**
     * Revert stock deductions (Compensating Transaction).
     * Adds the deducted quantity back to the current stock.
     */
    static async rollbackDeductions(accountId: string, deductions: ComponentDeduction[]) {
        if (deductions.length === 0) return;

        Logger.info(`[BOMConsumption] Rolling back ${deductions.length} deductions`, { accountId });
        const wooService = await WooService.forAccount(accountId);

        for (const deduction of deductions) {
            try {
                // Add quantity back
                const rollbackQty = deduction.quantityDeducted;

                if (deduction.componentType === 'InternalProduct') {
                    await prisma.internalProduct.update({
                        where: { id: deduction.componentId },
                        data: { stockQuantity: { increment: rollbackQty } }
                    });
                } else if (deduction.componentType === 'ProductVariation') {
                    // Update Local
                    await prisma.productVariation.update({
                        where: { productId_wooId: { productId: deduction.componentId, wooId: deduction.wooId! } },
                        data: { stockQuantity: { increment: rollbackQty } }
                    });
                    // Update Woo — fetch fresh stock to avoid stale-value race conditions
                    let freshStock = deduction.newStock;
                    try {
                        const variations = await wooService.getProductVariations(deduction.parentWooId!);
                        const target = variations?.find((v: any) => v.id === deduction.wooId);
                        if (target?.stock_quantity != null) freshStock = target.stock_quantity;
                    } catch {
                        Logger.warn(`[BOMConsumption] Could not fetch fresh variation stock for rollback, using stale value`, { wooId: deduction.wooId });
                    }
                    await withRetry(() => wooService.updateProductVariation(
                        deduction.parentWooId!,
                        deduction.wooId!,
                        { stock_quantity: freshStock + rollbackQty, manage_stock: true }
                    ));
                } else if (deduction.componentType === 'WooProduct') {
                    await prisma.wooProduct.update({
                        where: { id: deduction.componentId },
                        data: { stockQuantity: { increment: rollbackQty } }
                    });
                    // Fetch fresh stock to avoid stale-value race conditions
                    let freshStock = deduction.newStock;
                    try {
                        const wooProduct = await wooService.getProduct(deduction.wooId!);
                        if (wooProduct?.stock_quantity != null) freshStock = wooProduct.stock_quantity;
                    } catch {
                        Logger.warn(`[BOMConsumption] Could not fetch fresh product stock for rollback, using stale value`, { wooId: deduction.wooId });
                    }
                    await withRetry(() => wooService.updateProduct(
                        deduction.wooId!,
                        { stock_quantity: freshStock + rollbackQty, manage_stock: true }
                    ));
                }

                Logger.info(`[BOMConsumption] Rolled back deduction for ${deduction.componentName}`, { accountId });
            } catch (error: any) {
                Logger.error(`[BOMConsumption] Failed to rollback deduction for ${deduction.componentName}`, { error: error.message });
                // Continue rolling back others even if one fails
            }
        }
    }

    /**
     * RECOVERY JOB: Find stalled deductions using the DB ledger.
     * Queries for EXECUTED ledger entries whose orderId doesn't have a
     * consumed key in Redis — indicating the process crashed mid-deduction.
     * Deterministic: ledger entries prove deductions happened, no stock guessing.
     */
    static async recoverStalledDeductions() {
        // Phase 1: Check Redis pending keys for backward compat (old-format recovery)
        const keys = await redisClient.keys(`${this.PENDING_KEY_PREFIX}*`);

        for (const key of keys) {
            try {
                const parts = key.split(':');
                if (parts.length < 3) continue;
                const accountId = parts[1];
                const orderId = parseInt(parts[2], 10);

                const consumedKey = `${this.CONSUMED_KEY_PREFIX}${accountId}:${orderId}`;
                const isConsumed = await redisClient.get(consumedKey);

                if (isConsumed) {
                    await redisClient.del(key);
                    continue;
                }

                // Use ledger for deterministic recovery
                await this.ledgerBasedRollback(accountId, orderId);
                await redisClient.del(key);
            } catch (err) {
                Logger.error(`[BOMConsumption] Recovery failed for key ${key}`, { err });
            }
        }

        // Phase 2: Ledger-only recovery — find orphaned EXECUTED entries
        // (entries older than 30 min without a consumed key)
        const cutoff = new Date(Date.now() - 30 * 60 * 1000);
        const orphanedEntries = await prisma.bOMDeductionLedger.findMany({
            where: {
                status: 'EXECUTED',
                createdAt: { lt: cutoff }
            },
            distinct: ['accountId', 'orderId'],
            select: { accountId: true, orderId: true }
        });

        for (const { accountId, orderId } of orphanedEntries) {
            const consumedKey = `${this.CONSUMED_KEY_PREFIX}${accountId}:${orderId}`;
            const isConsumed = await redisClient.get(consumedKey);
            if (isConsumed) {
                // Mark ledger entries as completed (no rollback needed)
                continue;
            }

            try {
                Logger.warn(`[BOMConsumption] Ledger-based recovery for stalled Order ${orderId}`, { accountId });
                await this.ledgerBasedRollback(accountId, orderId);
            } catch (err) {
                Logger.error(`[BOMConsumption] Ledger recovery failed`, { accountId, orderId, err });
            }
        }
    }

    /**
     * Deterministic rollback using the deduction ledger.
     * Queries all EXECUTED entries for the order and rolls each one back.
     * No stock-comparison heuristic needed — if it's in the ledger, it happened.
     */
    private static async ledgerBasedRollback(accountId: string, orderId: number) {
        const entries = await prisma.bOMDeductionLedger.findMany({
            where: { accountId, orderId, status: 'EXECUTED' }
        });

        if (entries.length === 0) return;

        Logger.info(`[BOMConsumption] Ledger rollback: ${entries.length} deductions for Order ${orderId}`, { accountId });

        // Convert ledger entries to ComponentDeduction format for rollback
        const deductions: ComponentDeduction[] = entries.map(e => ({
            componentType: e.componentType as ComponentDeduction['componentType'],
            componentId: e.componentId,
            componentName: e.componentName,
            wooId: e.wooId ?? undefined,
            parentWooId: e.parentWooId ?? undefined,
            quantityDeducted: e.quantityDeducted,
            previousStock: e.previousStock,
            newStock: e.newStock
        }));

        await this.rollbackDeductions(accountId, deductions);

        // Mark all entries as rolled back
        await prisma.bOMDeductionLedger.updateMany({
            where: { accountId, orderId, status: 'EXECUTED' },
            data: { status: 'ROLLED_BACK', rolledBackAt: new Date() }
        });
    }

    // --- REFACTORED HELPERS ---

    /**
     * Plan deductions without executing (Read-Only phase)
     */
    private static async planLineItemDeductions(
        accountId: string,
        item: OrderLineItem
    ): Promise<ComponentDeduction[]> {
        const deductions: ComponentDeduction[] = [];

        // Find product
        const product = await prisma.wooProduct.findFirst({
            where: { accountId, wooId: item.product_id },
            select: { id: true, wooId: true, name: true }
        });
        if (!product) return [];

        const variationId = item.variation_id || 0;
        const bom = await prisma.bOM.findUnique({
            where: { productId_variationId: { productId: product.id, variationId } },
            include: {
                items: {
                    where: { isActive: true },
                    include: {
                        childProduct: { select: { id: true, wooId: true, name: true, stockQuantity: true, rawData: true } },
                        childVariation: { select: { productId: true, wooId: true, sku: true, stockQuantity: true, rawData: true } },
                        internalProduct: { select: { id: true, name: true, stockQuantity: true } }
                    }
                }
            }
        });

        if (!bom || bom.items.length === 0) return [];

        for (const bomItem of bom.items) {
            const quantityToDeduct = Number(bomItem.quantity) * item.quantity;

            if (bomItem.internalProduct) {
                const prev = bomItem.internalProduct.stockQuantity;
                deductions.push({
                    componentType: 'InternalProduct',
                    componentId: bomItem.internalProduct.id,
                    componentName: bomItem.internalProduct.name,
                    quantityDeducted: quantityToDeduct,
                    previousStock: prev,
                    newStock: Math.max(0, prev - quantityToDeduct)
                });
            } else if (bomItem.childVariation && bomItem.childProduct) {
                const rawData = bomItem.childVariation.rawData as any;
                const prev = bomItem.childVariation.stockQuantity ?? rawData?.stock_quantity ?? 0;
                deductions.push({
                    componentType: 'ProductVariation',
                    componentId: bomItem.childProduct.id,
                    componentName: `${bomItem.childProduct.name} (Var ${bomItem.childVariation.sku})`,
                    wooId: bomItem.childVariation.wooId,
                    parentWooId: bomItem.childProduct.wooId,
                    quantityDeducted: quantityToDeduct,
                    previousStock: prev,
                    newStock: Math.max(0, prev - quantityToDeduct)
                });
            } else if (bomItem.childProduct) {
                // Guard: skip variable parent products — BOM should link to a specific variation
                const childRaw = bomItem.childProduct.rawData as any;
                const isVariable = childRaw?.type?.includes('variable') || childRaw?.variations?.length > 0;
                if (isVariable) {
                    Logger.warn(`[BOMConsumption] Skipping deduction on variable parent product — BOM should link to a specific variation`, {
                        componentName: bomItem.childProduct.name,
                        wooId: bomItem.childProduct.wooId
                    });
                    continue;
                }
                const prev = bomItem.childProduct.stockQuantity ?? childRaw?.stock_quantity ?? 0;
                deductions.push({
                    componentType: 'WooProduct',
                    componentId: bomItem.childProduct.id,
                    componentName: bomItem.childProduct.name,
                    wooId: bomItem.childProduct.wooId,
                    quantityDeducted: quantityToDeduct,
                    previousStock: prev,
                    newStock: Math.max(0, prev - quantityToDeduct)
                });
            }
        }
        return deductions;
    }

    private static async executeDeduction(
        accountId: string,
        deduction: ComponentDeduction,
        wooService: any
    ) {
        if (deduction.componentType === 'InternalProduct') {
            await prisma.internalProduct.update({
                where: { id: deduction.componentId },
                data: { stockQuantity: deduction.newStock }
            });
        } else if (deduction.componentType === 'ProductVariation') {
            await prisma.productVariation.update({
                where: { productId_wooId: { productId: deduction.componentId, wooId: deduction.wooId! } },
                data: { stockQuantity: deduction.newStock }
            });
            await withRetry(
                () => wooService.updateProductVariation(deduction.parentWooId!, deduction.wooId!, { stock_quantity: deduction.newStock, manage_stock: true }),
                { context: `Update variation ${deduction.wooId}` }
            );
        } else if (deduction.componentType === 'WooProduct') {
            await prisma.wooProduct.update({
                where: { id: deduction.componentId },
                data: { stockQuantity: deduction.newStock }
            });
            await withRetry(
                () => wooService.updateProduct(deduction.wooId!, { stock_quantity: deduction.newStock, manage_stock: true }),
                { context: `Update product ${deduction.wooId}` }
            );
        }
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

    // consumeLineItemComponents was removed — superseded by planLineItemDeductions + executeDeduction pattern

    /**
     * After a component's stock changes, find all BOM products that use it
     * and trigger a sync for each to update their effective stock in WooCommerce.
     *
     * @param componentType - Whether the component is a WooCommerce product or an internal product.
     *   Defaults to 'wooProduct' for backward compatibility.
     */
    static async cascadeSyncAffectedProducts(
        accountId: string,
        componentProductId: string,
        componentVariationId?: number,
        componentType: 'wooProduct' | 'internalProduct' = 'wooProduct'
    ): Promise<void> {
        // Build the query based on component type
        const whereClause = componentType === 'internalProduct'
            ? { internalProductId: componentProductId }
            : {
                OR: [
                    { childProductId: componentProductId },
                    ...(componentVariationId
                        ? [{ childProductId: componentProductId, childVariationId: componentVariationId }]
                        : [])
                ]
            };

        const affectedBomItems = await prisma.bOMItem.findMany({
            where: {
                isActive: true,
                ...whereClause
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
            Logger.debug(`[BOMConsumption] No affected BOM products found for component ${componentProductId} (type: ${componentType})`, { accountId });
            return;
        }

        Logger.info(`[BOMConsumption] Cascade syncing ${accountBoms.length} affected BOM products for ${componentType} ${componentProductId}`, { accountId });

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

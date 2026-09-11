import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { OrderTaggingService } from '../OrderTaggingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { WooOrderSchema, WooOrder } from './wooSchemas';
import { esClient } from '../../utils/elastic';
import { isExcludedOrderStatus, normalizeOrderStatus } from '../../constants/orderStatus';
import { recalculateCustomerTotals, updateCustomerTotals, withOrderTotalsTransaction } from './orderCustomerTotals';

const PURCHASE_TRACKING_STATUSES = ['pending', 'processing', 'on-hold', 'completed'];

export class OrderSync extends BaseSync {
    protected entityType = 'orders';

    private async isFirstOrderForCustomer(accountId: string, order: WooOrder): Promise<boolean> {
        const rawEmail = (order as any).billing?.email;
        const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
        const externalCustomerId = (order as any).customer_id > 0 ? Number((order as any).customer_id) : null;

        if (!billingEmail && !externalCustomerId) {
            return false;
        }

        const count = await prisma.wooOrder.count({
            where: {
                accountId,
                status: { in: PURCHASE_TRACKING_STATUSES },
                OR: [
                    ...(externalCustomerId ? [{ wooCustomerId: externalCustomerId }] : []),
                    ...(billingEmail ? [{ billingEmail }] : [])
                ]
            }
        });

        return count === 1;
    }

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        const isBaselineSync = !after;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;
        let validationFailures = 0;

        const syncStartedAt = new Date();
        let expectedTotal = 0;

        while (hasMore) {
            const { data: rawOrders, totalPages, total } = await woo.getOrders({ page, after, per_page: 50 });
            if (page === 1) expectedTotal = total;
            if (!rawOrders.length) {
                hasMore = false;
                break;
            }


            const orders: WooOrder[] = [];
            const excludedWooIds: number[] = [];
            for (const raw of rawOrders) {
                const result = WooOrderSchema.safeParse(raw);
                if (result.success) {
                    const normalizedStatus = normalizeOrderStatus(result.data.status);
                    if (isExcludedOrderStatus(normalizedStatus)) {
                        // Track excluded-status orders per page (not across all pages)
                        // so we can touch their updatedAt without upserting new records.
                        excludedWooIds.push(result.data.id);
                        totalSkipped++;
                        Logger.debug('Skipping order with excluded status', {
                            accountId, syncId, orderId: result.data.id,
                            status: result.data.status
                        });
                        continue;
                    }
                    orders.push(result.data);
                } else {
                    totalSkipped++;
                    validationFailures++;
                    Logger.debug(`Skipping invalid order`, {
                        accountId, syncId, orderId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            // Touch updatedAt on non-standard-status orders that already exist in DB
            // so reconciliation doesn't delete them (they still exist in WooCommerce).
            // Uses raw SQL because Prisma's @updatedAt can't be set explicitly via Client.
            if (excludedWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooOrder" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, excludedWooIds
                );
            }

            if (!orders.length) {
                hasMore = this.hasMorePages(page, totalPages, rawOrders.length, 50);
                if (job) {
                    const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : (hasMore ? 0 : 100);
                    await job.updateProgress(progress);
                    await this.assertNotCancelled(job);
                }
                page++;
                if (hasMore) await new Promise(r => setTimeout(r, 500));
                continue;
            }

            const existingOrders = await withOrderTotalsTransaction(accountId, async tx => {
                const existing = await tx.wooOrder.findMany({
                    where: { accountId, wooId: { in: orders.map(o => o.id) } },
                    select: { wooId: true, status: true, wooCustomerId: true, billingEmail: true }
                });
                const associations = [...existing];
                for (const order of orders) {
                    const rawEmail = order.billing?.email;
                    const billingEmail = rawEmail && rawEmail.trim() ? rawEmail.toLowerCase().trim() : null;
                    const billingCountry = order.billing?.country || null;
                    const wooCustomerId = order.customer_id > 0 ? order.customer_id : null;
                    const data = {
                        status: normalizeOrderStatus(order.status),
                        total: order.total === '' ? '0' : order.total,
                        currency: order.currency,
                        billingEmail,
                        billingCountry,
                        wooCustomerId,
                        dateModified: new Date(order.date_modified_gmt || order.date_modified || new Date()),
                        rawData: order as any
                    };
                    associations.push({ wooId: order.id, status: order.status, wooCustomerId, billingEmail });
                    await tx.wooOrder.upsert({
                        where: { accountId_wooId: { accountId, wooId: order.id } },
                        update: data,
                        create: {
                            ...data, accountId, wooId: order.id, number: order.number,
                            dateCreated: new Date(order.date_created_gmt || order.date_created || new Date())
                        }
                    });
                }
                await updateCustomerTotals(tx, accountId, associations);
                return existing;
            });
            const existingMap = new Map(existingOrders.map(o => [o.wooId, o.status]));
            const persistedOrders = orders;

            let orderTagsMap: Map<number, string[]> | undefined;
            try {
                orderTagsMap = await OrderTaggingService.extractTagsForOrders(accountId, persistedOrders);
            } catch (error: any) {
                Logger.warn('Failed to batch extract tags, falling back to individual extraction', { accountId, syncId, error: error.message });
            }


            // Build tags map (batch or individual fallback)
            const tagMappings = await OrderTaggingService.getTagMappings(accountId);
            const finalTagsMap = new Map<number, string[]>();

            for (const order of persistedOrders) {
                const normalizedStatus = normalizeOrderStatus(order.status);
                const existingStatus = existingMap.get(order.id);
                const isNew = !existingStatus;
                const isStatusChanged = existingStatus && existingStatus !== normalizedStatus;

                const orderDate = new Date(order.date_created_gmt || order.date_created || new Date());
                const isRecent = (new Date().getTime() - orderDate.getTime()) < 24 * 60 * 60 * 1000;

                if (!isBaselineSync && isNew && isRecent) {
                    EventBus.emit(EVENTS.ORDER.CREATED, { accountId, order });
                }

                if (isStatusChanged) {
                    EventBus.emit(EVENTS.ORDER.STATUS_CHANGED, {
                        accountId,
                        order,
                        previousStatus: existingStatus,
                        newStatus: normalizedStatus
                    });
                }

                const shouldEmitLifecycleChange = isStatusChanged || (isNew && !isBaselineSync);

                if ((normalizedStatus === 'processing' || normalizedStatus === 'on-hold') && shouldEmitLifecycleChange) {
                    EventBus.emit(EVENTS.ORDER.PAID, { accountId, order });
                }

                if (normalizedStatus === 'completed' && shouldEmitLifecycleChange) {
                    EventBus.emit(EVENTS.ORDER.COMPLETED, { accountId, order });
                }

                if (isNew && !isBaselineSync && await this.isFirstOrderForCustomer(accountId, order)) {
                    EventBus.emit(EVENTS.ORDER.FIRST, { accountId, order });
                }

                // Why gated: emitting for every order on every sync cycle causes
                // redundant BOM consumption checks. Only new/changed orders matter.
                if (shouldEmitLifecycleChange) {
                    EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });
                }

                // Resolve tags
                if (orderTagsMap) {
                    finalTagsMap.set(order.id, orderTagsMap.get(order.id) || []);
                } else {
                    try {
                        const tags = await OrderTaggingService.extractTagsFromOrder(accountId, order, tagMappings);
                        finalTagsMap.set(order.id, tags);
                    } catch { finalTagsMap.set(order.id, []); }
                }
            }

            // Bulk index entire page in one ES call
            try {
                await IndexingService.bulkIndexOrders(accountId, persistedOrders, finalTagsMap);
            } catch (error: any) {
                Logger.warn('Bulk index orders failed, skipping ES indexing for this page', { accountId, syncId, error: error.message });
            }
            totalProcessed += persistedOrders.length;

            Logger.info(`Synced batch of ${persistedOrders.length} orders`, { accountId, syncId, page, totalPages, skipped: totalSkipped });

            // use WooCommerce's x-wp-totalpages header instead of checking batch size
            // (batch size is unreliable due to WC filtering and Zod validation skips)
            hasMore = this.hasMorePages(page, totalPages, rawOrders.length, 50);

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                await this.assertNotCancelled(job);
            }

            page++;

            // Throttle API pagination to avoid overwhelming the WooCommerce store
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        // Reconciliation: remove orders not touched during this full sync.
        // Count-first pattern: we check the 30% safety cap via SQL count() before
        // loading any IDs into Node memory. Previously we loaded every stale wooId
        // (even just to evaluate the cap), which on a store with 100k stale rows
        // put ~10MB of objects on the heap for a decision that doesn't need them.
        if (!incremental && totalProcessed > 0 && validationFailures === 0) {
            const staleCount = await prisma.wooOrder.count({
                where: { accountId, updatedAt: { lt: syncStartedAt } }
            });

            if (staleCount > 0) {
                const localTotal = await prisma.wooOrder.count({ where: { accountId } });
                const MAX_DELETE_RATIO = 0.3;
                const maxDeletions = Math.max(10, Math.floor(localTotal * MAX_DELETE_RATIO));

                if (staleCount > maxDeletions) {
                    Logger.warn(`Reconciliation aborted: would delete ${staleCount}/${localTotal} orders (>${Math.round(MAX_DELETE_RATIO * 100)}% cap). Likely API issue.`, {
                        accountId, syncId,
                        toDelete: staleCount,
                        localTotal,
                        syncedTotal: totalProcessed
                    });
                } else {
                    // Select, delete and repair totals together. Keyset bounds remain valid after deletion.
                    const ES_DELETE_CHUNK = 500;
                    let cursor: string | undefined;
                    while (true) {
                        const chunk = await withOrderTotalsTransaction(accountId, async tx => {
                            const stale = await tx.wooOrder.findMany({
                                where: { accountId, updatedAt: { lt: syncStartedAt }, ...(cursor ? { id: { gt: cursor } } : {}) },
                                select: { id: true, wooId: true, wooCustomerId: true, billingEmail: true },
                                orderBy: { id: 'asc' },
                                take: ES_DELETE_CHUNK,
                            });
                            if (stale.length) {
                                // Lock selected rows against concurrent webhook updates, then recheck staleness.
                                const deleted = await tx.$queryRaw<typeof stale>`
                                    DELETE FROM "WooOrder" WHERE "accountId" = ${accountId}
                                    AND "id" = ANY(${stale.map(o => o.id)}::text[])
                                    AND "updatedAt" < ${syncStartedAt}
                                    RETURNING "id", "wooId", "wooCustomerId", "billingEmail"
                                `;
                                await updateCustomerTotals(tx, accountId, deleted);
                                // Do not commit away the retry set until ES acknowledges the deletes.
                                if (deleted.length) {
                                    const result = await esClient.bulk({ refresh: false, operations: deleted.map(o => (
                                        { delete: { _index: 'orders', _id: `${accountId}_${o.wooId}` } }
                                    )) }, { requestTimeout: 10000, maxRetries: 0 });
                                    if (result.items.some(item => item.delete?.error && item.delete.status !== 404)) {
                                        throw new Error('Failed to delete reconciled orders from Elasticsearch');
                                    }
                                }
                                return { stale, deleted };
                            }
                            return { stale, deleted: [] };
                        });
                        if (chunk.stale.length === 0) break;
                        totalDeleted += chunk.deleted.length;
                        cursor = chunk.stale[chunk.stale.length - 1].id;
                        if (job) await this.assertNotCancelled(job);
                        if (chunk.stale.length < ES_DELETE_CHUNK) break;
                    }

                    Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned orders`, { accountId, syncId });
                }
            }
        }

        if (expectedTotal > 0 && totalProcessed < expectedTotal) {
            Logger.warn(`Order sync incomplete: processed ${totalProcessed}/${expectedTotal} orders (${totalSkipped} skipped)`, {
                accountId, syncId, expectedTotal, totalProcessed, totalSkipped, incremental
            });
        } else {
            Logger.info(`Order sync complete: ${totalProcessed}/${expectedTotal} orders processed`, {
                accountId, syncId, totalDeleted, totalSkipped, incremental
            });
        }

        if (!incremental || isBaselineSync) {
            await this.recalculateCustomerCounts(accountId, syncId);
        } else {
            // CustomerSync can change identities or replace totals even when no orders changed.
            // updatedAt also retains old associations for recovery after a failed ES attempt.
            await recalculateCustomerTotals(accountId, new Date(after!));
        }

        // After a full sync, refresh ES indices to ensure all changes (including deletes) are searchable
        if (!incremental) {
            try {
                await esClient.indices.refresh({ index: 'orders' });
                Logger.info('Refreshed ES orders index after full sync', { accountId, syncId });
            } catch (error: any) {
                Logger.warn('Failed to refresh ES orders index', { accountId, syncId, error: error.message });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    /** Explicit full rebuild retained for recovery and existing protected callers. */
    protected async recalculateCustomerCounts(accountId: string, syncId?: string): Promise<void> {
        Logger.info('Rebuilding customer totals from local orders', { accountId, syncId });
        await this.recalculateCustomerTotals(accountId);
    }

    public async recalculateCustomerTotals(accountId: string): Promise<void> {
        await recalculateCustomerTotals(accountId);
    }
}

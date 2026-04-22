import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { Logger } from '../../utils/logger';
import { WooCustomerSchema, WooCustomer } from './wooSchemas';


export class CustomerSync extends BaseSync {
    protected entityType = 'customers';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        const syncStartedAt = new Date();

        while (hasMore) {
            // Optimized: Increased page size from 25 to 100 for fewer API round-trips
            const { data: rawCustomers, totalPages } = await woo.getCustomers({ page, after, per_page: 100 });
            if (!rawCustomers.length) {
                hasMore = false;
                break;
            }

            // Validate customers with Zod schema
            const customers: WooCustomer[] = [];
            for (const raw of rawCustomers) {
                const result = WooCustomerSchema.safeParse(raw);
                if (result.success) {
                    customers.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.debug(`Skipping invalid customer`, {
                        accountId, syncId, customerId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!customers.length) {
                page++;
                continue;
            }

            // Optimized: Batch upserts in transactions of 50 for better throughput
            const BATCH_SIZE = 50;
            const failedWooIds: number[] = [];
            for (let i = 0; i < customers.length; i += BATCH_SIZE) {
                const batch = customers.slice(i, i + BATCH_SIZE);

                // Execute batch upserts concurrently (no transaction — each upsert is idempotent)
                await Promise.all(
                    batch.map((c) =>
                        prisma.wooCustomer.upsert({
                            where: { accountId_wooId: { accountId, wooId: c.id } },
                            update: {
                                totalSpent: c.total_spent ?? 0,
                                ordersCount: c.orders_count ?? 0,
                                rawData: c as any
                            },
                            create: {
                                accountId,
                                wooId: c.id,
                                email: c.email,
                                firstName: c.first_name,
                                lastName: c.last_name,
                                totalSpent: c.total_spent ?? 0,
                                ordersCount: c.orders_count ?? 0,
                                rawData: c as any
                            }
                        }).catch((err) => {
                            totalSkipped++;
                            failedWooIds.push(c.id);
                            Logger.warn('Failed to upsert customer', {
                                accountId, syncId, wooId: c.id, error: err.message
                            });
                        })
                    )
                );
            }

            // Preserve existing records that failed to upsert (transient DB errors)
            // so updatedAt-based reconciliation doesn't delete them
            if (failedWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooCustomer" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, failedWooIds
                );
            }

            // Bulk index all customers in one ES call
            try {
                await IndexingService.bulkIndexCustomers(accountId, customers);
            } catch (error: any) {
                Logger.warn('Bulk index customers failed', { accountId, syncId, error: error.message });
            }
            totalProcessed += customers.length;

            Logger.info(`Synced batch of ${customers.length} customers`, { accountId, syncId, page, totalPages });
            // Use WooCommerce's x-wp-totalpages header instead of batch size
            // (batch size is unreliable when Zod validation skips records from a full page)
            if (page >= totalPages) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;

            // Throttle API pagination to avoid overwhelming the WooCommerce store
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        // Reconciliation: remove customers not touched during this full sync.
        // Count-first pattern: evaluate the 30% safety cap via SQL count() rather
        // than loading every stale wooId into Node memory.
        if (!incremental && totalProcessed > 0) {
            const staleCount = await prisma.wooCustomer.count({
                where: { accountId, updatedAt: { lt: syncStartedAt } }
            });

            if (staleCount > 0) {
                const localTotal = await prisma.wooCustomer.count({ where: { accountId } });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));

                if (staleCount > maxDeletions) {
                    Logger.warn(`Customer reconciliation aborted: would delete ${staleCount}/${localTotal} (>30% cap)`, {
                        accountId, syncId, toDelete: staleCount, localTotal
                    });
                } else {
                    // Stream ES deletions in chunks so we never hold the full ID list.
                    const ES_DELETE_CHUNK = 500;
                    let cursor: string | undefined;
                    while (true) {
                        const chunk: { id: string; wooId: number }[] = await prisma.wooCustomer.findMany({
                            where: { accountId, updatedAt: { lt: syncStartedAt } },
                            select: { id: true, wooId: true },
                            orderBy: { id: 'asc' },
                            take: ES_DELETE_CHUNK,
                            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
                        });
                        if (chunk.length === 0) break;
                        await Promise.allSettled(
                            chunk.map(c => IndexingService.deleteCustomer(accountId, c.wooId).catch(() => { }))
                        );
                        cursor = chunk[chunk.length - 1].id;
                        if (chunk.length < ES_DELETE_CHUNK) break;
                    }

                    const { count } = await prisma.wooCustomer.deleteMany({
                        where: { accountId, updatedAt: { lt: syncStartedAt } }
                    });
                    totalDeleted = count;
                    Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned customers`, { accountId, syncId });
                }
            }
        }
        // --- Auto-Link: Link guest conversations to newly synced customers ---
        // Find guest conversations where guestEmail matches a WooCustomer email
        const linkedCount = await this.linkGuestConversationsToCustomers(accountId);
        if (linkedCount > 0) {
            Logger.info(`Auto-linked ${linkedCount} guest conversations to customers`, { accountId, syncId });
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }

    /**
     * Auto-link guest conversations to WooCommerce customers by matching email addresses.
     * @returns Number of conversations linked
     */
    private async linkGuestConversationsToCustomers(accountId: string): Promise<number> {
        // Find guest conversations (no wooCustomerId, but has guestEmail)
        const guestConversations = await prisma.conversation.findMany({
            where: {
                accountId,
                wooCustomerId: null,
                guestEmail: { not: null }
            },
            select: { id: true, guestEmail: true }
        });

        if (guestConversations.length === 0) return 0;

        // Build a map of email -> conversations
        const emailToConvs = new Map<string, string[]>();
        for (const conv of guestConversations) {
            if (!conv.guestEmail) continue;
            const email = conv.guestEmail.toLowerCase();
            if (!emailToConvs.has(email)) {
                emailToConvs.set(email, []);
            }
            emailToConvs.get(email)!.push(conv.id);
        }

        // Find matching customers
        const emails = Array.from(emailToConvs.keys());
        const matchingCustomers = await prisma.wooCustomer.findMany({
            where: {
                accountId,
                email: { in: emails, mode: 'insensitive' }
            },
            select: { id: true, email: true }
        });

        let linkedCount = 0;
        for (const customer of matchingCustomers) {
            const convIds = emailToConvs.get(customer.email.toLowerCase());
            if (!convIds || convIds.length === 0) continue;

            // Update all matching conversations
            await prisma.conversation.updateMany({
                where: { id: { in: convIds } },
                data: {
                    wooCustomerId: customer.id,
                    guestEmail: null,
                    guestName: null
                }
            });
            linkedCount += convIds.length;
        }

        return linkedCount;
    }
}


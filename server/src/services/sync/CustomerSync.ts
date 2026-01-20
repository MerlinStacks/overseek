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

        const wooCustomerIds = new Set<number>();

        while (hasMore) {
            const { data: rawCustomers, totalPages } = await woo.getCustomers({ page, after, per_page: 25 });
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
                    Logger.warn(`Skipping invalid customer`, {
                        accountId, syncId, customerId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!customers.length) {
                page++;
                continue;
            }

            // Batch prepare upsert operations and execute in sub-batches to avoid transaction timeout
            // Split into chunks of 10 to stay well within the 5-second transaction limit
            const SUB_BATCH_SIZE = 10;
            for (let i = 0; i < customers.length; i += SUB_BATCH_SIZE) {
                const batch = customers.slice(i, i + SUB_BATCH_SIZE);
                const upsertOperations = batch.map((c) => {
                    wooCustomerIds.add(c.id);
                    return prisma.wooCustomer.upsert({
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
                    });
                });

                // Execute sub-batch transaction
                await prisma.$transaction(upsertOperations);
            }

            // Index customers in parallel
            const indexPromises = customers.map((c) =>
                IndexingService.indexCustomer(accountId, c)
                    .catch((error: any) => {
                        Logger.warn(`Failed to index customer ${c.id}`, { accountId, syncId, error: error.message });
                    })
            );

            await Promise.allSettled(indexPromises);
            totalProcessed += customers.length;

            Logger.info(`Synced batch of ${customers.length} customers`, { accountId, syncId, page, totalPages });
            if (customers.length < 25) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        // --- Reconciliation: Remove deleted customers ---
        // Only run on full sync (non-incremental) to ensure we have all WooCommerce IDs
        if (!incremental && wooCustomerIds.size > 0) {
            const localCustomers = await prisma.wooCustomer.findMany({
                where: { accountId },
                select: { id: true, wooId: true }
            });

            // Collect IDs of customers to delete (exist locally but not in WooCommerce)
            const orphanedCustomers = localCustomers.filter(
                local => !wooCustomerIds.has(local.wooId)
            );

            if (orphanedCustomers.length > 0) {
                const orphanedIds = orphanedCustomers.map(c => c.id);
                const orphanedWooIds = orphanedCustomers.map(c => c.wooId);

                // Batch delete in a single transaction to avoid deadlocks
                await prisma.wooCustomer.deleteMany({
                    where: { id: { in: orphanedIds } }
                });

                // Index deletions serially to avoid overwhelming the search index
                for (const wooId of orphanedWooIds) {
                    await IndexingService.deleteCustomer(accountId, wooId).catch(() => { });
                }

                totalDeleted = orphanedCustomers.length;
                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned customers`, { accountId, syncId });
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


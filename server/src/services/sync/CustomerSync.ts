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

            // Batch prepare upsert operations
            const upsertOperations = customers.map((c) => {
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

            // Execute batch transaction
            await prisma.$transaction(upsertOperations);

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

            const deletePromises: Promise<any>[] = [];
            for (const local of localCustomers) {
                if (!wooCustomerIds.has(local.wooId)) {
                    // Customer exists locally but not in WooCommerce - delete it
                    deletePromises.push(
                        prisma.wooCustomer.delete({ where: { id: local.id } })
                            .then(() => IndexingService.deleteCustomer(accountId, local.wooId))
                    );
                    totalDeleted++;
                }
            }

            if (deletePromises.length > 0) {
                await Promise.allSettled(deletePromises);
                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned customers`, { accountId, syncId });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}


import { BaseSync } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { Logger } from '../../utils/logger';


export class CustomerSync extends BaseSync {
    protected entityType = 'customers';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any): Promise<void> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;

        // Collect all WooCommerce customer IDs for reconciliation
        const wooCustomerIds = new Set<number>();

        while (hasMore) {
            const { data: customers, totalPages } = await woo.getCustomers({ page, after, per_page: 50 });
            if (!customers.length) {
                hasMore = false;
                break;
            }

            for (const c of customers) {
                wooCustomerIds.add(c.id);

                await prisma.wooCustomer.upsert({
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

                // Index
                // Index
                try {
                    await IndexingService.indexCustomer(accountId, c);
                } catch (error: any) {
                    Logger.warn(`Failed to index customer ${c.id}`, { accountId, error: error.message });
                }

                totalProcessed++;
            }

            Logger.info(`Synced batch of ${customers.length} customers`, { accountId, page, totalPages });
            if (customers.length < 50) hasMore = false;

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

            let deletedCount = 0;
            for (const local of localCustomers) {
                if (!wooCustomerIds.has(local.wooId)) {
                    // Customer exists locally but not in WooCommerce - delete it
                    await prisma.wooCustomer.delete({ where: { id: local.id } });
                    await IndexingService.deleteCustomer(accountId, local.wooId);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                Logger.info(`Reconciliation: Deleted ${deletedCount} orphaned customers`, { accountId });
            }
        }

        Logger.info(`Customer Sync Complete. Total: ${totalProcessed}`, { accountId });
    }
}

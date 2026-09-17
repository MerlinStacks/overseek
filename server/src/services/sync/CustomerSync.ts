import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';
import { Logger } from '../../utils/logger';
import { WooCustomerSchema, WooCustomer } from './wooSchemas';
import { materializeContact } from '../ContactMaterialization';
import { queueContactProjection, queueContactKeys } from '../ContactProjection';
import { updateCustomerTotals, withOrderTotalsTransaction } from './orderCustomerTotals';


export class CustomerSync extends BaseSync {
    protected entityType = 'customers';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;
        let validationFailures = 0;
        let totalUpsertFailures = 0;

        const syncStartedAt = new Date();

        while (hasMore) {
            // Use 50/page to balance throughput with memory safety (large
            // customer objects with heavy metadata can OOM at 100/page).
            const { data: rawCustomers, totalPages } = await woo.getCustomers({ page, after, per_page: 50 });
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
                    validationFailures++;
                    Logger.debug(`Skipping invalid customer`, {
                        accountId, syncId, customerId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!customers.length) {
                hasMore = this.hasMorePages(page, totalPages, rawCustomers.length, 50);
                if (job) {
                    const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : (hasMore ? 0 : 100);
                    await job.updateProgress(progress);
                    await this.assertNotCancelled(job);
                }
                page++;
                if (hasMore) await new Promise(r => setTimeout(r, 500));
                continue;
            }

            // Optimized: Batch upserts in transactions of 50 for better throughput
            const BATCH_SIZE = 50;
            const failedWooIds: number[] = [];
            for (let i = 0; i < customers.length; i += BATCH_SIZE) {
                const batch = customers.slice(i, i + BATCH_SIZE);

                // One lock and durable projection intents per bounded page.
                await withOrderTotalsTransaction(accountId, async tx => {
                    const ids: string[] = [];
                    for (const c of batch) {
                        const contact = await materializeContact(tx, accountId, {
                            source: 'WOO_CUSTOMER', wooCustomerId: c.id, email: c.email,
                            firstName: c.first_name, lastName: c.last_name, remoteData: c as any
                        });
                        ids.push(contact.id);
                    }
                    await updateCustomerTotals(tx, accountId, [], ids);
                    await queueContactProjection(tx, accountId, ids);
                }).catch((err) => {
                    totalSkipped += batch.length;
                    totalUpsertFailures += batch.length;
                    failedWooIds.push(...batch.map(c => c.id));
                    Logger.warn('Failed to persist customer batch', { accountId, syncId, error: err.message });
                });
            }

            // Preserve existing records that failed to upsert (transient DB errors)
            // so updatedAt-based reconciliation doesn't delete them
            if (failedWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooCustomer" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, failedWooIds
                );
            }

            const failedWooIdSet = new Set(failedWooIds);
            const persistedCustomers = customers.filter(customer => !failedWooIdSet.has(customer.id));

            // Each successful transaction persisted durable projection intent.
            totalProcessed += persistedCustomers.length;

            Logger.info(`Synced batch of ${persistedCustomers.length} customers`, { accountId, syncId, page, totalPages });
            // Use WooCommerce's x-wp-totalpages header instead of batch size
            // (batch size is unreliable when Zod validation skips records from a full page)
            hasMore = this.hasMorePages(page, totalPages, rawCustomers.length, 50);

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                await this.assertNotCancelled(job);
            }

            page++;

            // Throttle API pagination to avoid overwhelming the WooCommerce store
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        if (totalUpsertFailures > 0) {
            throw new Error(`Customer sync could not persist ${totalUpsertFailures} customer(s); checkpoint was not advanced.`);
        }

        // Reconciliation: remove customers not touched during this full sync.
        // Count-first pattern: evaluate the 30% safety cap via SQL count() rather
        // than loading every stale wooId into Node memory.
        if (!incremental && totalProcessed > 0 && validationFailures === 0) {
            // Local/inbox contacts use negative IDs and cannot be refreshed by Woo.
            // Use the same remote-only scope for every reconciliation operation.
            const remoteWhere = { accountId, wooId: { gt: 0 } };
            const staleWhere = { ...remoteWhere, updatedAt: { lt: syncStartedAt } };
            const staleCount = await prisma.wooCustomer.count({
                where: staleWhere
            });

            if (staleCount > 0) {
                const localTotal = await prisma.wooCustomer.count({ where: remoteWhere });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));

                if (staleCount > maxDeletions) {
                    Logger.warn(`Customer reconciliation aborted: would delete ${staleCount}/${localTotal} (>30% cap)`, {
                        accountId, syncId, toDelete: staleCount, localTotal
                    });
                } else {
                    // Persist deletion intents in chunks so we never hold the full ID list.
                    const ES_DELETE_CHUNK = 500;
                    let cursor: string | undefined;
                    while (true) {
                        const chunk: { id: string; wooId: number }[] = await prisma.wooCustomer.findMany({
                            where: { ...staleWhere, ...(cursor ? { id: { gt: cursor } } : {}) },
                            select: { id: true, wooId: true },
                            orderBy: { id: 'asc' },
                            take: ES_DELETE_CHUNK,
                        });
                        if (chunk.length === 0) break;
                        totalDeleted += await withOrderTotalsTransaction(accountId, async tx => {
                            // A removed Woo user is still a contact when local history references them.
                            // Recheck under the same lock used by orders/enrollments and promotion.
                            const deletable = await tx.$queryRaw<{ id: string; wooId: number }[]>`
                                SELECT c."id", c."wooId" FROM "WooCustomer" c
                                WHERE c."accountId" = ${accountId} AND c."id" = ANY(${chunk.map(c => c.id)}::text[])
                                AND c."wooId" > 0 AND c."updatedAt" < ${syncStartedAt}
                                AND NOT EXISTS (SELECT 1 FROM "WooOrder" o WHERE o."accountId" = c."accountId"
                                    AND (o."wooCustomerId" = c."wooId" OR (o."wooCustomerId" IS NULL
                                        AND NULLIF(TRIM(c."email"), '') IS NOT NULL
                                        AND LOWER(TRIM(o."billingEmail")) = LOWER(TRIM(c."email")))))
                                AND NOT EXISTS (SELECT 1 FROM "AutomationEnrollment" e WHERE e."accountId" = c."accountId"
                                    AND (e."wooCustomerId" = c."wooId" OR (NULLIF(TRIM(c."email"), '') IS NOT NULL
                                        AND LOWER(TRIM(e."email")) = LOWER(TRIM(c."email")))))
                            `;
                            await queueContactKeys(tx, accountId, deletable.map(c => c.wooId));
                            const result = await tx.wooCustomer.deleteMany({ where: { accountId, id: { in: deletable.map(c => c.id) } } });
                            return result.count;
                        });
                        cursor = chunk[chunk.length - 1].id;
                        if (chunk.length < ES_DELETE_CHUNK) break;
                    }

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
        if (totalSkipped > 0) {
            Logger.debug('Customer sync skipped invalid records', { accountId, syncId, totalSkipped });
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

        const updates: Array<{ conversationId: string; customerId: string }> = [];
        for (const customer of matchingCustomers) {
            const convIds = emailToConvs.get(customer.email.toLowerCase());
            if (!convIds || convIds.length === 0) continue;
            for (const conversationId of convIds) {
                updates.push({ conversationId, customerId: customer.id });
            }
        }

        if (updates.length === 0) return 0;

        const UPDATE_CHUNK = 500;
        for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
            const chunk = updates.slice(i, i + UPDATE_CHUNK);
            const values = Prisma.join(
                chunk.map((u) => Prisma.sql`(${u.conversationId}, ${u.customerId})`)
            );
            await prisma.$executeRaw`
                UPDATE "Conversation" c
                SET "wooCustomerId" = v.customer_id,
                    "guestEmail" = NULL,
                    "guestName" = NULL
                FROM (VALUES ${values}) AS v(conversation_id, customer_id)
                WHERE c.id = v.conversation_id
                  AND c."accountId" = ${accountId}
            `;
        }

        const linkedCount = updates.length;

        return linkedCount;
    }
}

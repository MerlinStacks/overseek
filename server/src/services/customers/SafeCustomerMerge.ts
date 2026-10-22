import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { PermissionService } from '../PermissionService';
export const customerMergeSchema = z.object({ sourceId: z.string().trim().min(1).max(200), targetVersion: z.string().datetime(), sourceVersion: z.string().datetime(), occurrence: z.string().uuid() }).strict();
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
export async function mergeCustomersSafely(accountId: string, userId: string, targetId: string, input: unknown) {
    z.string().min(1).max(200).parse(accountId); z.string().min(1).max(200).parse(targetId);
    const data = customerMergeSchema.parse(input);
    if (targetId === data.sourceId) throw fail('Source and target must differ', 400);
    if (!await PermissionService.hasPermission(userId, accountId, 'manage_customers')) throw fail('Customer management permission required', 403);
    const identity = crypto.createHash('sha256').update(JSON.stringify(['customer-merge', accountId, userId, data.occurrence])).digest('hex');
    const requestDigest = crypto.createHash('sha256').update(JSON.stringify([targetId, data.sourceId, data.sourceVersion, data.targetVersion])).digest('hex');
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`customer-merge:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id: identity } });
        if (receipt) {
            const result = z.object({ requestDigest: z.string(), success: z.literal(true), targetId: z.string(), sourceId: z.string(), ordersTransferred: z.number().int(), indexing: z.literal('unverified') }).parse(receipt.result);
            if (result.requestDigest !== requestDigest) throw fail('Occurrence already used for another merge'); return result;
        }
        const target = await tx.wooCustomer.findFirst({ where: { id: targetId, accountId, updatedAt: new Date(data.targetVersion) }, include: { emailListMemberships: { take: 1 }, wholesaleCatalogShares: { take: 1 } } });
        const source = await tx.wooCustomer.findFirst({ where: { id: data.sourceId, accountId, updatedAt: new Date(data.sourceVersion) }, include: { emailListMemberships: { take: 1 }, wholesaleCatalogShares: { take: 1 } } });
        if (!target || !source || target.wooId <= 0 || source.wooId <= 0) throw fail('Customers changed or unavailable');
        if (!z.string().email().safeParse(target.email).success || target.email.trim().toLowerCase() !== source.email.trim().toLowerCase()) throw fail('Only exact-email duplicates may be merged');
        if (source.emailListMemberships.length || source.wholesaleCatalogShares.length) throw fail('Source has list memberships or catalog shares; reconcile those explicitly before merging');
        // Serializable reads protect this bounded candidate set and all subsequent writes.
        const orders = await tx.wooOrder.findMany({ where: { accountId, rawData: { path: ['customer_id'], equals: source.wooId } }, orderBy: { id: 'asc' }, take: 501, select: { id: true, rawData: true, updatedAt: true } });
        if (orders.length > 500) throw fail('Merge exceeds bounded order coverage; manual reconciliation required');
        for (const order of orders) {
            if (!order.rawData || typeof order.rawData !== 'object' || Array.isArray(order.rawData)) throw fail('Invalid order data');
            const changed = await tx.wooOrder.updateMany({ where: { id: order.id, accountId, updatedAt: order.updatedAt, rawData: { path: ['customer_id'], equals: source.wooId } }, data: { rawData: { ...order.rawData, customer_id: target.wooId }, updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)) } });
            if (changed.count !== 1) throw fail('Order changed during merge');
        }
        await tx.conversation.updateMany({ where: { accountId, wooCustomerId: source.id }, data: { wooCustomerId: target.id } });
        await tx.wooReview.updateMany({ where: { accountId, wooCustomerId: source.id }, data: { wooCustomerId: target.id } });
        await tx.automationEnrollment.updateMany({ where: { accountId, wooCustomerId: source.wooId }, data: { wooCustomerId: target.wooId } });
        // Do not add denormalized money from potentially overlapping/mixed-currency histories.
        // Leave stored totals unchanged rather than advertising an invented merged total.
        const updated = await tx.wooCustomer.updateMany({ where: { id: target.id, accountId, updatedAt: target.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), target.updatedAt.getTime() + 1)) } });
        if (updated.count !== 1 || (await tx.wooCustomer.deleteMany({ where: { id: source.id, accountId, updatedAt: source.updatedAt } })).count !== 1) throw fail('Customer changed during merge');
        const result = { requestDigest, success: true as const, targetId, sourceId: source.id, ordersTransferred: orders.length, indexing: 'unverified' as const };
        await tx.scopedOperation.create({ data: { id: identity, accountId, kind: 'customer-merge', result } });
        return result;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
}

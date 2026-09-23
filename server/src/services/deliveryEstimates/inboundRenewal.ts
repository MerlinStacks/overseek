import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { configuredInboundProducts, dirtyInboundProducts, lockDeliveryAccount } from './intents';

export const INBOUND_RENEWAL_BUDGET = 40;
const eligibleAccount: Prisma.AccountWhereInput = {
    features: { none: { featureKey: 'DELIVERY_ESTIMATES', isEnabled: false } },
    deliverySyncAccount: { is: { capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', inboundFailed: false } },
};

/** Indexed deadline scan; only ACKed generations renew. Pending transports retain
 * their exact payload/timestamp, including after expiry (storefront fails closed).
 * Unsupported/disabled accounts stay parked until explicitly supported/enabled.
 */
export async function renewInboundInputs(now = new Date(), limit = INBOUND_RENEWAL_BUDGET) {
    const rows = await prisma.deliveryInputSync.findMany({
        where: { scope: 'inbound', status: 'synced', inboundRenewAt: { lte: now }, account: eligibleAccount },
        orderBy: [{ inboundRenewAt: 'asc' }, { id: 'asc' }], take: Math.min(INBOUND_RENEWAL_BUDGET, Math.max(1, limit)),
        select: { id: true, accountId: true, entityId: true, desiredRevision: true },
    });
    for (const row of rows) await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, row.accountId);
        const claimed = await tx.deliveryInputSync.updateMany({
            where: { id: row.id, desiredRevision: row.desiredRevision, status: 'synced', inboundRenewAt: { lte: now }, account: eligibleAccount },
            data: { inboundRenewAt: null },
        });
        if (!claimed.count) return;
        const configured = await tx.wooProduct.findFirst({ where: { accountId: row.accountId, wooId: row.entityId, ...configuredInboundProducts }, select: { id: true } });
        if (configured) await dirtyInboundProducts(tx, row.accountId, [row.entityId]);
    });
}

/** DB mutation hooks commit dirty identities with the source write. Wake in bounded
 * account batches here, avoiding a source-row -> Account lock inversion in triggers.
 * A concurrent re-dirty survives the builder's version CAS and is picked up here.
 */
export async function wakeInboundTargets() {
    const accounts = await prisma.$queryRaw<{ accountId: string }[]>`
        SELECT DISTINCT d."accountId" FROM "DeliveryInboundDirtyTarget" d
        LEFT JOIN "DeliverySyncAccount" c ON c."accountId" = d."accountId"
        WHERE NOT COALESCE(c."inboundRequested", false) AND NOT COALESCE(c."inboundFailed", false)
          AND COALESCE(c."capabilityStatus", 'unknown') IN ('unknown', 'supported')
          AND COALESCE(c."inboundCapabilityStatus", 'unknown') <> 'plugin_update_required'
          AND NOT EXISTS (SELECT 1 FROM "AccountFeature" f WHERE f."accountId" = d."accountId"
            AND f."featureKey" = 'DELIVERY_ESTIMATES' AND NOT f."isEnabled")
        ORDER BY d."accountId" LIMIT 4`;
    for (const { accountId } of accounts) await prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        await tx.deliverySyncAccount.upsert({ where: { accountId }, create: { accountId, inboundRequested: true }, update: { inboundRequested: true, inboundVersion: { increment: 1 } } });
    });
}

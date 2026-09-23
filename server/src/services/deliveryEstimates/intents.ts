import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { defaultSettings, settingsSchema, productionRangeSchema, ProductionRange } from './validation';

/** All explicit writers lock before reading snapshots, including resync and toggles. */
export async function lockDeliveryAccount(tx: Prisma.TransactionClient, accountId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
}

export async function recordIntent(tx: Prisma.TransactionClient, accountId: string, scope: 'settings' | 'product' | 'inbound', entityId: number, payload: Prisma.InputJsonObject) {
    const priority = scope === 'settings' ? (payload.enabled === false ? 0 : 1) : 2;
    const control = await tx.deliverySyncAccount.upsert({
        where: { accountId }, create: { accountId },
        update: { hasWork: true, nextAttemptAt: new Date() },
    });
    // Saving desired data never invalidates an account-level unsupported/auth decision.
    const parked = ['plugin_update_required', 'blocked'].includes(control.capabilityStatus);
    const inboundParked = scope === 'inbound' && control.inboundCapabilityStatus === 'plugin_update_required';
    const status = parked ? control.capabilityStatus : inboundParked ? 'plugin_update_required' : 'pending';
    const lastError = parked ? control.lastError : inboundParked ? 'Update the plugin for inbound inputs.' : null;
    const resyncGeneration = control.resyncGeneration;
    // Schedule from the immutable generation, never from an ACK or transport retry.
    const inboundRenewAt = scope === 'inbound' && Array.isArray(payload.targets) && payload.targets.length
        ? new Date(new Date(String(payload.expiresAt)).getTime() - 4 * 60 * 60 * 1000) : null;
    // Never clear an active lease: the previous revision may still be on the wire.
    await tx.deliveryInputSync.upsert({
        where: { accountId_scope_entityId: { accountId, scope, entityId } },
        create: { accountId, scope, entityId, payload, priority, status, lastError, resyncGeneration, inboundRenewAt },
        update: { payload, priority, desiredRevision: { increment: 1 }, status, attempts: 0, nextAttemptAt: new Date(), lastError, resyncGeneration, inboundRenewAt },
    });
}

/** Manual initial/resync and supplier fanout only. Caller holds the account lock.
 * A running configured-product sweep finishes, then repeats if its generation was
 * dirtied; ordinary PO/product changes use dirtyInboundProducts instead.
 */
export async function dirtyInbound(tx: Prisma.TransactionClient, accountId: string) {
    await tx.deliverySyncAccount.upsert({ where: { accountId },
        create: { accountId, inboundRequested: true, inboundFullRequested: true, inboundGeneration: 1 },
        update: { inboundRequested: true, inboundFullRequested: true, inboundGeneration: { increment: 1 } },
    });
}

export const configuredInboundProducts: Prisma.WooProductWhereInput = { OR: [
    { productionMinDays: { not: null } }, { productionMaxDays: { not: null } },
    { variations: { some: { OR: [{ productionMinDays: { not: null } }, { productionMaxDays: { not: null } }] } } },
] };

/** Caller holds Account before source writes. Only explicit identities are read, in
 * chunks; inventory activity cannot enrol an untouched catalogue. Existing outboxes
 * remain eligible even after production or the product itself has been removed.
 */
export async function dirtyInboundProducts(tx: Prisma.TransactionClient, accountId: string, wooIds: number[]) {
    const ids = [...new Set(wooIds)];
    let queued = false;
    for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        const [configured, existing] = await Promise.all([
            tx.wooProduct.findMany({ where: { accountId, wooId: { in: chunk }, ...configuredInboundProducts }, select: { wooId: true } }),
            tx.deliveryInputSync.findMany({ where: { accountId, scope: 'inbound', entityId: { in: chunk } }, select: { entityId: true } }),
        ]);
        for (const wooId of new Set([...configured.map(p => p.wooId), ...existing.map(row => row.entityId)])) {
            await tx.deliveryInboundDirtyTarget.upsert({ where: { accountId_wooId: { accountId, wooId } },
                create: { accountId, wooId }, update: { version: { increment: 1 } },
            });
            queued = true;
        }
    }
    if (queued) await tx.deliverySyncAccount.upsert({ where: { accountId },
        create: { accountId, inboundRequested: true },
        update: { inboundRequested: true, inboundVersion: { increment: 1 } },
    });
}

/** Resolve only the old/new direct PO parent IDs, tenant-scoped inside its transaction. */
export async function dirtyInboundProductIds(tx: Prisma.TransactionClient, accountId: string, productIds: (string | null | undefined)[]) {
    const ids = [...new Set(productIds.filter((id): id is string => !!id))];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const products = await tx.wooProduct.findMany({ where: { accountId, id: { in: ids.slice(offset, offset + 100) } }, select: { wooId: true } });
        await dirtyInboundProducts(tx, accountId, products.map(p => p.wooId));
    }
}

export async function ensureSettingsIntent(tx: Prisma.TransactionClient, accountId: string) {
    const existing = await tx.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId, scope: 'settings', entityId: 0 } }, select: { id: true } });
    if (!existing) await recordSettingsIntent(tx, accountId);
}

export async function recordSettingsIntent(tx: Prisma.TransactionClient, accountId: string) {
    const [stored, account, feature] = await Promise.all([
        tx.deliveryEstimateSettings.findUnique({ where: { accountId } }),
        tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { timezone: true } }),
        tx.accountFeature.findUnique({ where: { accountId_featureKey: { accountId, featureKey: 'DELIVERY_ESTIMATES' } } }),
    ]);
    const settings = settingsSchema.parse(stored?.settings ?? defaultSettings(account.timezone));
    await recordIntent(tx, accountId, 'settings', 0, { enabled: feature?.isEnabled ?? true, settings });
}

type ProductSnapshot = ProductionRange & { wooId: number; variations: (ProductionRange & { wooId: number })[] };
export async function recordProductIntent(tx: Prisma.TransactionClient, accountId: string, product: ProductSnapshot, onlyIfChanged = false) {
    await ensureSettingsIntent(tx, accountId);
    const range = (value: ProductionRange & { wooId: number }) => {
        if (!Number.isSafeInteger(value.wooId) || value.wooId <= 0) throw new Error('Invalid Woo product identity');
        return { wooId: value.wooId, ...productionRangeSchema.parse({ productionMinDays: value.productionMinDays, productionMaxDays: value.productionMaxDays }) };
    };
    if (product.variations.length > 1000) throw new Error('Too many delivery variations');
    const payload = { ...range(product), variations: product.variations.map(range) };
    if (onlyIfChanged) {
        const current = await tx.deliveryInputSync.findUnique({ where: { accountId_scope_entityId: { accountId, scope: 'product', entityId: product.wooId } }, select: { payload: true } });
        if (current && isDeepStrictEqual(current.payload, payload)) return;
    }
    await recordIntent(tx, accountId, 'product', product.wooId, payload);
}

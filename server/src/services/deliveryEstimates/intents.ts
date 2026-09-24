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
    // A new payload has no historical rejection. Distinguish this explicit clear
    // from older NULL rows eligible for the account-only diagnostic fallback.
    const lastDiagnostic = (parked || inboundParked) && control.lastDiagnostic ? { diagnostic: null } : Prisma.DbNull;
    const resyncGeneration = control.resyncGeneration;
    // Schedule from the immutable generation, never from an ACK or transport retry.
    const inboundRenewAt = scope === 'inbound' && Array.isArray(payload.targets) && payload.targets.length
        ? new Date(new Date(String(payload.expiresAt)).getTime() - 4 * 60 * 60 * 1000) : null;
    // Never clear an active lease: the previous revision may still be on the wire.
    await tx.deliveryInputSync.upsert({
        where: { accountId_scope_entityId: { accountId, scope, entityId } },
        create: { accountId, scope, entityId, payload, priority, status, lastError, ...(lastDiagnostic === Prisma.DbNull ? {} : { lastDiagnostic }), resyncGeneration, inboundRenewAt },
        update: { payload, priority, desiredRevision: { increment: 1 }, status, attempts: 0, nextAttemptAt: new Date(), lastError, lastDiagnostic, resyncGeneration, inboundRenewAt },
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

export const STRANDED_INBOUND_BATCH_SIZE = 10;

/** Account lock required. Older/manual control state can leave pending old-generation
 * inputs without a full pass or target. Never relabel/replay them: queue a bounded
 * current-source rebuild, retaining revisions, ACKs, leases and builder failures.
 */
export async function recoverStrandedInbound(tx: Prisma.TransactionClient, accountId: string,
    control: { inboundFullRequested: boolean; inboundFailed: boolean }) {
    if (control.inboundFullRequested || control.inboundFailed) return 0;
    const rows = await tx.$queryRaw<{ wooId: number }[]>`
        SELECT i."entityId" AS "wooId" FROM "DeliveryInputSync" i
        JOIN "DeliverySyncAccount" c ON c."accountId" = i."accountId"
        WHERE i."accountId" = ${accountId} AND i.scope = 'inbound' AND i.status = 'pending'
          AND (i."inboundGeneration" <> c."inboundGeneration" OR i.payload->>'expiresAt' <= to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            OR (i."lastDiagnostic"->>'source' = 'remote' AND i."lastDiagnostic"->>'phase' = 'inputs'
              AND i."lastDiagnostic"->>'disposition' = 'record_rejection' AND i."lastDiagnostic"->>'reason' = 'inbound_expired'
              AND i."lastDiagnostic"->>'attemptedRevision' = i."desiredRevision"::text))
          AND NOT c."inboundFullRequested" AND NOT c."inboundFailed"
          AND NOT EXISTS (SELECT 1 FROM "DeliveryInboundDirtyTarget" d WHERE d."accountId" = i."accountId" AND d."wooId" = i."entityId")
        ORDER BY i.id LIMIT ${STRANDED_INBOUND_BATCH_SIZE}`;
    if (!rows.length) return 0;
    // A source trigger may have inserted a target since SELECT. Preserve its version.
    await tx.deliveryInboundDirtyTarget.createMany({ data: rows.map(row => ({ accountId, wooId: row.wooId })), skipDuplicates: true });
    await tx.deliverySyncAccount.update({ where: { accountId }, data: { inboundRequested: true, inboundVersion: { increment: 1 } } });
    return rows.length;
}

export const configuredInboundProducts: Prisma.WooProductWhereInput = { OR: [
    { productionMinDays: { not: null } }, { productionMaxDays: { not: null } },
    { variations: { some: { deliveryActive: true, OR: [{ productionMinDays: { not: null } }, { productionMaxDays: { not: null } }] } } },
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
            // Removing the final configured variation can leave only a product
            // outbox. The targeted builder replaces BOTH projections, so retain
            // that identity even before its first inbound snapshot exists.
            tx.deliveryInputSync.findMany({ where: { accountId, scope: { in: ['product', 'inbound'] }, entityId: { in: chunk } }, select: { entityId: true } }),
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

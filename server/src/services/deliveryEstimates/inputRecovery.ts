import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { dirtyInboundProducts, lockDeliveryAccount, recordIntent } from './intents';
import { historicalInputSuppression, inboundExpired, inboundNeedsRebuild, readInputDiagnostic, readRowInputDiagnostic } from './inputDiagnostic';
import { preserveLegacyInputSuppression } from './inputSuppression';

export const attentionStatuses = ['blocked', 'failed', 'plugin_update_required'];
export const inputListQuery = z.object({
    status: z.enum(['blocked', 'failed', 'plugin_update_required', 'attention']).default('attention'),
    scope: z.enum(['settings', 'product', 'inbound']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2048).optional(),
}).strict();
const cursorSchema = z.object({ v: z.literal(1), accountId: z.string().max(200), status: inputListQuery.shape.status,
    scope: z.enum(['settings', 'product', 'inbound']).nullable(), id: z.string().min(1).max(200) }).strict();
export class InputRecoveryError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
}

export async function listDeliveryInputs(accountId: string, query: z.infer<typeof inputListQuery>) {
    let after: string | undefined;
    if (query.cursor) {
        try {
            if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
            const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
            if (cursor.accountId !== accountId || cursor.status !== query.status || cursor.scope !== (query.scope ?? null)) throw new Error();
            after = cursor.id;
        } catch { throw new InputRecoveryError(400, 'Invalid input cursor'); }
    }
    return prisma.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const observedAt = new Date();
        const control = await tx.deliverySyncAccount.findUnique({ where: { accountId }, select: { capabilityStatus: true, inboundCapabilityStatus: true, lastDiagnostic: true } });
        const suppression = readInputDiagnostic(control?.lastDiagnostic);
        const rows = await tx.deliveryInputSync.findMany({ where: { accountId,
            status: query.status === 'attention' ? { in: attentionStatuses } : query.status,
            ...(query.scope ? { scope: query.scope } : {}), ...(after ? { id: { gt: after } } : {}),
        }, orderBy: { id: 'asc' }, take: query.limit + 1 });
        const page = rows.slice(0, query.limit);
        const items = page.map(row => {
            const payload = (row.payload ?? {}) as Record<string, unknown>;
            const date = (value: unknown) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
            const diagnostic = readRowInputDiagnostic(row.lastDiagnostic, row.desiredRevision);
            return { id: row.id, scope: row.scope, entityId: row.entityId, status: row.status,
                desiredRevision: row.desiredRevision.toString(), ackRevision: row.ackRevision.toString(), attempts: row.attempts, proofRebuilds: row.proofRebuilds,
                lastAcknowledgedAt: row.lastAcknowledgedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
                diagnostic: diagnostic ?? (row.lastDiagnostic === null && suppression?.disposition === 'account_suppression' && suppression.attemptedRevision === null &&
                        (row.status === control?.capabilityStatus || (row.scope === 'inbound' && row.status === control?.inboundCapabilityStatus)) ? historicalInputSuppression(suppression) : null),
                payloadSummary: {
                    envelopeBytes: Buffer.byteLength(JSON.stringify({ schemaVersion: 1, scope: row.scope, entityId: row.entityId, revision: Number(row.desiredRevision), payload: row.payload }), 'utf8'),
                    isTombstone: row.scope === 'inbound' ? Array.isArray(payload.targets) && payload.targets.length === 0
                        : row.scope === 'product' ? payload.productionMinDays === null && payload.productionMaxDays === null && Array.isArray(payload.variations) && payload.variations.length === 0 : payload.enabled === false,
                    variationCount: Array.isArray(payload.variations) ? payload.variations.length : null,
                    targetCount: Array.isArray(payload.targets) ? payload.targets.length : null,
                    generatedAt: date(payload.generatedAt), expiresAt: date(payload.expiresAt), expiredAtObservation: inboundExpired(row.scope, payload, observedAt),
                },
            };
        });
        return { schemaVersion: 1 as const, observedAt: observedAt.toISOString(), items,
            nextCursor: rows.length > query.limit ? Buffer.from(JSON.stringify({ v: 1, accountId, status: query.status, scope: query.scope ?? null, id: page[page.length - 1].id })).toString('base64url') : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Selected identity only. Source writers and retries serialize on the Account lock. */
export async function retryDeliveryInput(accountId: string, inputId: string) {
    return prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        const row = await tx.deliveryInputSync.findFirst({ where: { id: inputId, accountId } });
        if (!row) throw new InputRecoveryError(404, 'Delivery input not found');
        const result = (disposition: 'queued' | 'rebuilding' | 'already_running') => ({ accepted: true as const, disposition, inputId });
        if (row.status === 'pending') return result('already_running');
        if (!attentionStatuses.includes(row.status)) throw new InputRecoveryError(409, 'Delivery input does not need recovery');
        const now = new Date();
        const control = await tx.deliverySyncAccount.findUnique({ where: { accountId } });
        if ((row.leaseExpiresAt && row.leaseExpiresAt > now) || (control?.leaseExpiresAt && control.leaseExpiresAt > now) || control?.resyncRequested) return result('already_running');
        await preserveLegacyInputSuppression(tx, accountId, control);
        await tx.deliverySyncAccount.update({ where: { accountId }, data: {
            capabilityStatus: 'unknown', inboundCapabilityStatus: 'unknown', capabilityExpiresAt: null, capabilityDetails: Prisma.DbNull,
            lastDiagnostic: Prisma.DbNull, lastError: null, hasWork: true, nextAttemptAt: now,
        } });
        await tx.deliveryInputSync.updateMany({ where: { id: inputId, accountId, desiredRevision: row.desiredRevision, status: row.status }, data: {
            status: 'pending', attempts: 0, proofRebuilds: 0, lastError: null, lastDiagnostic: Prisma.DbNull, nextAttemptAt: now,
        } });
        if (row.scope === 'inbound' && (inboundNeedsRebuild(row, now) || row.inboundGeneration !== control?.inboundGeneration || await tx.deliveryInboundDirtyTarget.findUnique({ where: { accountId_wooId: { accountId, wooId: row.entityId } } }))) {
            await dirtyInboundProducts(tx, accountId, [row.entityId]);
            await tx.deliverySyncAccount.update({ where: { accountId }, data: { inboundFailed: false, inboundAttempts: 0, inboundLastError: null, inboundNextAttemptAt: now } });
            return result('rebuilding');
        }
        if (row.scope === 'product' && !await tx.wooProduct.findFirst({ where: { accountId, wooId: row.entityId }, select: { id: true } })) {
            await recordIntent(tx, accountId, 'product', row.entityId, { wooId: row.entityId, productionMinDays: null, productionMaxDays: null, variations: [] });
        }
        return result('queued');
    });
}

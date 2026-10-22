import { z } from 'zod';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export const settingsCommandSchema = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable(), resourceId: z.string().min(1).max(200).nullable(), data: z.unknown() }).strict();
type Action = 'save' | 'test' | 'refresh' | 'station-create' | 'station-rotate';
const conflict = () => Object.assign(new Error('Settings operation changed or unconfirmed; reconcile its original occurrence'), { statusCode: 409 });
export async function runShippingSettingsCommand(accountId: string, actorId: string, action: Action, input: unknown, work: (data: unknown, tx?: Prisma.TransactionClient) => Promise<unknown>) {
    const body = settingsCommandSchema.parse(input);
    const id = `shipping-settings:${accountId}:${body.operationId}`, gateId = `shipping-settings-gate:${accountId}`;
    const digest = createHash('sha256').update(JSON.stringify([actorId, action, body])).digest('hex');
    const local = ['save', 'station-create', 'station-rotate'].includes(action);
    const admitted = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gateId}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const result = receipt.result as any; if (result.digest !== digest || result.state !== 'complete') throw conflict(); return { replay: true as const, value: result.value }; }
        const gate = await tx.scopedOperation.findUnique({ where: { id: gateId } });
        if (gate && (gate.result as any).state !== 'complete') throw conflict();
        const resource = action === 'station-rotate' ? await tx.shippingPrintStation.findFirst({ where: { id: body.resourceId ?? '', accountId } }) : await tx.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, orderBy: { createdAt: 'asc' } });
        if ((resource?.id ?? null) !== body.resourceId || (resource?.updatedAt.toISOString() ?? null) !== body.version) throw conflict();
        if (!local && !resource) throw conflict();
        if (action === 'save') {
            const data = body.data as Record<string, unknown>;
            if (data.apiBaseUrl !== undefined) {
                const url = new URL(String(data.apiBaseUrl));
                if (url.protocol !== 'https:' || url.hostname !== 'digitalapi.auspost.com.au' || url.port || url.username || url.password || url.search || url.hash || !['/shipping/v1', '/testbed/shipping/v1'].includes(url.pathname.replace(/\/$/, ''))) throw conflict();
            }
            for (const key of ['testEndpointPath', 'ratesEndpointPath', 'labelsEndpointPath', 'labelPdfEndpointPath', 'trackingEndpointPath', 'cancellationEndpointPath']) {
                const value = data[key];
                if (value !== undefined && (typeof value !== 'string' || !/^\/[A-Za-z0-9_/?=&{}.-]{1,254}$/.test(value) || value.startsWith('//') || value.includes('..'))) throw conflict();
            }
            if (data.defaultPrintStationId && !await tx.shippingPrintStation.findFirst({ where: { id: String(data.defaultPrintStationId), accountId } })) throw conflict();
            if (data.defaultPackagePresetId && !await tx.shippingPackagePreset.findFirst({ where: { id: String(data.defaultPackagePresetId), accountId, isActive: true } })) throw conflict();
        }
        if (local) {
            const value = await work(body.data, tx) as Record<string, unknown>;
            // Station secrets are revealed once, never persisted in receipts/replayed.
            const { token: _token, ...redacted } = value;
            const safe = JSON.parse(JSON.stringify({ ...redacted, ...(value.token ? { tokenUnavailableOnReplay: true } : {}) }));
            await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-settings', result: { digest, state: 'complete', value: safe } } });
            await tx.shippingAuditEvent.create({ data: { accountId, userId: actorId, eventType: 'SETTINGS_COMMAND_ACKNOWLEDGED', metadata: { action, operationId: body.operationId } } });
            return { replay: true as const, value };
        }
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-settings', result: { digest, state: 'pending', action } } });
        await tx.scopedOperation.upsert({ where: { id: gateId }, create: { id: gateId, accountId, kind: 'shipping-settings-gate', result: { state: 'pending', id } }, update: { result: { state: 'pending', id } } });
        return { replay: false as const };
    });
    if (admitted.replay) return { accountId, operationId: body.operationId, value: admitted.value };
    try {
        // No automatic retry. Preserve pending gate across provider/lost-ack failure.
        const value = await work(body.data), safe = JSON.parse(JSON.stringify(value));
        await prisma.$transaction(async tx => {
            await tx.scopedOperation.update({ where: { id }, data: { result: { digest, state: 'complete', value: safe } } });
            await tx.scopedOperation.update({ where: { id: gateId }, data: { result: { state: 'complete', id } } });
        });
        return { accountId, operationId: body.operationId, value };
    } catch { await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { digest, state: 'uncertain', action } } }).catch(() => undefined); throw conflict(); }
}

import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
export const shippingOperationSchema = z.object({ operationId: z.string().uuid(), version: z.string().datetime() });
const conflict = () => Object.assign(new Error('Shipping operation requires reconciliation'), { statusCode: 409 });
export async function runShippingLabelOperation<T>(accountId: string, labelId: string, actorId: string, kind: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const body = shippingOperationSchema.passthrough().parse(input), id = `shipping-operation:${accountId}:${body.operationId}`, gate = `shipping-label-gate:${accountId}:${labelId}`;
    const digest = createHash('sha256').update(JSON.stringify([actorId, labelId, kind, input])).digest('hex');
    const admission = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gate}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const previous = receipt.result as any; if (previous.digest !== digest || previous.state !== 'complete') throw conflict(); return { replay: true, value: previous.value as T }; }
        const active = await tx.scopedOperation.findUnique({ where: { id: gate } });
        if (active && (active.result as any).state !== 'complete') throw conflict();
        if (await tx.shippingPrintJob.findFirst({ where: { accountId, labelId, status: { in: ['queued', 'station_offline', 'picked_up'] } }, select: { id: true } })) throw conflict();
        const label = await tx.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label || label.updatedAt.toISOString() !== body.version) throw conflict();
        const reserved = await tx.shippingLabel.updateMany({ where: { id: labelId, accountId, updatedAt: label.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), label.updatedAt.getTime() + 1)) } });
        if (reserved.count !== 1) throw conflict();
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-operation', result: { digest, state: 'pending', labelId, operationId: body.operationId } } });
        await tx.scopedOperation.upsert({ where: { id: gate }, create: { id: gate, accountId, kind: 'shipping-label-gate', result: { state: 'pending', operationId: body.operationId } }, update: { result: { state: 'pending', operationId: body.operationId } } });
        return { replay: false, value: undefined as T };
    });
    if (admission.replay) return admission.value;
    try {
        const value = await work(), serialized = JSON.parse(JSON.stringify(value));
        await prisma.$transaction(async tx => {
            await tx.scopedOperation.update({ where: { id }, data: { result: { digest, state: 'complete', value: serialized } } });
            await tx.scopedOperation.update({ where: { id: gate }, data: { result: { state: 'complete', operationId: body.operationId } } });
        });
        return value;
    } catch {
        // No blind retry: remote/local side effects may already have committed.
        await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { digest, state: 'uncertain', labelId, operationId: body.operationId } } }).catch(() => undefined);
        throw conflict();
    }
}

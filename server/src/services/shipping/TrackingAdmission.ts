import { prisma } from '../../utils/prisma';
import { createHash } from 'crypto';
import { scopeId } from '../BoundedProviderWork';
/** A pending/uncertain tracking import may already have triggered automation. Never replace it. */
export async function admittedTracking<T>(accountId: string, labelId: string, operationId: string, version: string, run: () => Promise<T>): Promise<T> {
    scopeId.parse(accountId); scopeId.parse(labelId); scopeId.parse(operationId);
    const gateId = `tracking-gate:${accountId}:${labelId}`, id = `tracking:${accountId}:${createHash('sha256').update(JSON.stringify([labelId, operationId])).digest('hex')}`;
    const replay = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gateId}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const value = receipt.result as any; if (value.version !== version || value.state !== 'complete') throw new Error('Tracking import requires reconciliation'); return { value: value.value as T }; }
        const gate = await tx.scopedOperation.findUnique({ where: { id: gateId } });
        if (gate && (gate.result as any).state !== 'complete') throw new Error('Previous tracking import requires reconciliation');
        if (gate && Date.now() - Number((gate.result as any).completedAt ?? 0) < 30000) throw new Error('Tracking refresh cooling down');
        const label = await tx.shippingLabel.findFirst({ where: { id: labelId, accountId }, select: { updatedAt: true, cancelledAt: true } });
        if (!label || label.cancelledAt || label.updatedAt.toISOString() !== version) throw new Error('Tracking label version changed');
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'tracking-import', result: { state: 'pending', labelId, operationId, version } } });
        await tx.scopedOperation.upsert({ where: { id: gateId }, create: { id: gateId, accountId, kind: 'tracking-gate', result: { state: 'pending', id } }, update: { result: { state: 'pending', id } } });
        return null;
    });
    if (replay) return replay.value;
    try {
        const value = await run();
        if ((value as any)?.hadErrors) throw new Error('Tracking import partially applied');
        await prisma.$transaction(async tx => {
            await tx.scopedOperation.update({ where: { id }, data: { result: { state: 'complete', version, value: JSON.parse(JSON.stringify(value)) } } });
            await tx.scopedOperation.update({ where: { id: gateId }, data: { result: { state: 'complete', id, completedAt: Date.now() } } });
        });
        return value;
    } catch { await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { state: 'uncertain', labelId, operationId, version } } }).catch(() => undefined); throw new Error('Tracking outcome uncertain; reconcile original occurrence'); }
}

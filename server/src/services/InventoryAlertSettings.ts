import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
export const inventoryAlertConfig = z.object({ isEnabled: z.boolean(), lowStockThresholdDays: z.number().int().min(0).max(3650), alertEmails: z.array(z.string().trim().email().max(254)).max(25).refine(values => new Set(values.map(value => value.toLowerCase())).size === values.length, 'Duplicate recipient') }).strict().refine(value => !value.isEnabled || value.alertEmails.length > 0, 'Select recipients before enabling alerts');
export async function readInventoryAlertSettings(accountId: string) {
    const row = await prisma.inventorySettings.findUnique({ where: { accountId } });
    return { config: inventoryAlertConfig.parse(row ? { isEnabled: row.isEnabled, lowStockThresholdDays: row.lowStockThresholdDays, alertEmails: row.alertEmails } : { isEnabled: false, lowStockThresholdDays: 14, alertEmails: [] }), version: row?.updatedAt.toISOString() ?? null };
}
export async function saveInventoryAlertSettings(accountId: string, actorId: string, input: unknown) {
    const body = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable(), config: inventoryAlertConfig }).strict().parse(input), id = `inventory-alert-settings:${accountId}:${body.operationId}`, digest = createHash('sha256').update(JSON.stringify([actorId, body])).digest('hex');
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`inventory-alert-settings:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const result = receipt.result as any; if (result.digest !== digest) throw Object.assign(new Error('Operation changed'), { statusCode: 409 }); return result.snapshot; }
        const previous = await tx.inventorySettings.findUnique({ where: { accountId } });
        if ((previous?.updatedAt.toISOString() ?? null) !== body.version) throw Object.assign(new Error('Settings conflict'), { statusCode: 409 });
        const updatedAt = new Date(Math.max(Date.now(), (previous?.updatedAt.getTime() ?? 0) + 1));
        if (previous) { const changed = await tx.inventorySettings.updateMany({ where: { accountId, updatedAt: previous.updatedAt }, data: { ...body.config, updatedAt } }); if (changed.count !== 1) throw Object.assign(new Error('Settings conflict'), { statusCode: 409 }); }
        else await tx.inventorySettings.create({ data: { accountId, ...body.config, updatedAt } });
        const snapshot = { config: body.config, version: updatedAt.toISOString() };
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'inventory-alert-settings', result: { digest, snapshot } } });
        return snapshot;
    });
}

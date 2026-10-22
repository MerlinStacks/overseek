import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
const lead = z.union([z.number().int().min(0).max(3650), z.string().regex(/^\d+$/).transform(Number).refine(value => Number.isInteger(value) && value <= 3650), z.literal(''), z.null()]).optional().transform(value => value === '' || value === undefined ? null : value);
export const supplierCreateSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200), contactName: z.string().trim().max(200).default(''), email: z.union([z.string().trim().email().max(320), z.literal('')]).default(''), phone: z.string().trim().max(50).default(''), currency: z.string().regex(/^[A-Z]{3}$/), leadTimeDefault: lead, leadTimeMin: lead, leadTimeMax: lead, paymentTerms: z.string().trim().max(500).default('') }).strict().refine(value => value.leadTimeMin === null || value.leadTimeMax === null || value.leadTimeMin <= value.leadTimeMax, 'Lead time minimum must not exceed maximum');
export async function createSupplier(accountId: string, userId: string, input: unknown) {
    z.string().min(1).max(200).parse(accountId); z.string().min(1).max(200).parse(userId);
    const { PermissionService } = await import('./PermissionService');
    if (!await PermissionService.hasPermission(userId, accountId, 'manage_inventory')) throw Object.assign(new Error('Inventory management permission required'), { statusCode: 403 });
    const data = supplierCreateSchema.parse(input);
    const operation = crypto.createHash('sha256').update(JSON.stringify(['supplier-create', accountId, data.id])).digest('hex');
    const digest = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${operation}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id: operation } });
        if (receipt) {
            const saved = z.object({ digest: z.string(), supplier: z.object({ id: z.string(), name: z.string(), currency: z.string() }).passthrough() }).parse(receipt.result);
            if (saved.digest !== digest) throw Object.assign(new Error('Creation identity already used; reconcile supplier before changing the request'), { statusCode: 409 });
            return saved.supplier;
        }
        const supplier = await tx.supplier.create({ data: { ...data, accountId } });
        const result = { digest, supplier: JSON.parse(JSON.stringify(supplier)) };
        await tx.scopedOperation.create({ data: { id: operation, accountId, kind: 'supplier-create', result } });
        return supplier;
    });
}

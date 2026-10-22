import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { createHash } from 'crypto';
const positive = z.number().int().min(1).max(10000000), nullable = positive.nullable();
export const packageSnapshot = z.object({ name: z.string().trim().min(1).max(120), type: z.enum(['custom_box', 'satchel', 'poly_mailer', 'mailer_bag', 'flat_mailer']), innerLengthMm: nullable, innerWidthMm: nullable, innerHeightMm: nullable, outerLengthMm: positive, outerWidthMm: positive, outerHeightMm: positive, fallbackItemWeightGrams: nullable, forcedPackageWeightGrams: nullable, packagingWeightGrams: z.number().int().min(0).max(10000000), maxWeightGrams: nullable, selectionPriority: z.number().int().min(0).max(10000), carrierProductCode: z.string().max(80).nullable(), isDefault: z.boolean(), isActive: z.boolean() }).strict().superRefine((value, ctx) => {
    if (value.isDefault && !value.isActive || ['Length', 'Width', 'Height'].some(axis => { const inner = value[`inner${axis}Mm` as 'innerLengthMm'], outer = value[`outer${axis}Mm` as 'outerLengthMm']; return inner !== null && inner > outer; }) || value.maxWeightGrams !== null && [value.forcedPackageWeightGrams, value.fallbackItemWeightGrams === null ? null : value.fallbackItemWeightGrams + value.packagingWeightGrams, value.packagingWeightGrams].some(weight => weight !== null && weight > value.maxWeightGrams!)) ctx.addIssue({ code: 'custom', message: 'Inactive defaults, inner/outer dimensions and weight limits must reconcile' });
});
export const overrideSnapshot = z.object({ wooProductId: z.number().int().positive().safe(), wooVariationId: z.number().int().positive().safe().nullable(), packagePresetId: z.string().min(1).max(200).nullable(), weightGrams: nullable, lengthMm: nullable, widthMm: nullable, heightMm: nullable, packingMode: z.enum(['combine_quantities', 'separate_items']), dangerousGoods: z.boolean(), fragile: z.boolean(), customsDescription: z.string().max(255).nullable(), countryOfOrigin: z.string().regex(/^[A-Z]{2}$/).nullable(), hsCode: z.string().regex(/^\d{6,12}$/).nullable(), notes: z.string().max(2000).nullable() }).strict().refine(value => [value.lengthMm, value.widthMm, value.heightMm].every(d => d === null) || [value.lengthMm, value.widthMm, value.heightMm].every(d => d !== null), 'Provide all three dimensions or none');
const envelope = z.object({ operationId: z.string().uuid(), kind: z.enum(['package', 'override']), resourceId: z.string().min(1).max(200).nullable(), version: z.string().datetime().nullable(), remove: z.boolean(), data: z.unknown() }).strict();
const conflict = () => Object.assign(new Error('Catalog conflict; preserve draft and reconcile operation'), { statusCode: 409 });
export async function writeShippingCatalog(accountId: string, actorId: string, input: unknown) {
    const body = envelope.parse(input);
    if (!accountId || !actorId || (!body.resourceId) !== (body.version === null) || body.remove && !body.resourceId) throw conflict();
    const parsed = body.remove ? null : body.kind === 'package' ? packageSnapshot.parse(body.data) : overrideSnapshot.parse(body.data);
    const id = `shipping-catalog:${accountId}:${body.operationId}`, digest = createHash('sha256').update(JSON.stringify([actorId, body])).digest('hex');
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`shipping-catalog:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const value = receipt.result as any; if (value.digest !== digest) throw conflict(); return value.snapshot; }
        const version = body.version ? new Date(body.version) : null;
        const updatedAt = new Date(Math.max(Date.now(), (version?.getTime() ?? 0) + 1));
        let snapshot: unknown;
        if (body.kind === 'package') {
            const previous = body.resourceId ? await tx.shippingPackagePreset.findFirst({ where: { id: body.resourceId, accountId } }) : null;
            if (body.resourceId && (!previous || previous.updatedAt.toISOString() !== body.version)) throw conflict();
            const data = body.remove ? { isActive: false, isDefault: false } : packageSnapshot.parse(parsed);
            if ('isDefault' in data && data.isDefault) {
                const defaults = await tx.shippingPackagePreset.findMany({ where: { accountId, isDefault: true, ...(body.resourceId ? { id: { not: body.resourceId } } : {}) }, take: 101, select: { id: true, updatedAt: true } });
                if (defaults.length > 100) throw conflict();
                for (const previousDefault of defaults) {
                    const changed = await tx.shippingPackagePreset.updateMany({ where: { accountId, id: previousDefault.id, updatedAt: previousDefault.updatedAt, isDefault: true }, data: { isDefault: false, updatedAt: new Date(Math.max(Date.now(), previousDefault.updatedAt.getTime() + 1)) } });
                    if (changed.count !== 1) throw conflict();
                }
            }
            if (body.resourceId) {
                const changed = await tx.shippingPackagePreset.updateMany({ where: { accountId, id: body.resourceId, updatedAt: version! }, data: { ...data, updatedAt } }); if (changed.count !== 1) throw conflict();
                snapshot = await tx.shippingPackagePreset.findFirst({ where: { id: body.resourceId, accountId } });
            } else snapshot = await tx.shippingPackagePreset.create({ data: { accountId, ...packageSnapshot.parse(data), updatedAt } });
        } else {
            const previous = body.resourceId ? await tx.shippingItemOverride.findFirst({ where: { accountId, id: body.resourceId } }) : null;
            if (body.resourceId && (!previous || previous.updatedAt.toISOString() !== body.version)) throw conflict();
            if (body.remove) {
                const changed = await tx.shippingItemOverride.deleteMany({ where: { accountId, id: body.resourceId!, updatedAt: version! } }); if (changed.count !== 1) throw conflict(); snapshot = { id: body.resourceId, removed: true };
            } else {
                const data = overrideSnapshot.parse(parsed);
                const product = await tx.wooProduct.findFirst({ where: { accountId, wooId: data.wooProductId }, select: { id: true } });
                if (!product || data.wooVariationId !== null && !await tx.productVariation.findFirst({ where: { productId: product.id, wooId: data.wooVariationId }, select: { id: true } })) throw conflict();
                if (data.packagePresetId && !await tx.shippingPackagePreset.findFirst({ where: { id: data.packagePresetId, accountId, isActive: true }, select: { id: true } })) throw conflict();
                const duplicate = await tx.shippingItemOverride.findFirst({ where: { accountId, wooProductId: data.wooProductId, wooVariationId: data.wooVariationId, ...(body.resourceId ? { id: { not: body.resourceId } } : {}) }, select: { id: true } });
                if (duplicate) throw conflict(); // Nullable DB unique keys alone do not protect simple products.
                if (body.resourceId) { const changed = await tx.shippingItemOverride.updateMany({ where: { accountId, id: body.resourceId, updatedAt: version! }, data: { ...data, updatedAt } }); if (changed.count !== 1) throw conflict(); snapshot = await tx.shippingItemOverride.findFirst({ where: { accountId, id: body.resourceId } }); }
                else snapshot = await tx.shippingItemOverride.create({ data: { accountId, ...data, updatedAt } });
            }
        }
        const safe = JSON.parse(JSON.stringify(snapshot));
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-catalog', result: { digest, snapshot: safe } } });
        await tx.shippingAuditEvent.create({ data: { accountId, userId: actorId, eventType: 'CATALOG_WRITE_ACKNOWLEDGED', metadata: { operationId: body.operationId, resourceId: body.resourceId, kind: body.kind, remove: body.remove } } });
        return safe;
    });
}

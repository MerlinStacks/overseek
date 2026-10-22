import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { shippingFetch } from './shippingApi';
export interface ShippingScope { token: string; accountId: string; actorId: string }
export const text = z.string().max(2000), date = z.string().datetime({ offset: true }), identity = z.string().min(1).max(200);
const size = z.number().int().positive().max(10000000), nullable = size.nullable();
export const packageData = z.object({ name: z.string().trim().min(1).max(120), type: z.enum(['custom_box', 'satchel', 'poly_mailer', 'mailer_bag', 'flat_mailer']), innerLengthMm: nullable, innerWidthMm: nullable, innerHeightMm: nullable, outerLengthMm: size, outerWidthMm: size, outerHeightMm: size, fallbackItemWeightGrams: nullable, forcedPackageWeightGrams: nullable, packagingWeightGrams: z.number().int().min(0).max(10000000), maxWeightGrams: nullable, selectionPriority: z.number().int().min(0).max(10000), carrierProductCode: z.string().max(80).nullable(), isDefault: z.boolean(), isActive: z.boolean() });
export const overrideData = z.object({ wooProductId: z.number().int().positive().safe(), wooVariationId: z.number().int().positive().safe().nullable(), packagePresetId: identity.nullable(), weightGrams: nullable, lengthMm: nullable, widthMm: nullable, heightMm: nullable, packingMode: z.enum(['combine_quantities', 'separate_items']), dangerousGoods: z.boolean(), fragile: z.boolean(), customsDescription: z.string().max(255).nullable(), countryOfOrigin: z.string().regex(/^[A-Z]{2}$/).nullable(), hsCode: z.string().regex(/^\d{6,12}$/).nullable(), notes: text.nullable() });
const row = { id: identity, accountId: identity, updatedAt: date };
export const packageRow = packageData.extend(row), overrideRow = overrideData.extend(row);
export const catalogSchema = z.object({ accountId: identity, partial: z.boolean(), packages: z.array(packageRow).max(1000), overrides: z.array(overrideRow).max(1000) });
export function decodeCatalog(value: unknown) { return catalogSchema.parse(value); }
export { ShippingBoundary, ShippingReadState } from './ShippingWorkspaceBoundary';
export function useShippingRead<T extends { accountId: string }>(path: string, scope: ShippingScope, decode: (value: unknown) => T) {
    const transport = useCallback((signal: AbortSignal) => shippingFetch(path, scope.token, scope.accountId, { signal }), [path, scope.token, scope.accountId]);
    const read = useScopedRequest(`/api/shipping${path}`, scope.accountId, scope.token, decode, transport);
    return { ...read, data: read.data?.accountId === scope.accountId ? read.data : null, error: read.error || !!read.data && read.data.accountId !== scope.accountId };
}
export function useReviewedShippingWrite(scope: ShippingScope) {
    const mutation = useScopedMutation(), [operationId, setOperationId] = useState(() => crypto.randomUUID()), [blocked, setBlocked] = useState(false);
    const run = async (path: string, body: Record<string, unknown>) => {
        if (blocked || mutation.isPending()) return { ok: false as const };
        const result = await mutation.run(async signal => {
            const response = z.object({ accountId: identity, operationId: identity.optional(), snapshot: z.unknown().optional(), value: z.unknown().optional() }).parse(await shippingFetch(path, scope.token, scope.accountId, { method: 'POST', signal, body: JSON.stringify({ ...body, operationId }) }));
            if (response.accountId !== scope.accountId || response.operationId !== operationId) throw new Error('Scope acknowledgement mismatch');
            if (path === '/workspace/catalog-write') {
                const record = z.object({ id: identity, accountId: identity.optional(), updatedAt: date.optional(), removed: z.boolean().optional(), isActive: z.boolean().optional(), isDefault: z.boolean().optional() }).parse(response.snapshot);
                if (body.resourceId && record.id !== body.resourceId) throw new Error('Catalog identity mismatch');
                if (body.remove && body.kind === 'override') { if (record.removed !== true) throw new Error('Delete acknowledgement unavailable'); }
                else if (record.accountId !== scope.accountId || !record.updatedAt || record.updatedAt === body.version || body.remove && (record.isActive !== false || record.isDefault !== false)) throw new Error('Catalog acknowledgement mismatch');
            } else {
                const record = z.object({ id: identity, accountId: identity }).parse(response.value);
                if (record.accountId !== scope.accountId || !['create', 'prepare'].includes(String(body.action)) && record.id !== body.resourceId) throw new Error('Action resource acknowledgement mismatch');
            }
            return response;
        }, `Write unconfirmed/conflicted. Preserve this draft and reconcile operation ${operationId}; closing or aborting does not roll back server/provider work.`);
        if (mutation.isActive()) { if (result.ok) setOperationId(crypto.randomUUID()); else setBlocked(true); }
        return result;
    };
    return { ...mutation, run, blocked, operationId };
}
export function useDraftUnload(dirty: boolean) {
    useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
}

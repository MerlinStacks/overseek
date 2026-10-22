import { z } from 'zod';
import { createHash } from 'crypto';
import { prisma } from '../../utils/prisma';
import { shippingService } from './ShippingService';
const bodySchema = z.object({ operationId: z.string().uuid(), action: z.enum(['prepare', 'draft', 'validate', 'rates', 'create', 'retry', 'reassign']), resourceId: z.string().min(1).max(200), version: z.string().datetime(), orderVersion: z.string().datetime().optional(), policyVersion: z.string().datetime().optional(), packageVersion: z.string().datetime().optional(), data: z.record(z.string(), z.unknown()) }).strict();
const size = z.number().int().positive().max(10000000);
const address = z.object({ address1: z.string().trim().min(1).max(200), address2: z.string().max(200), suburb: z.string().trim().min(1).max(100), state: z.string().trim().min(1).max(100), postcode: z.string().trim().min(1).max(20), country: z.string().regex(/^[A-Z]{2}$/) }).strict();
const draftFields = z.object({ correctedAddress: address.optional(), selectedPackagePresetId: z.string().min(1).max(200).nullable().optional(), manualOuterLengthMm: size.nullable().optional(), manualOuterWidthMm: size.nullable().optional(), manualOuterHeightMm: size.nullable().optional(), manualWeightGrams: size.nullable().optional(), selectedServiceCode: z.string().trim().min(1).max(80).optional() }).strict().refine(value => Object.keys(value).length > 0);
const conflict = () => Object.assign(new Error('Workspace action changed/unconfirmed; reconcile original occurrence'), { statusCode: 409 });
export const shippingWorkspaceActionSchema = bodySchema;
export async function runWorkspaceAction(accountId: string, actorId: string, input: unknown) {
    const body = bodySchema.parse(input), print = body.action === 'retry' || body.action === 'reassign';
    let data: Record<string, unknown>;
    if (body.action === 'draft') data = draftFields.parse(body.data);
    else if (body.action === 'reassign') data = z.object({ printStationId: z.string().min(1).max(200) }).strict().parse(body.data);
    else data = z.object({}).strict().parse(body.data);
    if (!print && !body.orderVersion) throw conflict();
    const id = `shipping-workspace:${accountId}:${body.operationId}`, gateId = `shipping-workspace-gate:${accountId}:${print ? 'job' : 'draft'}:${body.resourceId}`, digest = createHash('sha256').update(JSON.stringify([actorId, body])).digest('hex');
    const admitted = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gateId}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const value = receipt.result as any; if (value.digest !== digest || value.state !== 'complete') throw conflict(); return { replay: true as const, value: value.value }; }
        const gate = await tx.scopedOperation.findUnique({ where: { id: gateId } });
        if (gate && (gate.result as any).state !== 'complete') throw conflict();
        let wooOrderId: number | null = null;
        if (print) {
            const job = await tx.shippingPrintJob.findFirst({ where: { accountId, id: body.resourceId }, select: { updatedAt: true, attempts: true, printStationId: true, label: { select: { cancelledAt: true, labelStoredUntil: true } } } });
            if (!job || job.updatedAt.toISOString() !== body.version || job.attempts !== 0) throw conflict();
            if (job.label.cancelledAt || !job.label.labelStoredUntil || job.label.labelStoredUntil.getTime() <= Date.now()) throw conflict();
            const stationId = body.action === 'reassign' ? String(data.printStationId) : job.printStationId;
            const station = stationId ? await tx.shippingPrintStation.findFirst({ where: { id: stationId, accountId }, select: { lastSeenAt: true, status: true } }) : null;
            const age = station?.lastSeenAt ? Date.now() - station.lastSeenAt.getTime() : Infinity;
            if (!station || station.status !== 'online' || age < -60000 || age > 90000) throw conflict();
        } else if (body.action === 'prepare') {
            const order = await tx.wooOrder.findFirst({ where: { accountId, id: body.resourceId, updatedAt: new Date(body.version) }, select: { wooId: true } });
            if (!order) throw conflict(); wooOrderId = order.wooId;
        } else {
            const draft = await tx.shippingShipmentDraft.findFirst({ where: { accountId, id: body.resourceId } });
            if (!draft || draft.updatedAt.toISOString() !== body.version) throw conflict();
            const order = await tx.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: draft.wooOrderId } }, select: { updatedAt: true } });
            if (!order || order.updatedAt.toISOString() !== body.orderVersion) throw conflict(); wooOrderId = draft.wooOrderId;
            if (['validate', 'rates', 'create'].includes(body.action)) {
                const policy = await tx.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST', isEnabled: true }, select: { updatedAt: true, config: true } });
                if (!policy || policy.updatedAt.toISOString() !== body.policyVersion) throw conflict();
                if (body.action === 'create') {
                    if (!['remote_print', 'open_pdf'].includes(String((policy.config as any)?.printDeliveryMethod)) || draft.readinessStatus !== 'ready' || draft.addressValidationStatus !== 'valid') throw conflict();
                    if ((policy.config as any)?.printDeliveryMethod === 'remote_print') {
                        const destination = draft.selectedPrintStationId || (policy.config as any)?.defaultPrintStationId;
                        if (typeof destination !== 'string') throw conflict();
                        const station = await tx.shippingPrintStation.findFirst({ where: { accountId, id: destination }, select: { lastSeenAt: true, status: true } });
                        const age = station?.lastSeenAt ? Date.now() - station.lastSeenAt.getTime() : Infinity;
                        if (!station || station.status !== 'online' || age < -60000 || age > 90000) throw conflict();
                    }
                    if (draft.selectedPackagePresetId) { const pkg = await tx.shippingPackagePreset.findFirst({ where: { accountId, id: draft.selectedPackagePresetId, isActive: true } }); if (!pkg || pkg.updatedAt.toISOString() !== body.packageVersion) throw conflict(); }
                    else if (![draft.manualOuterLengthMm, draft.manualOuterWidthMm, draft.manualOuterHeightMm, draft.manualWeightGrams].every(value => typeof value === 'number' && value > 0 && value <= 10000000)) throw conflict();
                }
            }
            if (body.action === 'draft') {
                if (data.selectedPackagePresetId && !await tx.shippingPackagePreset.findFirst({ where: { id: String(data.selectedPackagePresetId), accountId, isActive: true } })) throw conflict();
                const dims = [data.manualOuterLengthMm, data.manualOuterWidthMm, data.manualOuterHeightMm, data.manualWeightGrams];
                if (dims.some(value => value !== undefined && value !== null) && (!dims.every(value => typeof value === 'number') || data.selectedPackagePresetId !== null)) throw conflict();
            }
        }
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-workspace', result: { digest, state: 'pending', resourceId: body.resourceId, action: body.action } } });
        await tx.scopedOperation.upsert({ where: { id: gateId }, create: { id: gateId, accountId, kind: 'shipping-workspace-gate', result: { state: 'pending', id } }, update: { result: { state: 'pending', id } } });
        return { replay: false as const, wooOrderId };
    });
    if (admitted.replay) return admitted.value;
    try {
        let value: unknown;
        if (body.action === 'prepare') value = await prisma.$transaction(async tx => {
            const order = await tx.wooOrder.findFirst({ where: { accountId, id: body.resourceId, updatedAt: new Date(body.version) }, select: { id: true, wooId: true } });
            if (!order) throw conflict();
            return await tx.shippingShipmentDraft.findFirst({ where: { accountId, wooOrderId: order.wooId } }) ?? await tx.shippingShipmentDraft.create({ data: { accountId, orderId: order.id, wooOrderId: order.wooId, readinessStatus: 'pending', addressValidationStatus: 'pending', updatedByUserId: actorId } });
        });
        else if (body.action === 'retry') value = await shippingService.retryPrintJob(accountId, body.resourceId, actorId, body.version);
        else if (body.action === 'reassign') value = await shippingService.reassignPrintJob(accountId, body.resourceId, String(data.printStationId), actorId, body.version);
        else if (body.action === 'draft') value = await shippingService.updateDraft(accountId, admitted.wooOrderId!, data, actorId, body.version);
        else if (body.action === 'validate') value = await shippingService.validateAddress(accountId, admitted.wooOrderId!, actorId, body.version);
        else if (body.action === 'rates') value = await shippingService.requestDraftRates(accountId, admitted.wooOrderId!, actorId, body.version);
        else value = await shippingService.createAndQueueLabelPlaceholder(accountId, admitted.wooOrderId!, actorId, null, { draftVersion: body.version, orderVersion: body.orderVersion!, policyVersion: body.policyVersion!, packageVersion: body.packageVersion });
        const safe = JSON.parse(JSON.stringify(value));
        await prisma.$transaction(async tx => {
            await tx.scopedOperation.update({ where: { id }, data: { result: { digest, state: 'complete', value: safe } } });
            await tx.scopedOperation.update({ where: { id: gateId }, data: { result: { state: 'complete', id } } });
        });
        return safe;
    } catch { await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { digest, state: 'uncertain', resourceId: body.resourceId, action: body.action } } }).catch(() => undefined); throw conflict(); }
}

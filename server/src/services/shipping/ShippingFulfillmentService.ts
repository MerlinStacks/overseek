import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { z } from 'zod';
import { scopeId } from '../BoundedProviderWork';
type MetaEntry = { key: string; value: unknown };
class ShippingFulfillmentService {
    async syncPrintedLabel(accountId: string, labelId: string) {
        scopeId.parse(accountId); scopeId.parse(labelId);
        const id = `shipping-fulfillment-provider:${accountId}:${labelId}`;
        const { label, order } = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
            if (await tx.scopedOperation.findUnique({ where: { id } })) throw new Error('Fulfillment already admitted; reconcile original receipt');
            const label = await tx.shippingLabel.findFirst({ where: { id: labelId, accountId } });
            if (!label || label.cancelledAt || !['label_ready', 'printed'].includes(label.status)) throw new Error('Label not eligible for fulfillment');
            const order = await tx.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: label.wooOrderId } } });
            const carrier = await tx.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST', isEnabled: true }, select: { config: true } });
            const dispatch = z.object({ dispatchStatus: z.string().trim().min(1).max(80).optional() }).passthrough().parse(carrier?.config ?? {}).dispatchStatus ?? 'In Dispatch';
            const normalized = (value: string) => value.trim().toLowerCase().replace(/^wc-/, '').replace(/\s+/g, '-');
            const status = normalized(order?.status ?? '');
            if (!order || ['cancelled', 'refunded', 'failed', 'pending'].includes(status) || !['processing', 'on-hold', 'completed', normalized(dispatch)].includes(status)) throw new Error('Order not eligible for fulfillment');
            await tx.scopedOperation.create({ data: { id, accountId, kind: 'shipping-fulfillment-provider', result: { state: 'pending', labelId, labelVersion: label.updatedAt.toISOString(), orderId: order.id, orderVersion: order.updatedAt.toISOString() } } });
            return { label, order };
        });
        const result = { localOrderUpdated: false, wooOrderUpdated: false, wooNoteCreated: false, wooNoteId: null as number | null, shippingCostRecorded: false, skippedReason: null as string | null, error: null as string | null };
        const checkpoint = async (state: string) => prisma.scopedOperation.update({ where: { id }, data: { result: { state, labelId, orderId: order.id, ...result } } });
        try {
            const meta: MetaEntry[] = [
                { key: '_overseek_shipping_label_id', value: label.id }, { key: '_overseek_shipping_carrier', value: label.carrier },
                ...Object.entries({ service_code: label.serviceCode, service_name: label.serviceName, tracking_number: label.trackingNumber, tracking_url: label.trackingUrl }).filter(([, value]) => value != null).map(([key, value]) => ({ key: `_overseek_shipping_${key}`, value })),
            ];
            const cost = label.costAmount == null ? null : Number(label.costAmount);
            const costKnown = cost !== null && Number.isFinite(cost) && cost >= 0 && cost <= 1e9 && !!label.costCurrency && /^[A-Z]{3}$/.test(label.costCurrency);
            if (costKnown) meta.push({ key: '_overseek_shipping_label_cost', value: String(cost) }, { key: '_overseek_shipping_label_currency', value: label.costCurrency });
            if (label.printedAt) meta.push({ key: '_overseek_shipping_printed_at', value: label.printedAt.toISOString() });
            const woo = await WooService.forAccount(accountId);
            // Woo order/note helpers are single requests; the durable inner and outer gates forbid retries.
            const ack = z.object({ id: z.number().int().positive(), status: z.literal('completed'), meta_data: z.array(z.object({ key: z.string(), value: z.unknown() })).max(2000), date_modified_gmt: z.string().nullable().optional() }).parse(await woo.updateOrder(label.wooOrderId, { status: 'completed', meta_data: meta }));
            if (ack.id !== label.wooOrderId || meta.some(entry => !ack.meta_data.some(actual => actual.key === entry.key && String(actual.value) === String(entry.value)))) throw new Error('Fulfillment provider acknowledgement incomplete');
            result.wooOrderUpdated = true; result.shippingCostRecorded = costKnown; await checkpoint('provider-order-acknowledged');
            await prisma.$transaction(async tx => {
                const currentLabel = await tx.shippingLabel.findFirst({ where: { id: label.id, accountId, updatedAt: label.updatedAt, cancelledAt: null } });
                if (!currentLabel) throw new Error('Label changed during fulfillment');
                const current = await tx.wooOrder.findFirst({ where: { id: order.id, accountId, updatedAt: order.updatedAt } });
                if (!current) throw new Error('Order changed during fulfillment');
                const raw = current.rawData && typeof current.rawData === 'object' && !Array.isArray(current.rawData) ? current.rawData as Record<string, unknown> : {};
                const previousMeta = Array.isArray(raw.meta_data) ? raw.meta_data.filter((entry): entry is MetaEntry => !!entry && typeof entry === 'object' && typeof (entry as MetaEntry).key === 'string') : [];
                const merged = { ...raw, status: 'completed', meta_data: [...previousMeta.filter(entry => !meta.some(value => value.key === entry.key)), ...meta] };
                const modified = ack.date_modified_gmt ? new Date(z.string().datetime().parse(`${ack.date_modified_gmt.replace(/Z$/, '')}Z`)) : null;
                if (modified && !Number.isFinite(+modified)) throw new Error('Invalid provider modification time');
                const changed = await tx.wooOrder.updateMany({ where: { id: order.id, accountId, updatedAt: current.updatedAt }, data: { status: 'completed', rawData: merged as any, ...(modified ? { dateModified: modified } : {}) } });
                if (changed.count !== 1) throw new Error('Local fulfillment merge conflict');
            });
            result.localOrderUpdated = true; await checkpoint('local-order-acknowledged');
            const note = z.object({ id: z.number().int().positive() }).parse(await woo.createOrderNote(label.wooOrderId, { customer_note: false, note: `OverSeek Shipping Hub fulfillment label ${label.id}\nCarrier: ${label.carrier}${label.trackingNumber ? `\nTracking: ${label.trackingNumber}` : ''}${label.printedAt ? `\nRecorded print time: ${label.printedAt.toISOString()}` : '\nPrint time: unavailable'}${costKnown ? `\nLabel cost: ${label.costCurrency} ${cost}` : '\nLabel cost/currency: unavailable'}` }));
            result.wooNoteCreated = true; result.wooNoteId = note.id; await checkpoint('complete'); return result;
        } catch {
            result.error = 'Fulfillment partially applied or uncertain; reconcile provider order, local version and note receipt before another attempt';
            await checkpoint('uncertain').catch(() => undefined); return result;
        }
    }
}
export const shippingFulfillmentService = new ShippingFulfillmentService();

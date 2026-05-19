import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { WooService } from '../woo';

type MetaEntry = { key: string; value: unknown };

class ShippingFulfillmentService {
    async syncPrintedLabel(accountId: string, labelId: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');

        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: label.wooOrderId } } });
        if (!order) {
            return {
                localOrderUpdated: false,
                wooOrderUpdated: false,
                wooNoteCreated: false,
                shippingCostRecorded: false,
                skippedReason: 'Order not found locally',
            };
        }

        const alreadySynced = this.hasMetaValue(order.rawData as Record<string, unknown>, '_overseek_shipping_label_id', label.id);
        const fulfillmentMeta = this.buildFulfillmentMeta(label);
        const rawData = this.mergeOrderRawData(order.rawData as Record<string, unknown>, fulfillmentMeta);

        await prisma.wooOrder.update({
            where: { id: order.id },
            data: {
                status: 'completed',
                rawData: rawData as any,
                dateModified: new Date(),
            },
        });

        const result = {
            localOrderUpdated: true,
            wooOrderUpdated: false,
            wooNoteCreated: false,
            shippingCostRecorded: label.costAmount != null,
            skippedReason: null as string | null,
            error: null as string | null,
        };

        try {
            const woo = await WooService.forAccount(accountId);
            await woo.updateOrder(label.wooOrderId, { status: 'completed', meta_data: fulfillmentMeta });
            result.wooOrderUpdated = true;

            if (!alreadySynced) {
                await woo.createOrderNote(label.wooOrderId, {
                    note: this.buildOrderNote(label),
                    customer_note: false,
                });
                result.wooNoteCreated = true;
            }
        } catch (error: any) {
            result.error = error?.message || 'WooCommerce fulfillment sync failed';
            Logger.warn('[ShippingFulfillmentService] WooCommerce fulfillment sync failed', { accountId, labelId, wooOrderId: label.wooOrderId, error: result.error });
        }

        return result;
    }

    private buildFulfillmentMeta(label: any): MetaEntry[] {
        return [
            { key: '_overseek_shipping_label_id', value: label.id },
            { key: '_overseek_shipping_carrier', value: label.carrier },
            { key: '_overseek_shipping_service_code', value: label.serviceCode || '' },
            { key: '_overseek_shipping_service_name', value: label.serviceName || '' },
            { key: '_overseek_shipping_tracking_number', value: label.trackingNumber || '' },
            { key: '_overseek_shipping_tracking_url', value: label.trackingUrl || '' },
            { key: '_overseek_shipping_label_cost', value: label.costAmount != null ? String(label.costAmount) : '' },
            { key: '_overseek_shipping_label_currency', value: label.costCurrency || 'AUD' },
            { key: '_overseek_shipping_printed_at', value: new Date().toISOString() },
        ];
    }

    private mergeOrderRawData(rawData: Record<string, unknown>, fulfillmentMeta: MetaEntry[]) {
        const existingMeta = Array.isArray(rawData.meta_data) ? rawData.meta_data as MetaEntry[] : [];
        const nextMeta = existingMeta.filter((entry) => !fulfillmentMeta.some((meta) => meta.key === entry.key));
        nextMeta.push(...fulfillmentMeta);
        return { ...rawData, status: 'completed', meta_data: nextMeta };
    }

    private hasMetaValue(rawData: Record<string, unknown>, key: string, value: string) {
        const metaData = Array.isArray(rawData.meta_data) ? rawData.meta_data as MetaEntry[] : [];
        return metaData.some((entry) => entry.key === key && entry.value === value);
    }

    private buildOrderNote(label: any) {
        const parts = [
            `OverSeek Shipping Hub printed ${label.carrier} label`,
            label.serviceName ? `Service: ${label.serviceName}` : null,
            label.trackingNumber ? `Tracking: ${label.trackingNumber}` : null,
            label.trackingUrl ? `Tracking URL: ${label.trackingUrl}` : null,
            label.costAmount != null ? `Label cost: ${label.costCurrency || 'AUD'} ${label.costAmount}` : null,
        ].filter(Boolean);
        return parts.join('\n');
    }
}

export const shippingFulfillmentService = new ShippingFulfillmentService();

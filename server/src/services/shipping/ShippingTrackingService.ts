import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { automationEngine } from '../AutomationEngine';
import { ausPostShippingTrackingAdapter } from './AusPostShippingTrackingAdapter';

type ShipmentTriggerType =
    | 'SHIPMENT_RECEIVED_BY_CARRIER'
    | 'SHIPMENT_IN_TRANSIT'
    | 'SHIPMENT_OUT_FOR_DELIVERY'
    | 'SHIPMENT_DELIVERY_ATTEMPTED'
    | 'SHIPMENT_DELIVERED'
    | 'SHIPMENT_EXCEPTION';

interface TrackingInput {
    eventCode?: string | null;
    status?: string | null;
    description?: string | null;
    location?: string | null;
    occurredAt?: string | Date | null;
    rawEvent?: Record<string, unknown>;
}

interface NormalizedTrackingEvent {
    normalizedState: string;
    normalizedMilestone: string | null;
    triggerType: ShipmentTriggerType | null;
    terminal: boolean;
    customerEmailSafe: boolean;
}

const TERMINAL_STATES = new Set(['delivered', 'returned', 'cancelled', 'expired']);
const DEFAULT_TRIGGER_ALLOWLIST: ShipmentTriggerType[] = [];

export class ShippingTrackingService {
    async getTrackingHealthSummary(accountId: string) {
        const now = Date.now();
        const last24Hours = new Date(now - 24 * 60 * 60 * 1000);
        const staleBefore = new Date(now - 30 * 60 * 1000);

        const [activeTrackedLabels, staleTrackedLabels, recentPollFailures, recentAdapterUnavailable] = await Promise.all([
            prisma.shippingLabel.count({
                where: {
                    accountId,
                    trackingNumber: { not: null },
                    status: { notIn: ['cancelled', 'delivered', 'returned', 'expired', 'exception'] },
                },
            }),
            prisma.shippingLabel.count({
                where: {
                    accountId,
                    trackingNumber: { not: null },
                    status: { notIn: ['cancelled', 'delivered', 'returned', 'expired', 'exception'] },
                    OR: [{ trackingSyncedAt: null }, { trackingSyncedAt: { lt: staleBefore } }],
                },
            }),
            prisma.shippingAuditEvent.count({
                where: {
                    accountId,
                    eventType: 'TRACKING_POLL_FAILED',
                    createdAt: { gte: last24Hours },
                },
            }),
            prisma.shippingAuditEvent.count({
                where: {
                    accountId,
                    eventType: 'TRACKING_POLL_ADAPTER_UNAVAILABLE',
                    createdAt: { gte: last24Hours },
                },
            }),
        ]);

        const status = recentPollFailures > 0 || recentAdapterUnavailable > 0
            ? 'attention'
            : staleTrackedLabels > 0
                ? 'degraded'
                : 'healthy';

        return {
            status,
            windowHours: 24,
            activeTrackedLabels,
            staleTrackedLabels,
            recentPollFailures,
            recentAdapterUnavailable,
        };
    }

    async refreshTrackingFromCarrier(accountId: string, labelId: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        if (!label.trackingNumber) throw new Error('Label does not have a tracking number');
        const events = await ausPostShippingTrackingAdapter.refreshTracking(accountId, label.trackingNumber);
        for (const event of events) {
            await this.recordTrackingEvent(accountId, label.id, event);
        }
        await prisma.shippingAuditEvent.create({
            data: {
                accountId,
                labelId: label.id,
                orderId: label.orderId,
                eventType: 'TRACKING_REFRESH_COMPLETED',
                metadata: {
                    trackingNumber: label.trackingNumber,
                    eventsImported: events.length,
                } as any,
            },
        });
        return { labelId: label.id, trackingNumber: label.trackingNumber, eventsImported: events.length };
    }

    async pollActiveLabels(accountId: string, limit = 25) {
        const pollingConfig = await this.getPollingConfig(accountId);
        const staleBefore = new Date(Date.now() - pollingConfig.pollIntervalMinutes * 60 * 1000);
        const labels = await prisma.shippingLabel.findMany({
            where: {
                accountId,
                trackingNumber: { not: null },
                status: { notIn: ['cancelled', 'delivered', 'returned', 'expired', 'exception'] },
                OR: [
                    { trackingSyncedAt: null },
                    { trackingSyncedAt: { lt: staleBefore } },
                ],
            },
            orderBy: [{ trackingSyncedAt: 'asc' }, { createdAt: 'asc' }],
            take: limit,
            select: { id: true },
        });

        const result = { checked: labels.length, updated: 0, failed: 0, adapterUnavailable: 0 };
        for (const label of labels) {
            try {
                await this.refreshTrackingFromCarrier(accountId, label.id);
                result.updated++;
            } catch (error: any) {
                if (error?.message === 'AusPost tracking endpoint mapping is not configured yet') {
                    result.adapterUnavailable++;
                    await prisma.shippingAuditEvent.create({
                        data: {
                            accountId,
                            labelId: label.id,
                            eventType: 'TRACKING_POLL_ADAPTER_UNAVAILABLE',
                            metadata: { error: error?.message || 'Adapter unavailable' } as any,
                        },
                    });
                } else {
                    result.failed++;
                    Logger.warn('[ShippingTrackingService] Tracking poll failed', { accountId, labelId: label.id, error: error?.message || error });
                    await prisma.shippingLabel.update({
                        where: { id: label.id },
                        data: { trackingSyncedAt: new Date(Date.now() + pollingConfig.failureBackoffMinutes * 60 * 1000) },
                    });
                    await prisma.shippingAuditEvent.create({
                        data: {
                            accountId,
                            labelId: label.id,
                            eventType: 'TRACKING_POLL_FAILED',
                            metadata: {
                                error: error?.message || 'Tracking poll failed',
                                failureBackoffMinutes: pollingConfig.failureBackoffMinutes,
                            } as any,
                        },
                    });
                }
            }
        }

        return result;
    }

    async recordTrackingEvent(accountId: string, labelId: string, input: TrackingInput) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');

        const normalized = this.normalizeTrackingEvent(input);
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        const eventCode = input.eventCode || `${normalized.normalizedState}:${occurredAt.toISOString()}`;

        const event = await prisma.shippingTrackingEvent.upsert({
            where: { labelId_eventCode_occurredAt: { labelId, eventCode, occurredAt } },
            update: {
                status: input.status || normalized.normalizedState,
                description: input.description || null,
                location: input.location || null,
                rawEvent: input.rawEvent || {},
            },
            create: {
                accountId,
                labelId,
                carrier: label.carrier,
                trackingNumber: label.trackingNumber,
                eventCode,
                normalizedState: normalized.normalizedState,
                normalizedMilestone: normalized.normalizedMilestone,
                status: input.status || normalized.normalizedState,
                description: input.description || null,
                location: input.location || null,
                occurredAt,
                rawEvent: input.rawEvent || {},
            },
        });

        await prisma.shippingLabel.update({
            where: { id: label.id },
            data: {
                latestTrackingStatus: normalized.normalizedState,
                latestTrackingSummary: input.description || input.status || normalized.normalizedState,
                trackingSyncedAt: new Date(),
            },
        });

        if (normalized.triggerType && normalized.customerEmailSafe && await this.isAutomationTriggerAllowed(accountId, normalized.triggerType)) {
            await this.dispatchAutomationForEvent(accountId, label.id, event.id, normalized.triggerType);
        }

        return { event, normalized };
    }

    normalizeTrackingEvent(input: TrackingInput): NormalizedTrackingEvent {
        const text = `${input.eventCode || ''} ${input.status || ''} ${input.description || ''}`.toLowerCase();

        if (/(delivered|successfully delivered)/.test(text)) return this.result('delivered', 'delivered', 'SHIPMENT_DELIVERED');
        if (/(out for delivery|onboard for delivery|on board for delivery)/.test(text)) return this.result('out_for_delivery', 'out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY');
        if (/(attempted|card left|awaiting collection|collection point)/.test(text)) return this.result(text.includes('awaiting collection') ? 'awaiting_collection' : 'delivery_attempted', 'delivery_attempted', 'SHIPMENT_DELIVERY_ATTEMPTED');
        if (/(lodged|accepted|received|picked up|pickup|we've got it|we have got it)/.test(text)) return this.result('received_by_carrier', 'received_by_carrier', 'SHIPMENT_RECEIVED_BY_CARRIER');
        if (/(delay|delayed|held|exception|return to sender|returned|damaged|lost|address issue|failed)/.test(text)) {
            const state = /(returned|return to sender)/.test(text) ? 'returned' : 'exception';
            return this.result(state, 'exception', 'SHIPMENT_EXCEPTION');
        }
        if (/(cancelled|canceled)/.test(text)) return this.result('cancelled', null, null, false);
        if (/(expired)/.test(text)) return this.result('expired', null, null, false);
        if (/(transit|processed|sorted|transferred|facility|depot)/.test(text)) return this.result('in_transit', 'in_transit', 'SHIPMENT_IN_TRANSIT');

        return this.result('pending', null, null, false);
    }

    private result(normalizedState: string, normalizedMilestone: string | null, triggerType: ShipmentTriggerType | null, customerEmailSafe = true): NormalizedTrackingEvent {
        return {
            normalizedState,
            normalizedMilestone,
            triggerType,
            terminal: TERMINAL_STATES.has(normalizedState),
            customerEmailSafe,
        };
    }

    private async dispatchAutomationForEvent(accountId: string, labelId: string, trackingEventId: string, triggerType: ShipmentTriggerType) {
        const label = await prisma.shippingLabel.findFirst({
            where: { id: labelId, accountId },
            include: { trackingEvents: { where: { id: trackingEventId }, take: 1 } },
        });
        if (!label) return;
        const event = label.trackingEvents[0];
        if (!event) return;

        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: label.wooOrderId } } });
        const raw = (order?.rawData as any) || {};
        const email = order?.billingEmail || raw.billing?.email;
        if (!email) {
            Logger.warn('[ShippingTrackingService] Skipping shipment automation without email', { accountId, labelId, trackingEventId });
            return;
        }

        const existing = await prisma.shippingAutomationDispatch.findUnique({
            where: { accountId_trackingEventId_triggerType_email: { accountId, trackingEventId, triggerType, email } },
        });
        if (existing) return;

        await prisma.shippingAutomationDispatch.create({
            data: { accountId, labelId, trackingEventId, triggerType, email, status: 'dispatching' },
        });

        try {
            await automationEngine.processTrigger(accountId, triggerType, {
                id: label.wooOrderId,
                orderId: order?.id || String(label.wooOrderId),
                wooId: label.wooOrderId,
                wooOrderId: label.wooOrderId,
                orderNumber: order?.number || String(label.wooOrderId),
                email,
                billing: raw.billing,
                customerName: [raw.billing?.first_name, raw.billing?.last_name].filter(Boolean).join(' '),
                trackingNumber: label.trackingNumber,
                trackingUrl: label.trackingUrl,
                carrier: label.carrier,
                serviceName: label.serviceName,
                shipmentStatus: event.normalizedState || event.status,
                scanEventCode: event.eventCode,
                scanEventDescription: event.description,
                scanEventLocation: event.location,
                scanEventOccurredAt: event.occurredAt,
                labelId: label.id,
                shippingLabelId: label.id,
                shipment: {
                    trackingNumber: label.trackingNumber,
                    trackingUrl: label.trackingUrl,
                    carrier: label.carrier,
                    serviceName: label.serviceName,
                    status: event.normalizedState || event.status,
                    latestScanDescription: event.description,
                    latestScanLocation: event.location,
                    latestScanTime: event.occurredAt,
                },
            });

            await prisma.shippingAutomationDispatch.update({
                where: { accountId_trackingEventId_triggerType_email: { accountId, trackingEventId, triggerType, email } },
                data: { status: 'dispatched', dispatchedAt: new Date() },
            });
            await prisma.shippingTrackingEvent.update({ where: { id: trackingEventId }, data: { automationDispatchedAt: new Date(), automationTriggerType: triggerType } });
        } catch (error: any) {
            await prisma.shippingAutomationDispatch.update({
                where: { accountId_trackingEventId_triggerType_email: { accountId, trackingEventId, triggerType, email } },
                data: { status: 'failed', errorMessage: error?.message || 'Automation dispatch failed' },
            });
            throw error;
        }
    }

    private async isAutomationTriggerAllowed(accountId: string, triggerType: ShipmentTriggerType) {
        const settings = await prisma.shippingCarrierAccount.findFirst({
            where: { accountId, carrier: 'AUSPOST' },
            select: { config: true },
        });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        const configured = Array.isArray(config.trackingAutomationAllowlist)
            ? config.trackingAutomationAllowlist.map((entry) => String(entry))
            : DEFAULT_TRIGGER_ALLOWLIST;
        return configured.includes(triggerType);
    }

    private async getPollingConfig(accountId: string) {
        const settings = await prisma.shippingCarrierAccount.findFirst({
            where: { accountId, carrier: 'AUSPOST' },
            select: { config: true },
        });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        const pollIntervalMinutes = this.coerceNumber(config.trackingPollIntervalMinutes, 30, 5, 180);
        const failureBackoffMinutes = this.coerceNumber(config.trackingPollFailureBackoffMinutes, 60, 10, 360);
        return { pollIntervalMinutes, failureBackoffMinutes };
    }

    private coerceNumber(value: unknown, fallback: number, min: number, max: number) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.min(max, Math.max(min, Math.floor(numeric)));
    }
}

export const shippingTrackingService = new ShippingTrackingService();

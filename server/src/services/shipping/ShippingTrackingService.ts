import { prisma } from '../../utils/prisma';
import type { Prisma } from '@prisma/client';
import { Logger } from '../../utils/logger';
import { ausPostShippingTrackingAdapter } from './AusPostShippingTrackingAdapter';
import { z } from 'zod';
import { admittedTracking, TrackingReadError } from './TrackingAdmission';
import { recordCriticalEvent } from '../CriticalEventOutbox';
import { EVENTS } from '../events';
import { createHash } from 'crypto';

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
const ACTIVE_TRACKING_STATUSES = ['cancelled', 'delivered', 'returned', 'expired'];

export class ShippingTrackingService {
    async getTrackingHealthSummary(accountId: string) {
        const now = Date.now();
        const last24Hours = new Date(now - 24 * 60 * 60 * 1000);
        const staleBefore = new Date(now - 30 * 60 * 1000);
        const activeWhere: Prisma.ShippingLabelWhereInput = { accountId, trackingNumber: { not: null }, status: { notIn: ACTIVE_TRACKING_STATUSES }, AND: [{ OR: [{ latestTrackingStatus: null }, { latestTrackingStatus: { notIn: ACTIVE_TRACKING_STATUSES } }] }] };

        const [activeTrackedLabels, staleTrackedLabels, recentPollFailures, recentAdapterUnavailable] = await Promise.all([
            prisma.shippingLabel.count({
                where: activeWhere,
            }),
            prisma.shippingLabel.count({
                where: {
                    ...activeWhere,
                    OR: [{ trackingSyncedAt: null }, { trackingSyncedAt: { lt: staleBefore } }, { trackingSyncedAt: { gt: new Date(now) } }, { trackingLastOutcome: { in: ['partial', 'read-failed', 'failed-or-uncertain'] } }],
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
                : activeTrackedLabels > 0 ? 'observed' : 'unavailable';

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
        const scans = z.array(z.object({ eventCode: z.string().max(200).nullish(), status: z.string().max(200).nullish(), description: z.string().max(2000).nullish(), location: z.string().max(1000).nullish(), occurredAt: z.union([z.string().datetime({ offset: true }), z.date()]), rawEvent: z.record(z.string(), z.unknown()).optional() })).max(100);
        const read = async () => {
            const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
            if (!label) throw new Error('Label not found');
            if (!label.trackingNumber) throw new Error('Label does not have a tracking number');
            const events = scans.parse(await ausPostShippingTrackingAdapter.refreshTracking(accountId, label.trackingNumber));
            if (JSON.stringify(events).length > 250000) throw new Error('Tracking import exceeds bounds');
            return { label, events };
        };
        const { label, events } = await read().catch(error => { throw new TrackingReadError(error); });
        let imported = 0;
        let hadError = false;
        for (const event of events) {
            try {
                await this.recordTrackingEvent(accountId, label.id, event);
                imported++;
            } catch (error: any) {
                hadError = true;
                Logger.warn('[ShippingTrackingService] Failed to record tracking event', { labelId: label.id, error: error?.message || error });
            }
        }
        await prisma.shippingAuditEvent.create({
            data: {
                accountId,
                labelId: label.id,
                orderId: label.orderId,
                eventType: 'TRACKING_REFRESH_COMPLETED',
                metadata: {
                    trackingNumber: label.trackingNumber,
                    eventsImported: imported,
                    eventsTotal: events.length,
                    hadErrors: hadError,
                } as any,
            },
        });
        await prisma.shippingLabel.update({ where: { id: label.id, accountId }, data: hadError ? { trackingLastOutcome: 'partial' } : { trackingSyncedAt: new Date(), trackingLastOutcome: 'complete', trackingNextAttemptAt: null } });
        if (hadError) throw new Error('Tracking import partial; reconcile original occurrence');
        return { labelId: label.id, trackingNumber: label.trackingNumber, eventsImported: imported, eventsTotal: events.length, hadErrors: false };
    }

    async pollActiveLabels(accountId: string, limit = 25) {
        z.number().int().min(1).max(25).parse(limit);
        const pollingConfig = await this.getPollingConfig(accountId);
        const staleBefore = new Date(Date.now() - pollingConfig.pollIntervalMinutes * 60 * 1000);
        const labels = await prisma.shippingLabel.findMany({
            where: {
                accountId,
                trackingNumber: { not: null },
                status: { notIn: ACTIVE_TRACKING_STATUSES },
                AND: [{ OR: [{ latestTrackingStatus: null }, { latestTrackingStatus: { notIn: ACTIVE_TRACKING_STATUSES } }] }, { OR: [{ trackingNextAttemptAt: null }, { trackingNextAttemptAt: { lte: new Date() } }] }],
                OR: [
                    { trackingSyncedAt: null },
                    { trackingSyncedAt: { lt: staleBefore } },
                ],
            },
            orderBy: [{ trackingSyncedAt: 'asc' }, { createdAt: 'asc' }],
            take: limit,
            select: { id: true, updatedAt: true },
        });

        const result = { checked: labels.length, updated: 0, failed: 0, adapterUnavailable: 0 };
        for (const label of labels) {
            try {
                await admittedTracking(accountId, label.id, `poll:${Math.floor(Date.now() / 1800000)}`, label.updatedAt.toISOString(), () => this.refreshTrackingFromCarrier(accountId, label.id));
                result.updated++;
            } catch (error: any) {
                if (error instanceof TrackingReadError && (error.cause as Error)?.message === 'AusPost tracking endpoint mapping is not configured yet') {
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
                        where: { id: label.id, accountId },
                        data: { trackingNextAttemptAt: new Date(Date.now() + pollingConfig.failureBackoffMinutes * 60 * 1000), trackingLastOutcome: error instanceof TrackingReadError ? 'read-failed' : 'failed-or-uncertain' },
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
        z.string().min(1).max(200).parse(accountId); z.string().min(1).max(200).parse(labelId);
        input = z.object({ eventCode: z.string().max(200).nullish(), status: z.string().max(200).nullish(), description: z.string().max(2000).nullish(), location: z.string().max(1000).nullish(), occurredAt: z.union([z.string().datetime({ offset: true }), z.date()]), rawEvent: z.record(z.string(), z.unknown()).optional() }).strict().parse(input);
        if (JSON.stringify(input).length > 64000) throw new Error('Tracking observation exceeds bounds');
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');

        const normalized = this.normalizeTrackingEvent(input);
        const occurredAt = new Date(input.occurredAt!);
        if (isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 300000) throw new Error('Invalid occurredAt date');
        if (![input.eventCode, input.status, input.description].some(value => typeof value === 'string' && value.trim())) throw new Error('Tracking source observation unavailable');
        const eventCode = input.eventCode || `observed:${createHash('sha256').update(JSON.stringify([input.status ?? null, input.description ?? null, input.location ?? null, occurredAt.toISOString()])).digest('hex')}`;

        const event = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`tracking-observation:${accountId}:${labelId}`}, 0))`;
        const current = await tx.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!current) throw new Error('Label changed');
        const latestKnown = current.latestTrackingOccurredAt ?? (await tx.shippingTrackingEvent.findFirst({ where: { labelId, accountId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }))?.occurredAt ?? null;
        const prior = await tx.shippingTrackingEvent.findUnique({ where: { labelId_eventCode_occurredAt: { labelId, eventCode, occurredAt } }, select: { id: true } });
        const saved = await tx.shippingTrackingEvent.upsert({
            where: { labelId_eventCode_occurredAt: { labelId, eventCode, occurredAt } },
            update: {
                normalizedState: normalized.normalizedState,
                normalizedMilestone: normalized.normalizedMilestone,
                status: input.status || normalized.normalizedState,
                description: input.description || null,
                location: input.location || null,
                rawEvent: (input.rawEvent || {}) as Prisma.InputJsonValue,
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
                rawEvent: (input.rawEvent || {}) as Prisma.InputJsonValue,
            },
        });

        const correctUnknownHead = prior && current.latestTrackingStatus === 'unknown' && normalized.normalizedState !== 'unknown'
            && latestKnown && occurredAt.getTime() === latestKnown.getTime();
        if (!latestKnown || occurredAt.getTime() > latestKnown.getTime() || correctUnknownHead) await tx.shippingLabel.update({
            where: { id: label.id, accountId },
            data: {
                latestTrackingStatus: normalized.normalizedState,
                latestTrackingSummary: input.description || input.status || normalized.normalizedState,
                latestTrackingOccurredAt: occurredAt,
            },
        });
        if (!prior && normalized.triggerType && normalized.customerEmailSafe && (!latestKnown || occurredAt.getTime() > latestKnown.getTime())) {
            const settings = await tx.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, select: { config: true } });
            const allowlist = (settings?.config as Record<string, unknown> | null)?.trackingAutomationAllowlist;
            if (Array.isArray(allowlist) && allowlist.includes(normalized.triggerType)) {
                const order = await tx.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: current.wooOrderId } } });
                const raw = order?.rawData as Record<string, unknown> | null;
                const email = order?.billingEmail;
                if (email && z.string().email().max(254).safeParse(email).success) {
                    const eventName = EVENTS.SHIPMENT[normalized.triggerType.replace('SHIPMENT_', '') as keyof typeof EVENTS.SHIPMENT];
                    const shipment = {
                        trackingNumber: current.trackingNumber, trackingUrl: current.trackingUrl,
                        carrier: current.carrier, serviceName: current.serviceName, status: normalized.normalizedState,
                        latestScanDescription: input.description ?? null, latestScanLocation: input.location ?? null,
                        latestScanTime: occurredAt.toISOString(),
                    };
                    await recordCriticalEvent(tx, eventName, { accountId, shippingLabelId: labelId, shipment: {
                        ...(raw ?? {}), id: current.wooOrderId, orderId: order!.id, wooOrderId: current.wooOrderId,
                        orderNumber: order!.number, email, ...shipment, status: raw?.status,
                        shipmentStatus: normalized.normalizedState, scanEventCode: eventCode,
                        scanEventDescription: input.description ?? null, scanEventLocation: input.location ?? null,
                        scanEventOccurredAt: occurredAt.toISOString(), labelId, shippingLabelId: labelId, shipment,
                    } }, `tracking:${saved.id}:${normalized.triggerType}`);
                }
            }
        }
        return saved;
        });

        return { event, normalized };
    }

    normalizeTrackingEvent(input: TrackingInput): NormalizedTrackingEvent {
        const sources = [input.eventCode, input.status, input.description].filter((value): value is string => typeof value === 'string' && !!value.trim());
        const known: Record<string, [string, string | null, ShipmentTriggerType | null, boolean?]> = {
            'aus lodged': ['received_by_carrier', 'received_by_carrier', 'SHIPMENT_RECEIVED_BY_CARRIER'],
            'received by australia post': ['received_by_carrier', 'received_by_carrier', 'SHIPMENT_RECEIVED_BY_CARRIER'],
            'in transit': ['in_transit', 'in_transit', 'SHIPMENT_IN_TRANSIT'],
            'on board for delivery': ['out_for_delivery', 'out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY'],
            'onboard for delivery': ['out_for_delivery', 'out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY'],
            'out for delivery': ['out_for_delivery', 'out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY'],
            'on board for delivery, expected to be delivered today': ['out_for_delivery', 'out_for_delivery', 'SHIPMENT_OUT_FOR_DELIVERY'],
            'delivered': ['delivered', 'delivered', 'SHIPMENT_DELIVERED'],
            'delivery attempted': ['delivery_attempted', 'delivery_attempted', 'SHIPMENT_DELIVERY_ATTEMPTED'],
            'return to sender': ['returned', 'exception', 'SHIPMENT_EXCEPTION'],
            'cancelled by carrier': ['cancelled', null, null, false],
            'cancelled': ['cancelled', null, null, false],
            'expired': ['expired', null, null, false],
            'delayed due to address issue': ['exception', 'exception', 'SHIPMENT_EXCEPTION'],
        };
        // Provider codes/IDs are often opaque. They must not hide an exact,
        // recognized status, nor may conflicting/negated observations trigger mail.
        const matches = sources.map(source => source.toLowerCase().trim().replace(/[_-]+/g, ' '))
            .flatMap(text => Object.prototype.hasOwnProperty.call(known, text) ? [known[text]] : []);
        const conflicting = new Set(matches.map(value => value[0])).size > 1 || sources.some(source => /\b(?:not|never)\s+(?:yet\s+)?delivered\b/i.test(source));
        const match = conflicting ? undefined : matches[0];
        return match ? this.result(...match) : this.result('unknown', null, null, false);
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

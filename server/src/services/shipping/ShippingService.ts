import { prisma } from '../../utils/prisma';
import type { Prisma } from '@prisma/client';
import { decrypt, encrypt } from '../../utils/encryption';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { shippingFulfillmentService } from './ShippingFulfillmentService';
import { ausPostShippingTrackingAdapter } from './AusPostShippingTrackingAdapter';

export const SHIPPING_FEATURE_KEY = 'SHIPPING_HUB';

export interface ShippingPackageInput {
    name: string;
    type?: string;
    innerLengthMm?: number | null;
    innerWidthMm?: number | null;
    innerHeightMm?: number | null;
    outerLengthMm: number;
    outerWidthMm: number;
    outerHeightMm: number;
    fallbackItemWeightGrams?: number | null;
    forcedPackageWeightGrams?: number | null;
    packagingWeightGrams?: number;
    maxWeightGrams?: number | null;
    selectionPriority?: number;
    carrierProductCode?: string | null;
    isDefault?: boolean;
    isActive?: boolean;
}

export interface ShippingSettingsInput {
    displayName?: string;
    isEnabled?: boolean;
    apiKey?: string;
    apiSecret?: string;
    apiProduct?: string;
    apiEnvironment?: string;
    apiBaseUrl?: string;
    testEndpointPath?: string;
    ratesEndpointPath?: string;
    labelsEndpointPath?: string;
    labelPdfEndpointPath?: string;
    trackingEndpointPath?: string;
    cancellationEndpointPath?: string;
    accountNumber?: string;
    paymentMethod?: '' | 'CHARGE_ACCOUNT' | 'CREDIT_CARD' | 'PAYPAL';
    dispatchStatus?: string;
    senderAddress?: Record<string, unknown>;
    defaultDomesticService?: string;
    defaultExpressService?: string;
    defaultInternationalService?: string;
    shippingMethodServiceMappings?: Array<{ wooShippingMethod: string; auspostServiceCode: string; matchType?: 'exact' | 'contains' }>;
    defaultPackagePresetId?: string;
    labelFormat?: string;
    defaultPrintStationId?: string;
    wooFulfillmentBehavior?: string;
    trackingSyncEnabled?: boolean;
    trackingAutomationAllowlist?: string[];
    trackingPollIntervalMinutes?: number;
    trackingPollFailureBackoffMinutes?: number;
    labelPrintGroup?: string;
    labelLayout?: string;
    labelPaperType?: string;
    printDeliveryMethod?: string;
    labelBranded?: boolean;
}

export interface ShippingItemOverrideInput {
    wooProductId: number;
    wooVariationId?: number | null;
    packagePresetId?: string | null;
    weightGrams?: number | null;
    lengthMm?: number | null;
    widthMm?: number | null;
    heightMm?: number | null;
    packingMode?: string;
    dangerousGoods?: boolean;
    fragile?: boolean;
    customsDescription?: string | null;
    countryOfOrigin?: string | null;
    hsCode?: string | null;
    notes?: string | null;
}

export interface ShippingDraftInput {
    selectedPackagePresetId?: string | null;
    manualOuterLengthMm?: number | null;
    manualOuterWidthMm?: number | null;
    manualOuterHeightMm?: number | null;
    manualWeightGrams?: number | null;
    correctedAddress?: Record<string, unknown>;
    selectedServiceCode?: string | null;
    selectedPrintStationId?: string | null;
}

export interface ShippingBulkLabelInput {
    wooOrderIds: number[];
    printStationId?: string | null;
    userId?: string;
}

export class ShippingService {
    private static readonly LABEL_STORAGE_BASE_DIR = path.resolve(__dirname, '../../uploads/shipping-labels');
    private categoryInferenceCache = new Map<string, {
        expiresAt: number;
        global: { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null };
        byCategory: Map<string, { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null }>;
    }>();

    async getHubSummary(accountId: string) {
        const [draftCount, labelCount, packageCount, printStationCount] = await Promise.all([
            prisma.shippingShipmentDraft.count({ where: { accountId } }),
            prisma.shippingLabel.count({ where: { accountId } }),
            prisma.shippingPackagePreset.count({ where: { accountId, isActive: true } }),
            prisma.shippingPrintStation.count({ where: { accountId } }),
        ]);

        return {
            dispatchStatus: await this.getDispatchStatus(accountId),
            counts: {
                drafts: draftCount,
                labels: labelCount,
                packages: packageCount,
                printStations: printStationCount,
            },
        };
    }

    async listDispatchOrders(accountId: string, limit = 50) {
        const dispatchStatus = await this.getDispatchStatus(accountId);
        const statuses = this.getStatusCandidates(dispatchStatus);
        const orders = await prisma.wooOrder.findMany({
            where: { accountId, status: { in: statuses } },
            orderBy: { dateCreated: 'asc' },
            take: limit,
        });

        const existingDrafts = await prisma.shippingShipmentDraft.findMany({
            where: {
                accountId,
                wooOrderId: { in: orders.map((order) => order.wooId) },
            },
        });
        const draftByWooOrderId = new Map<number, any>(existingDrafts.map((draft) => [draft.wooOrderId, draft]));

        const rows = [];
        for (const order of orders) {
            let draft = draftByWooOrderId.get(order.wooId);
            if (!draft) {
                draft = await this.ensureDraftForOrder(accountId, order, dispatchStatus);
                draftByWooOrderId.set(order.wooId, draft);
            } else {
                draft = await this.applyResolvedServiceToDraft(accountId, order, draft);
            }
            rows.push({ order: this.toShippingOrderSummary(order), draft });
        }

        return { dispatchStatus, orders: rows };
    }

    async updateDraft(accountId: string, wooOrderId: number, data: ShippingDraftInput, userId?: string) {
        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: wooOrderId } } });
        if (!order) throw new Error('Order not found');
        const draft = await this.ensureDraftForOrder(accountId, order, await this.getDispatchStatus(accountId));
        const packageTouched = data.selectedPackagePresetId !== undefined
            || data.manualOuterLengthMm !== undefined
            || data.manualOuterWidthMm !== undefined
            || data.manualOuterHeightMm !== undefined
            || data.manualWeightGrams !== undefined;
        const packageResolved = Boolean(data.selectedPackagePresetId)
            || Boolean(data.manualOuterLengthMm && data.manualOuterWidthMm && data.manualOuterHeightMm && data.manualWeightGrams);
        const serviceTouched = data.selectedServiceCode !== undefined;
        const existingReadinessErrors = Array.isArray(draft.readinessErrors) ? draft.readinessErrors as any[] : [];
        const serviceError = await this.getServiceReadinessError(accountId, {
            ...draft,
            ...(data.selectedServiceCode !== undefined ? { selectedServiceCode: data.selectedServiceCode } : {}),
        });
        const packageAndServiceErrors = packageTouched
            ? (packageResolved
                ? existingReadinessErrors.filter((error) => error?.field !== 'package')
                : [...existingReadinessErrors.filter((error) => error?.field !== 'package'), { field: 'package', message: 'Package details are incomplete' }])
            : existingReadinessErrors;
        const readinessErrors = [
            ...packageAndServiceErrors.filter((error) => error?.field !== 'service'),
            ...(serviceError ? [serviceError] : []),
        ];
        const updateData: Prisma.ShippingShipmentDraftUncheckedUpdateInput = {
            ...(data.selectedPackagePresetId !== undefined ? { selectedPackagePresetId: data.selectedPackagePresetId } : {}),
            ...(data.manualOuterLengthMm !== undefined ? { manualOuterLengthMm: data.manualOuterLengthMm } : {}),
            ...(data.manualOuterWidthMm !== undefined ? { manualOuterWidthMm: data.manualOuterWidthMm } : {}),
            ...(data.manualOuterHeightMm !== undefined ? { manualOuterHeightMm: data.manualOuterHeightMm } : {}),
            ...(data.manualWeightGrams !== undefined ? { manualWeightGrams: data.manualWeightGrams } : {}),
            ...(data.correctedAddress !== undefined ? { correctedAddress: data.correctedAddress as Prisma.InputJsonValue } : {}),
            ...(data.selectedServiceCode !== undefined ? { selectedServiceCode: data.selectedServiceCode } : {}),
            ...(data.selectedPrintStationId !== undefined ? { selectedPrintStationId: data.selectedPrintStationId } : {}),
            ...(packageTouched ? {
                packageSelectionConfidence: 'manual_override',
                packageSelectionReason: 'Package details manually updated by staff',
                lastRateRequest: {},
                lastRateResponse: {},
            } : {}),
            ...(packageTouched || serviceTouched ? {
                readinessErrors: readinessErrors as Prisma.InputJsonValue,
                readinessStatus: readinessErrors.length === 0 ? 'ready' : 'blocked',
            } : {}),
            updatedByUserId: userId,
        };

        const updated = await prisma.shippingShipmentDraft.update({
            where: { accountId_wooOrderId: { accountId, wooOrderId } },
            data: updateData,
        });

        await this.recordAuditEvent(accountId, 'DRAFT_UPDATED', {
            orderId: order.id,
            draftId: updated.id,
            userId,
            beforeSnapshot: this.snapshotDraft(draft),
            afterSnapshot: this.snapshotDraft(updated),
            metadata: { wooOrderId, changedFields: Object.keys(data) },
        });

        return updated;
    }

    async validateAddress(accountId: string, wooOrderId: number, userId?: string) {
        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: wooOrderId } } });
        if (!order) throw new Error('Order not found');
        const draft = await this.ensureDraftForOrder(accountId, order, await this.getDispatchStatus(accountId));
        const address = this.resolveAddress(draft, order);
        const { errors, status, carrierValidation } = await this.validateResolvedAddress(accountId, address);
        const existingReadinessErrors = Array.isArray(draft.readinessErrors) ? draft.readinessErrors as any[] : [];
        const packageErrors = existingReadinessErrors.filter((error) => error?.field === 'package');
        const serviceError = await this.getServiceReadinessError(accountId, draft);
        const readinessErrors = [...errors, ...packageErrors, ...(serviceError ? [serviceError] : [])];
        const updated = await prisma.shippingShipmentDraft.update({
            where: { accountId_wooOrderId: { accountId, wooOrderId } },
            data: { addressValidationStatus: status, addressValidationErrors: errors, readinessErrors, readinessStatus: readinessErrors.length === 0 ? 'ready' : 'blocked' },
        });
        await this.recordAuditEvent(accountId, 'ADDRESS_VALIDATED', {
            orderId: order.id,
            draftId: updated.id,
            userId,
            beforeSnapshot: this.snapshotDraft(draft),
            afterSnapshot: this.snapshotDraft(updated),
            metadata: { wooOrderId, status, errorCount: errors.length, carrierValidation },
        });
        return updated;
    }

    async requestDraftRates(accountId: string, wooOrderId: number, userId?: string) {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' } });
        if (!settings?.credentialsEncrypted) throw new Error('AusPost credentials are not configured');
        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: wooOrderId } } });
        if (!order) throw new Error('Order not found');
        const draft = await this.ensureDraftForOrder(accountId, order, await this.getDispatchStatus(accountId));
        const address = this.resolveAddress(draft, order);
        const selectedPackage = draft.selectedPackagePresetId
            ? await prisma.shippingPackagePreset.findFirst({ where: { id: draft.selectedPackagePresetId, accountId } })
            : null;
        const requestSnapshot = {
            carrier: 'AUSPOST',
            wooOrderId,
            address,
            packagePresetId: draft.selectedPackagePresetId,
            dimensions: this.resolveDimensions(draft, selectedPackage),
            selectedServiceCode: draft.selectedServiceCode,
        };

        let rateResponse: Record<string, unknown>;
        try {
            rateResponse = await ausPostShippingTrackingAdapter.getRates(accountId, requestSnapshot) as Record<string, unknown>;
        } catch (error: any) {
            rateResponse = { status: 'adapter_mapping_required', message: error?.message || 'AusPost rates endpoint mapping is not configured yet' };
        }

        const updated = await prisma.shippingShipmentDraft.update({
            where: { accountId_wooOrderId: { accountId, wooOrderId } },
            data: {
                lastRateRequest: requestSnapshot as Prisma.InputJsonValue,
                lastRateResponse: rateResponse as Prisma.InputJsonValue,
            },
        });
        await this.recordAuditEvent(accountId, 'RATES_REQUESTED', {
            orderId: order.id,
            draftId: draft.id,
            userId,
            metadata: { wooOrderId, adapterConnected: rateResponse.status !== 'adapter_mapping_required' },
            afterSnapshot: { lastRateRequest: requestSnapshot, lastRateResponse: updated.lastRateResponse as any },
        });
        if (rateResponse.status === 'adapter_mapping_required') throw new Error(String(rateResponse.message));
        return updated;
    }

    async listPackages(accountId: string) {
        return prisma.shippingPackagePreset.findMany({
            where: { accountId },
            orderBy: [{ isDefault: 'desc' }, { selectionPriority: 'asc' }, { name: 'asc' }],
        });
    }

    async createPackage(accountId: string, data: ShippingPackageInput) {
        await this.clearDefaultPackageIfNeeded(accountId, data.isDefault === true);
        return prisma.shippingPackagePreset.create({
            data: {
                accountId,
                name: data.name,
                type: data.type || 'custom_box',
                innerLengthMm: data.innerLengthMm ?? null,
                innerWidthMm: data.innerWidthMm ?? null,
                innerHeightMm: data.innerHeightMm ?? null,
                outerLengthMm: data.outerLengthMm,
                outerWidthMm: data.outerWidthMm,
                outerHeightMm: data.outerHeightMm,
                fallbackItemWeightGrams: data.fallbackItemWeightGrams ?? null,
                forcedPackageWeightGrams: data.forcedPackageWeightGrams ?? null,
                packagingWeightGrams: data.packagingWeightGrams ?? 0,
                maxWeightGrams: data.maxWeightGrams ?? null,
                selectionPriority: data.selectionPriority ?? 0,
                carrierProductCode: data.carrierProductCode ?? null,
                isDefault: data.isDefault ?? false,
                isActive: data.isActive ?? true,
            },
        });
    }

    async updatePackage(accountId: string, id: string, data: Partial<ShippingPackageInput>) {
        await this.getPackageOrThrow(accountId, id);
        await this.clearDefaultPackageIfNeeded(accountId, data.isDefault === true, id);
        return prisma.shippingPackagePreset.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.type !== undefined ? { type: data.type } : {}),
                ...(data.innerLengthMm !== undefined ? { innerLengthMm: data.innerLengthMm } : {}),
                ...(data.innerWidthMm !== undefined ? { innerWidthMm: data.innerWidthMm } : {}),
                ...(data.innerHeightMm !== undefined ? { innerHeightMm: data.innerHeightMm } : {}),
                ...(data.outerLengthMm !== undefined ? { outerLengthMm: data.outerLengthMm } : {}),
                ...(data.outerWidthMm !== undefined ? { outerWidthMm: data.outerWidthMm } : {}),
                ...(data.outerHeightMm !== undefined ? { outerHeightMm: data.outerHeightMm } : {}),
                ...(data.fallbackItemWeightGrams !== undefined ? { fallbackItemWeightGrams: data.fallbackItemWeightGrams } : {}),
                ...(data.forcedPackageWeightGrams !== undefined ? { forcedPackageWeightGrams: data.forcedPackageWeightGrams } : {}),
                ...(data.packagingWeightGrams !== undefined ? { packagingWeightGrams: data.packagingWeightGrams } : {}),
                ...(data.maxWeightGrams !== undefined ? { maxWeightGrams: data.maxWeightGrams } : {}),
                ...(data.selectionPriority !== undefined ? { selectionPriority: data.selectionPriority } : {}),
                ...(data.carrierProductCode !== undefined ? { carrierProductCode: data.carrierProductCode } : {}),
                ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
                ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            },
        });
    }

    async deactivatePackage(accountId: string, id: string) {
        await this.getPackageOrThrow(accountId, id);
        return prisma.shippingPackagePreset.update({
            where: { id },
            data: { isActive: false, isDefault: false },
        });
    }

    async listLabels(accountId: string, limit = 50) {
        return prisma.shippingLabel.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    async requestLabelCancellation(accountId: string, labelId: string, reason?: string | null, userId?: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        if (label.cancelledAt || label.status === 'cancelled') throw new Error('Label is already cancelled');
        if (!label.carrierShipmentId) throw new Error('Carrier shipment ID is missing for this label');
        const nonCancellableStatuses = ['printed', 'fulfilled', 'delivered', 'returned'];
        if (nonCancellableStatuses.includes(label.status)) {
            throw new Error(`Label cannot be cancelled after ${label.status} state`);
        }

        await this.recordAuditEvent(accountId, 'LABEL_CANCEL_REQUESTED', {
            orderId: label.orderId,
            labelId: label.id,
            userId,
            beforeSnapshot: {
                id: label.id,
                status: label.status,
                carrierLabelId: label.carrierLabelId,
                trackingNumber: label.trackingNumber,
                cancelledAt: label.cancelledAt,
            },
            metadata: { wooOrderId: label.wooOrderId, reason: reason || null },
        });

        const cancellation = await ausPostShippingTrackingAdapter.cancelShipment(accountId, label.carrierShipmentId);
        const cancelled = await prisma.shippingLabel.update({
            where: { id: label.id },
            data: {
                status: 'cancelled',
                cancelledAt: new Date(),
                errorMessage: null,
                responseSnapshot: {
                    ...(label.responseSnapshot as Record<string, unknown> || {}),
                    cancellation: {
                        at: new Date().toISOString(),
                        reason: reason || null,
                        result: cancellation,
                    },
                } as any,
            },
        });

        await this.recordAuditEvent(accountId, 'LABEL_CANCELLED', {
            orderId: cancelled.orderId,
            labelId: cancelled.id,
            userId,
            metadata: {
                wooOrderId: cancelled.wooOrderId,
                reason: reason || null,
                carrierShipmentId: cancelled.carrierShipmentId,
            },
            beforeSnapshot: {
                id: label.id,
                status: label.status,
                cancelledAt: label.cancelledAt,
            },
            afterSnapshot: {
                id: cancelled.id,
                status: cancelled.status,
                cancelledAt: cancelled.cancelledAt,
            },
        });

        return cancelled;
    }

    async listCarrierTransactions(accountId: string, limit = 100) {
        return prisma.shippingCarrierTransaction.findMany({
            where: { accountId },
            orderBy: { transactionDate: 'desc' },
            take: limit,
        });
    }

    async getOrderShipments(accountId: string, wooOrderId: number) {
        const labels = await prisma.shippingLabel.findMany({
            where: { accountId, wooOrderId },
            orderBy: { createdAt: 'desc' },
            include: { trackingEvents: { orderBy: { occurredAt: 'desc' } } },
        });
        return { labels };
    }

    async getLabelTracking(accountId: string, labelId: string) {
        const label = await prisma.shippingLabel.findFirst({
            where: { id: labelId, accountId },
            include: { trackingEvents: { orderBy: { occurredAt: 'desc' } } },
        });
        if (!label) throw new Error('Label not found');
        return { label, trackingEvents: label.trackingEvents };
    }

    async listItemOverrides(accountId: string) {
        return prisma.shippingItemOverride.findMany({
            where: { accountId },
            orderBy: [{ wooProductId: 'asc' }, { wooVariationId: 'asc' }],
            include: { packagePreset: { select: { id: true, name: true } } },
        });
    }

    async createItemOverride(accountId: string, data: ShippingItemOverrideInput) {
        return prisma.shippingItemOverride.create({
            data: {
                accountId,
                wooProductId: data.wooProductId,
                wooVariationId: data.wooVariationId ?? null,
                packagePresetId: data.packagePresetId ?? null,
                weightGrams: data.weightGrams ?? null,
                lengthMm: data.lengthMm ?? null,
                widthMm: data.widthMm ?? null,
                heightMm: data.heightMm ?? null,
                packingMode: data.packingMode || 'combine_quantities',
                dangerousGoods: data.dangerousGoods ?? false,
                fragile: data.fragile ?? false,
                customsDescription: data.customsDescription ?? null,
                countryOfOrigin: data.countryOfOrigin ?? null,
                hsCode: data.hsCode ?? null,
                notes: data.notes ?? null,
            },
        });
    }

    async updateItemOverride(accountId: string, id: string, data: Partial<ShippingItemOverrideInput>) {
        await this.getItemOverrideOrThrow(accountId, id);
        return prisma.shippingItemOverride.update({
            where: { id },
            data: {
                ...(data.wooProductId !== undefined ? { wooProductId: data.wooProductId } : {}),
                ...(data.wooVariationId !== undefined ? { wooVariationId: data.wooVariationId } : {}),
                ...(data.packagePresetId !== undefined ? { packagePresetId: data.packagePresetId } : {}),
                ...(data.weightGrams !== undefined ? { weightGrams: data.weightGrams } : {}),
                ...(data.lengthMm !== undefined ? { lengthMm: data.lengthMm } : {}),
                ...(data.widthMm !== undefined ? { widthMm: data.widthMm } : {}),
                ...(data.heightMm !== undefined ? { heightMm: data.heightMm } : {}),
                ...(data.packingMode !== undefined ? { packingMode: data.packingMode } : {}),
                ...(data.dangerousGoods !== undefined ? { dangerousGoods: data.dangerousGoods } : {}),
                ...(data.fragile !== undefined ? { fragile: data.fragile } : {}),
                ...(data.customsDescription !== undefined ? { customsDescription: data.customsDescription } : {}),
                ...(data.countryOfOrigin !== undefined ? { countryOfOrigin: data.countryOfOrigin } : {}),
                ...(data.hsCode !== undefined ? { hsCode: data.hsCode } : {}),
                ...(data.notes !== undefined ? { notes: data.notes } : {}),
            },
        });
    }

    async deleteItemOverride(accountId: string, id: string) {
        await this.getItemOverrideOrThrow(accountId, id);
        await prisma.shippingItemOverride.delete({ where: { id } });
        return { id };
    }

    async listPrintStations(accountId: string) {
        return prisma.shippingPrintStation.findMany({
            where: { accountId },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                status: true,
                agentVersion: true,
                minimumSupportedVersion: true,
                lastSeenAt: true,
                lastErrorCode: true,
                lastErrorMessage: true,
                defaultPrinterName: true,
                capabilities: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async listPrintJobs(accountId: string, limit = 100) {
        return prisma.shippingPrintJob.findMany({
            where: { accountId },
            orderBy: { requestedAt: 'desc' },
            take: limit,
            include: {
                label: { select: { id: true, wooOrderId: true, trackingNumber: true, serviceName: true, labelStoredUntil: true } },
                printStation: { select: { id: true, name: true, status: true, defaultPrinterName: true } },
                reassignedFromStation: { select: { id: true, name: true } },
            },
        });
    }

    async listAuditEvents(accountId: string, limit = 100) {
        return prisma.shippingAuditEvent.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { label: { select: { id: true, wooOrderId: true, trackingNumber: true } } },
        });
    }

    async retryPrintJob(accountId: string, jobId: string, userId?: string) {
        const job = await prisma.shippingPrintJob.findFirst({ where: { id: jobId, accountId }, include: { label: true } });
        if (!job) throw new Error('Print job not found');
        if (!['failed', 'station_offline'].includes(job.status)) throw new Error('Only failed or offline print jobs can be retried');
        await prisma.shippingPrintJob.update({
            where: { id: job.id },
            data: { status: 'queued', errorMessage: null, pickedUpAt: null, printedAt: null },
        });
        const updated = await this.getPrintJobForOperations(accountId, job.id);
        if (!updated) throw new Error('Print job not found');
        await this.recordAuditEvent(accountId, 'PRINT_JOB_RETRIED', {
            orderId: job.label.orderId,
            labelId: job.labelId,
            userId,
            beforeSnapshot: { id: job.id, status: job.status, errorMessage: job.errorMessage, attempts: job.attempts },
            afterSnapshot: { id: updated.id, status: updated.status, attempts: updated.attempts },
            metadata: { printJobId: job.id, printStationId: job.printStationId, wooOrderId: job.label.wooOrderId },
        });
        return updated;
    }

    async reassignPrintJob(accountId: string, jobId: string, printStationId: string, userId?: string) {
        const [job, station] = await Promise.all([
            prisma.shippingPrintJob.findFirst({ where: { id: jobId, accountId }, include: { label: true, printStation: true } }),
            prisma.shippingPrintStation.findFirst({ where: { id: printStationId, accountId } }),
        ]);
        if (!job) throw new Error('Print job not found');
        if (!station) throw new Error('Print station not found');
        if (job.status === 'printed') throw new Error('Printed jobs cannot be reassigned');
        if (!['queued', 'failed', 'station_offline'].includes(job.status)) throw new Error('Only queued, failed, or offline print jobs can be reassigned');
        await prisma.shippingPrintJob.update({
            where: { id: job.id },
            data: {
                printStationId: station.id,
                reassignedFromStationId: job.printStationId,
                status: 'queued',
                errorMessage: null,
                pickedUpAt: null,
                printedAt: null,
            },
        });
        const updated = await this.getPrintJobForOperations(accountId, job.id);
        if (!updated) throw new Error('Print job not found');
        await this.recordAuditEvent(accountId, 'PRINT_JOB_REASSIGNED', {
            orderId: job.label.orderId,
            labelId: job.labelId,
            userId,
            beforeSnapshot: { id: job.id, status: job.status, printStationId: job.printStationId, printStationName: job.printStation.name },
            afterSnapshot: { id: updated.id, status: updated.status, printStationId: updated.printStationId, printStationName: station.name },
            metadata: { printJobId: job.id, fromPrintStationId: job.printStationId, toPrintStationId: station.id, wooOrderId: job.label.wooOrderId },
        });
        return updated;
    }

    async createPrintStation(accountId: string, name: string, defaultPrinterName?: string | null) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashStationToken(token);
        const station = await prisma.shippingPrintStation.create({
            data: {
                accountId,
                name,
                stationTokenHash: tokenHash,
                tokenRotatedAt: new Date(),
                defaultPrinterName: defaultPrinterName || null,
                status: 'offline',
            },
            select: {
                id: true,
                name: true,
                status: true,
                defaultPrinterName: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return { printStation: station, token };
    }

    async rotatePrintStationToken(accountId: string, id: string) {
        const existing = await prisma.shippingPrintStation.findFirst({ where: { id, accountId } });
        if (!existing) throw new Error('Print station not found');
        const token = crypto.randomBytes(32).toString('hex');
        const printStation = await prisma.shippingPrintStation.update({
            where: { id },
            data: { stationTokenHash: this.hashStationToken(token), tokenRotatedAt: new Date() },
            select: { id: true, name: true, status: true, defaultPrinterName: true, tokenRotatedAt: true },
        });
        return { printStation, token };
    }

    async authenticatePrintStation(stationId: string, token: string) {
        const station = await prisma.shippingPrintStation.findUnique({ where: { id: stationId } });
        if (!station || station.stationTokenHash !== this.hashStationToken(token)) return null;
        return prisma.shippingPrintStation.update({
            where: { id: station.id },
            data: { status: 'online', lastSeenAt: new Date(), agentVersion: station.agentVersion },
        });
    }

    async listPendingPrintJobsForStation(stationId: string, token: string, agentVersion?: string) {
        const station = await this.authenticatePrintStation(stationId, token);
        if (!station) throw new Error('Invalid print station credentials');
        if (agentVersion && station.minimumSupportedVersion && this.compareVersions(agentVersion, station.minimumSupportedVersion) < 0) {
            await prisma.shippingPrintStation.update({
                where: { id: station.id },
                data: {
                    agentVersion,
                    lastSeenAt: new Date(),
                    status: 'unsupported_version',
                    lastErrorCode: 'UNSUPPORTED_AGENT_VERSION',
                    lastErrorMessage: `Print agent ${agentVersion} is below required ${station.minimumSupportedVersion}`,
                },
            });
            throw new Error(`Print agent version ${agentVersion} is not supported; minimum version is ${station.minimumSupportedVersion}`);
        }
        if (agentVersion) {
            await prisma.shippingPrintStation.update({ where: { id: station.id }, data: { agentVersion, lastSeenAt: new Date(), status: 'online', lastErrorCode: null, lastErrorMessage: null } });
        }

        const jobs = await prisma.shippingPrintJob.findMany({
            where: { accountId: station.accountId, printStationId: station.id, status: { in: ['queued', 'station_offline'] } },
            orderBy: { requestedAt: 'asc' },
            take: 10,
            include: { label: true },
        });

        const claimedJobs = [];
        for (const job of jobs) {
            const claimed = await prisma.shippingPrintJob.updateMany({
                where: { id: job.id, status: { in: ['queued', 'station_offline'] } },
                data: { status: 'picked_up', pickedUpAt: new Date(), attempts: { increment: 1 } },
            });
            if (claimed.count > 0) claimedJobs.push(job);
        }

        const dispatchableJobs = [];
        for (const job of claimedJobs as any[]) {
            const labelPath = String(job.label?.labelFilePath || '');
            if (!this.isSafeLabelFilePath(labelPath) || !fs.existsSync(labelPath)) {
                await prisma.shippingPrintJob.update({
                    where: { id: job.id },
                    data: { status: 'failed', errorMessage: 'Stored label PDF path is invalid or missing' },
                });
                await this.recordAuditEvent(station.accountId, 'PRINT_JOB_BLOCKED_UNSAFE_LABEL_PATH', {
                    labelId: job.labelId,
                    metadata: { printJobId: job.id, labelPath },
                });
                continue;
            }
            dispatchableJobs.push(job);
        }

        return {
            printStation: { id: station.id, name: station.name },
            jobs: dispatchableJobs.map((job: any) => ({
                id: job.id,
                printerName: job.printerName || station.defaultPrinterName,
                labelFormat: job.label.labelFormat,
                labelFilePath: job.label.labelFilePath,
                labelDownloadPath: `/api/shipping/print-agent/jobs/${job.id}/label`,
                trackingNumber: job.label.trackingNumber,
                wooOrderId: job.label.wooOrderId,
            })),
        };
    }

    async getPrintJobLabelPdfForStation(stationId: string, token: string, jobId: string) {
        const station = await this.authenticatePrintStation(stationId, token);
        if (!station) throw new Error('Invalid print station credentials');
        const job = await prisma.shippingPrintJob.findFirst({
            where: { id: jobId, accountId: station.accountId, printStationId: station.id },
            include: { label: true },
        });
        if (!job) throw new Error('Print job not found');
        if (!['picked_up', 'queued', 'station_offline', 'failed'].includes(job.status)) throw new Error('Print job is not in a downloadable state');
        const labelPath = String(job.label?.labelFilePath || '');
        if (!this.isSafeLabelFilePath(labelPath) || !fs.existsSync(labelPath)) throw new Error('Stored label PDF path is invalid or unavailable');

        await this.recordAuditEvent(station.accountId, 'LABEL_PDF_DOWNLOADED_BY_PRINT_AGENT', {
            labelId: job.labelId,
            metadata: { printJobId: job.id, stationId: station.id, wooOrderId: job.label.wooOrderId },
        });

        return {
            fileName: `${job.label.wooOrderId}-${job.label.carrierLabelId || job.labelId}.pdf`,
            contentType: 'application/pdf',
            pdf: await fs.promises.readFile(labelPath),
        };
    }

    async reportPrintJobResult(stationId: string, token: string, jobId: string, status: 'printed' | 'failed', errorMessage?: string) {
        const station = await this.authenticatePrintStation(stationId, token);
        if (!station) throw new Error('Invalid print station credentials');
        const job = await prisma.shippingPrintJob.findFirst({ where: { id: jobId, accountId: station.accountId, printStationId: station.id } });
        if (!job) throw new Error('Print job not found');
        if (job.status === 'printed') return job;
        if (!['picked_up', 'queued', 'station_offline', 'failed'].includes(job.status)) {
            throw new Error('Print job is not in a reportable state');
        }

        const printed = status === 'printed';
        const updated = await prisma.shippingPrintJob.update({
            where: { id: job.id },
            data: {
                status: printed ? 'printed' : 'failed',
                printedAt: printed ? new Date() : job.printedAt,
                errorMessage: printed ? null : errorMessage || 'Print failed',
            },
        });

        if (printed) {
            const label = await prisma.shippingLabel.update({ where: { id: job.labelId }, data: { status: 'printed', printedAt: new Date() } });
            const fulfillmentBehavior = await this.getWooFulfillmentBehavior(station.accountId);
            if (fulfillmentBehavior === 'print_success') {
                await this.attemptFulfillmentSyncWithBackoff(station.accountId, label, { printJobId: job.id, trigger: 'print_success' });
            }
        } else {
            await prisma.shippingLabel.update({ where: { id: job.labelId }, data: { status: 'print_failed', errorMessage: errorMessage || 'Print failed' } });
        }

        return updated;
    }

    async testAusPostSettings(accountId: string) {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' } });
        let result: { ok: boolean; status: string; message: string } = { ok: false, status: 'missing_credentials', message: 'AusPost API key and secret are required before testing the connection.' };
        if (settings?.credentialsEncrypted) {
            result = await ausPostShippingTrackingAdapter.testConnection(accountId);
        }
        if (settings) {
            await prisma.shippingCarrierAccount.update({
                where: { id: settings.id },
                data: { lastTestedAt: new Date(), lastTestStatus: result.status },
            });
        }
        return result;
    }

    async createAndQueueLabelPlaceholder(accountId: string, wooOrderId: number, userId?: string, printStationId?: string | null) {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' } });
        if (!settings?.credentialsEncrypted) throw new Error('AusPost credentials are not configured');
        const order = await prisma.wooOrder.findUnique({ where: { accountId_wooId: { accountId, wooId: wooOrderId } } });
        if (!order) throw new Error('Order not found');
        const draft = await this.ensureDraftForOrder(accountId, order, await this.getDispatchStatus(accountId));
        try {
            const lockResult = await prisma.shippingShipmentDraft.updateMany({
                where: {
                    accountId,
                    wooOrderId,
                    status: { not: 'creating_label' },
                },
                data: {
                    status: 'creating_label',
                    updatedByUserId: userId,
                },
            });
            if (lockResult.count === 0) {
                await this.recordAuditEvent(accountId, 'LABEL_CREATE_BLOCKED_DUPLICATE_ATTEMPT', {
                    orderId: order.id,
                    draftId: draft.id,
                    userId,
                    metadata: { wooOrderId, reason: 'Draft is already in create-label flow' },
                });
                throw new Error('A label create request is already in progress for this order');
            }
        const existingLabel = await prisma.shippingLabel.findFirst({
            where: {
                accountId,
                wooOrderId,
                cancelledAt: null,
                status: { not: 'cancelled' },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (existingLabel) {
            throw new Error(`Shipment label already exists for this order (status: ${existingLabel.status}). Cancel or resolve the existing label before creating another.`);
        }
        if (draft.readinessStatus !== 'ready') throw new Error('Shipment draft is not ready');
        await this.recordAuditEvent(accountId, 'LABEL_CREATE_REQUESTED', {
            orderId: order.id,
            draftId: draft.id,
            userId,
            metadata: { wooOrderId, printStationId: printStationId || draft.selectedPrintStationId || null },
        });
        const address = this.resolveAddress(draft, order);
        const selectedPackage = draft.selectedPackagePresetId
            ? await prisma.shippingPackagePreset.findFirst({ where: { id: draft.selectedPackagePresetId, accountId } })
            : null;
        const dimensions = this.resolveDimensions(draft, selectedPackage);
        const requestSnapshot = {
            wooOrderId,
            order: order.rawData as Record<string, unknown>,
            senderAddress: (settings.senderAddress as Record<string, unknown>) || {},
            address,
            dimensions,
            serviceCode: draft.selectedServiceCode,
        };
        const config = (settings.config as Record<string, unknown> | null) || {};
        const labelPrintGroup = this.resolveLabelPrintGroupForOrder(order.rawData as Record<string, any>, config);
        const labelLayout = this.getConfiguredLabelLayout(config);
        const printDeliveryMethod = this.getPrintDeliveryMethod(config);
        if (!labelPrintGroup || !['Parcel Post', 'Express Post'].includes(labelPrintGroup)) throw new Error('AusPost label print group must be configured in Shipping Settings');
        if (!labelLayout) throw new Error('AusPost label layout must be configured in Shipping Settings');
        const stationId = printDeliveryMethod === 'remote_print'
            ? printStationId || draft.selectedPrintStationId || this.stringSetting(config.defaultPrintStationId) || (await prisma.shippingPrintStation.findFirst({ where: { accountId, status: 'online' }, orderBy: { createdAt: 'asc' } }))?.id
            : null;
        if (printDeliveryMethod === 'remote_print' && !stationId) throw new Error('Print station not configured');

        await ausPostShippingTrackingAdapter.validateShipment(accountId, requestSnapshot);
        const shipmentResult = await ausPostShippingTrackingAdapter.createShipment(accountId, requestSnapshot);
        if (!shipmentResult.shipment.carrierShipmentId) throw new Error('AusPost did not return a shipment ID');
        const labelRequestResult = await ausPostShippingTrackingAdapter.createLabelRequest(accountId, {
            shipmentId: shipmentResult.shipment.carrierShipmentId,
            printGroup: labelPrintGroup,
            layout: labelLayout,
            branded: config.labelBranded !== false,
            waitForLabelUrl: true,
        });
        const requestId = labelRequestResult.labelRequest.requestId;
        if (!requestId) throw new Error('AusPost did not return a label request ID');
        const resolvedLabelRequest = await this.resolveLabelRequestWithRetry(accountId, labelRequestResult.labelRequest, requestId);
        const baseLabelData = this.buildLabelData(accountId, order, wooOrderId, settings, shipmentResult, requestId, draft, requestSnapshot, labelRequestResult, resolvedLabelRequest, userId);
        if (!resolvedLabelRequest.url) {
            const pendingLabel = await prisma.shippingLabel.create({
                data: {
                    ...baseLabelData,
                    status: 'label_pending_pdf',
                    errorMessage: resolvedLabelRequest.message || 'AusPost label request is pending and PDF URL is not available yet',
                },
            });
            await this.recordAuditEvent(accountId, 'LABEL_CREATED_PENDING_PDF', {
                orderId: order.id,
                draftId: draft.id,
                labelId: pendingLabel.id,
                userId,
                metadata: {
                    wooOrderId,
                    carrierShipmentId: pendingLabel.carrierShipmentId,
                    carrierLabelId: pendingLabel.carrierLabelId,
                    labelStatus: resolvedLabelRequest.status || null,
                },
                afterSnapshot: { label: pendingLabel, resolvedLabelRequest },
            });
            return pendingLabel;
        }
        const pdf = await this.downloadLabelPdfWithRetry(resolvedLabelRequest.url);
        const labelFilePath = this.storeLabelPdf(accountId, wooOrderId, requestId, pdf);
        const storedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const label = await prisma.shippingLabel.create({
            data: {
                ...baseLabelData,
                status: 'label_ready',
                labelFilePath,
                labelStoredUntil: storedUntil,
            },
        });
        const printJob = stationId
            ? await prisma.shippingPrintJob.create({
                data: { accountId, labelId: label.id, printStationId: stationId, status: 'queued', requestedByUserId: userId },
            })
            : null;
        await this.recordAuditEvent(accountId, printJob ? 'LABEL_CREATED_AND_PRINT_QUEUED' : 'LABEL_CREATED_FOR_SCREEN_PDF', {
            orderId: order.id,
            draftId: draft.id,
            labelId: label.id,
            userId,
            metadata: { wooOrderId, printDeliveryMethod, printStationId: stationId, printJobId: printJob?.id || null, carrierShipmentId: label.carrierShipmentId, carrierLabelId: label.carrierLabelId },
            afterSnapshot: { label, printJob },
        });
        const fulfillmentBehavior = await this.getWooFulfillmentBehavior(accountId);
        if (fulfillmentBehavior === 'label_created') {
            await this.attemptFulfillmentSyncWithBackoff(accountId, label, { printJobId: printJob?.id || null, trigger: 'label_created' });
        }
        return { ...label, printJob };
        } finally {
            await prisma.shippingShipmentDraft.updateMany({
                where: { accountId, wooOrderId, status: 'creating_label' },
                data: { status: 'draft' },
            });
        }
    }

    async bulkCreateAndQueueLabels(accountId: string, input: ShippingBulkLabelInput) {
        const uniqueOrderIds = Array.from(new Set(input.wooOrderIds));
        const results = [];

        for (const wooOrderId of uniqueOrderIds) {
            try {
                const label = await this.createAndQueueLabelPlaceholder(accountId, wooOrderId, input.userId, input.printStationId);
                results.push({ wooOrderId, ok: true, label });
            } catch (error: any) {
                results.push({ wooOrderId, ok: false, error: error?.message || 'Failed to create label' });
            }
        }

        return {
            requested: uniqueOrderIds.length,
            succeeded: results.filter((result) => result.ok).length,
            failed: results.filter((result) => !result.ok).length,
            results,
        };
    }

    async queueStoredLabelReprint(accountId: string, labelId: string, printStationId?: string | null, userId?: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        this.validateLabelFilePath(label);
        const stationId = printStationId || (await prisma.shippingPrintStation.findFirst({ where: { accountId, status: 'online' }, orderBy: { createdAt: 'asc' } }))?.id;
        if (!stationId) throw new Error('Print station not configured');
        const printJob = await prisma.shippingPrintJob.create({
            data: {
                accountId,
                labelId: label.id,
                printStationId: stationId,
                printerName: null,
                status: 'queued',
            },
        });
        await this.recordAuditEvent(accountId, 'LABEL_REPRINT_QUEUED', {
            orderId: label.orderId,
            labelId: label.id,
            userId,
            metadata: { printJobId: printJob.id, printStationId: stationId, wooOrderId: label.wooOrderId },
        });
        return printJob;
    }

    async getStoredLabelPdf(accountId: string, labelId: string, userId?: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        this.validateLabelFilePath(label);

        await this.recordAuditEvent(accountId, 'LABEL_PDF_OPENED_ON_SCREEN', {
            orderId: label.orderId,
            labelId: label.id,
            userId,
            metadata: { wooOrderId: label.wooOrderId },
        });

        return {
            fileName: `${label.wooOrderId}-${label.carrierLabelId || label.id}.pdf`,
            contentType: 'application/pdf',
            pdf: await fs.promises.readFile(label.labelFilePath),
        };
    }

    async cleanupExpiredStoredLabels(retentionBufferHours = 24) {
        const cutoff = new Date(Date.now() - retentionBufferHours * 60 * 60 * 1000);
        const expired = await prisma.shippingLabel.findMany({
            where: {
                labelFilePath: { not: null },
                labelStoredUntil: { not: null, lt: cutoff },
            },
            select: { id: true, accountId: true, labelFilePath: true, labelStoredUntil: true },
            take: 500,
        });

        let filesDeleted = 0;
        let recordsUpdated = 0;
        let skippedUnsafe = 0;

        for (const label of expired) {
            const labelPath = label.labelFilePath || '';
            if (!this.isSafeLabelFilePath(labelPath)) {
                skippedUnsafe++;
                await this.recordAuditEvent(label.accountId, 'LABEL_STORAGE_CLEANUP_SKIPPED_UNSAFE_PATH', {
                    labelId: label.id,
                    metadata: { labelPath },
                });
                continue;
            }

            try {
                if (fs.existsSync(labelPath)) {
                    fs.unlinkSync(labelPath);
                    filesDeleted++;
                }
            } catch {
                // Keep record update attempt below; next cleanup run retries file deletion.
            }

            await prisma.shippingLabel.update({
                where: { id: label.id },
                data: { labelFilePath: null },
            });
            recordsUpdated++;

            await this.recordAuditEvent(label.accountId, 'LABEL_STORAGE_CLEANED_UP', {
                labelId: label.id,
                metadata: { labelPath, labelStoredUntil: label.labelStoredUntil?.toISOString() || null },
            });
        }

        return { checked: expired.length, filesDeleted, recordsUpdated, skippedUnsafe };
    }

    async recoverPendingLabelPdf(accountId: string, labelId: string, printStationId?: string | null, userId?: string, queuePrint = true) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        if (!label.carrierLabelId) throw new Error('Carrier label request ID is missing');
        if (label.cancelledAt || label.status === 'cancelled') throw new Error('Cancelled labels cannot be recovered');

        const labelRequestResult = await ausPostShippingTrackingAdapter.getLabelRequest(accountId, label.carrierLabelId);
        const resolvedLabelRequest = await this.resolveLabelRequestWithRetry(accountId, labelRequestResult.labelRequest, label.carrierLabelId);
        if (!resolvedLabelRequest.url) {
            await prisma.shippingLabel.update({
                where: { id: label.id },
                data: {
                    status: 'label_pending_pdf',
                    errorMessage: resolvedLabelRequest.message || 'AusPost label request is still pending',
                    responseSnapshot: {
                        ...(label.responseSnapshot as Record<string, unknown> || {}),
                        recoveryAttempt: {
                            at: new Date().toISOString(),
                            resolvedLabelRequest,
                        },
                    } as any,
                },
            });
            throw new Error('AusPost label PDF is still pending');
        }

        const pdf = await this.downloadLabelPdfWithRetry(resolvedLabelRequest.url);
        const filePath = this.storeLabelPdf(accountId, label.wooOrderId, label.carrierLabelId, pdf);
        const storedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const updated = await prisma.shippingLabel.update({
            where: { id: label.id },
            data: {
                status: 'label_ready',
                labelFilePath: filePath,
                labelStoredUntil: storedUntil,
                errorMessage: null,
                responseSnapshot: {
                    ...(label.responseSnapshot as Record<string, unknown> || {}),
                    recoveryAttempt: {
                        at: new Date().toISOString(),
                        resolvedLabelRequest,
                    },
                } as any,
            },
        });

        let printJob: any = null;
        if (queuePrint) {
            const stationId = printStationId || (await prisma.shippingPrintStation.findFirst({ where: { accountId, status: 'online' }, orderBy: { createdAt: 'asc' } }))?.id;
            if (!stationId) throw new Error('Print station not configured');
            printJob = await prisma.shippingPrintJob.create({
                data: { accountId, labelId: updated.id, printStationId: stationId, status: 'queued', requestedByUserId: userId },
            });
        }

        await this.recordAuditEvent(accountId, 'LABEL_PDF_RECOVERED', {
            orderId: updated.orderId,
            labelId: updated.id,
            userId,
            metadata: {
                wooOrderId: updated.wooOrderId,
                queuePrint,
                printJobId: printJob?.id || null,
            },
            afterSnapshot: { label: updated, printJob, resolvedLabelRequest },
        });

        const fulfillmentBehavior = await this.getWooFulfillmentBehavior(accountId);
        if (fulfillmentBehavior === 'label_created') {
            await this.attemptFulfillmentSyncWithBackoff(accountId, updated, {
                printJobId: printJob?.id || null,
                trigger: 'label_pdf_recovered',
            });
        }

        return { ...updated, printJob };
    }

    async retryLabelFulfillmentSync(accountId: string, labelId: string, userId?: string) {
        const label = await prisma.shippingLabel.findFirst({ where: { id: labelId, accountId } });
        if (!label) throw new Error('Label not found');
        if (!['printed', 'fulfilled'].includes(label.status)) {
            throw new Error('Only printed or fulfilled labels can retry WooCommerce sync');
        }
        const fulfillment = await this.attemptFulfillmentSyncWithBackoff(accountId, label, { triggeredBy: 'manual_retry', userId: userId || null });
        const refreshed = await prisma.shippingLabel.findUnique({ where: { id: label.id } });
        return { label: refreshed, fulfillment };
    }

    async getSafeSettings(accountId: string) {
        const carrierAccount = await prisma.shippingCarrierAccount.findFirst({
            where: { accountId, carrier: 'AUSPOST' },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                carrier: true,
                displayName: true,
                isEnabled: true,
                credentialsEncrypted: true,
                config: true,
                senderAddress: true,
                lastTestedAt: true,
                lastTestStatus: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const { credentialsEncrypted, ...safeCarrierAccount } = carrierAccount || {} as any;
        return {
            carrierAccount: carrierAccount ? safeCarrierAccount : null,
            credentialsConfigured: Boolean(credentialsEncrypted),
        };
    }

    async listShippingMethodCandidates(accountId: string, limit = 500) {
        const orders = await prisma.wooOrder.findMany({
            where: { accountId },
            orderBy: { dateCreated: 'desc' },
            take: Math.min(Math.max(limit, 50), 2000),
            select: { rawData: true },
        });

        const unique = new Set<string>();
        for (const order of orders) {
            const raw = (order.rawData as Record<string, any> | null) || {};
            const shippingMethod = this.getWooShippingMethodText(raw).trim();
            if (shippingMethod) unique.add(shippingMethod);
        }

        return {
            shippingMethods: Array.from(unique).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
            sampledOrders: orders.length,
        };
    }

    async listAusPostServiceCatalog(accountId: string, options: { forceRefresh?: boolean } = {}) {
        return await ausPostShippingTrackingAdapter.listAvailableServiceCatalog(accountId, options);
    }

    async saveSettings(accountId: string, data: ShippingSettingsInput) {
        const existing = await prisma.shippingCarrierAccount.findFirst({
            where: { accountId, carrier: 'AUSPOST' },
            orderBy: { createdAt: 'asc' },
        });

        const nextConfig = {
            ...((existing?.config as Record<string, unknown> | null) || {}),
            apiProduct: data.apiProduct || 'SHIPPING_AND_TRACKING',
            apiEnvironment: data.apiEnvironment || 'production',
            apiBaseUrl: data.apiBaseUrl,
            testEndpointPath: data.testEndpointPath,
            ratesEndpointPath: data.ratesEndpointPath,
            labelsEndpointPath: data.labelsEndpointPath,
            labelPdfEndpointPath: data.labelPdfEndpointPath,
            trackingEndpointPath: data.trackingEndpointPath,
            cancellationEndpointPath: data.cancellationEndpointPath,
            accountNumber: data.accountNumber,
            paymentMethod: this.normalizePaymentMethod(data.paymentMethod),
            dispatchStatus: data.dispatchStatus || 'In Dispatch',
            defaultDomesticService: data.defaultDomesticService,
            defaultExpressService: data.defaultExpressService,
            defaultInternationalService: data.defaultInternationalService,
            shippingMethodServiceMappings: Array.isArray(data.shippingMethodServiceMappings)
                ? data.shippingMethodServiceMappings
                    .map((mapping) => ({
                        wooShippingMethod: this.stringSetting(mapping.wooShippingMethod) || '',
                        auspostServiceCode: this.stringSetting(mapping.auspostServiceCode) || '',
                        matchType: mapping.matchType === 'contains' ? 'contains' : 'exact',
                    }))
                    .filter((mapping) => mapping.wooShippingMethod && mapping.auspostServiceCode)
                : undefined,
            defaultPackagePresetId: data.defaultPackagePresetId,
            labelFormat: data.labelFormat || 'PDF',
            defaultPrintStationId: data.defaultPrintStationId,
            wooFulfillmentBehavior: data.wooFulfillmentBehavior,
            trackingSyncEnabled: data.trackingSyncEnabled ?? true,
            trackingAutomationAllowlist: Array.isArray(data.trackingAutomationAllowlist)
                ? data.trackingAutomationAllowlist.filter(Boolean)
                : undefined,
            trackingPollIntervalMinutes: data.trackingPollIntervalMinutes,
            trackingPollFailureBackoffMinutes: data.trackingPollFailureBackoffMinutes,
            labelPrintGroup: data.labelPrintGroup,
            labelPaperType: data.labelPaperType,
            labelLayout: data.labelLayout || this.labelLayoutForPaperType(data.labelPaperType),
            printDeliveryMethod: data.printDeliveryMethod || 'remote_print',
            labelBranded: data.labelBranded ?? true,
        };

        const credentialPayload = data.apiKey || data.apiSecret
            ? (() => {
                let existingCredentials: { apiKey?: string; apiSecret?: string } = {};
                if (existing?.credentialsEncrypted) {
                    try {
                        existingCredentials = JSON.parse(decrypt(existing.credentialsEncrypted));
                    } catch {
                        existingCredentials = {};
                    }
                }
                return encrypt(JSON.stringify({
                    apiKey: data.apiKey ?? existingCredentials.apiKey ?? undefined,
                    apiSecret: data.apiSecret ?? existingCredentials.apiSecret ?? undefined,
                }));
            })()
            : existing?.credentialsEncrypted;

        const saved = existing
            ? await prisma.shippingCarrierAccount.update({
                where: { id: existing.id },
                data: {
                    displayName: data.displayName || existing.displayName,
                    isEnabled: data.isEnabled ?? existing.isEnabled,
                    credentialsEncrypted: credentialPayload,
                    config: nextConfig as Prisma.InputJsonValue,
                    senderAddress: (data.senderAddress || existing.senderAddress || {}) as Prisma.InputJsonValue,
                },
            })
            : await prisma.shippingCarrierAccount.create({
                data: {
                    accountId,
                    carrier: 'AUSPOST',
                    displayName: data.displayName || 'Australia Post',
                    isEnabled: data.isEnabled ?? true,
                    credentialsEncrypted: credentialPayload,
                    config: nextConfig as Prisma.InputJsonValue,
                    senderAddress: (data.senderAddress || {}) as Prisma.InputJsonValue,
                },
            });

        return {
            carrierAccount: {
                id: saved.id,
                carrier: saved.carrier,
                displayName: saved.displayName,
                isEnabled: saved.isEnabled,
                config: saved.config,
                senderAddress: saved.senderAddress,
                lastTestedAt: saved.lastTestedAt,
                lastTestStatus: saved.lastTestStatus,
                createdAt: saved.createdAt,
                updatedAt: saved.updatedAt,
            },
            credentialsConfigured: Boolean(saved.credentialsEncrypted),
        };
    }

    private async getPackageOrThrow(accountId: string, id: string) {
        const existing = await prisma.shippingPackagePreset.findFirst({ where: { id, accountId } });
        if (!existing) throw new Error('Package not found');
        return existing;
    }

    private normalizePaymentMethod(value: unknown): '' | 'CHARGE_ACCOUNT' | 'CREDIT_CARD' | 'PAYPAL' | undefined {
        if (value === '') return '';
        if (value === 'CHARGE_ACCOUNT' || value === 'CREDIT_CARD' || value === 'PAYPAL') return value;
        return undefined;
    }

    private async getItemOverrideOrThrow(accountId: string, id: string) {
        const existing = await prisma.shippingItemOverride.findFirst({ where: { id, accountId } });
        if (!existing) throw new Error('Item override not found');
        return existing;
    }

    private async clearDefaultPackageIfNeeded(accountId: string, shouldClear: boolean, exceptId?: string) {
        if (!shouldClear) return;
        await prisma.shippingPackagePreset.updateMany({
            where: { accountId, ...(exceptId ? { id: { not: exceptId } } : {}) },
            data: { isDefault: false },
        });
    }

    private async getDispatchStatus(accountId: string): Promise<string> {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, orderBy: { createdAt: 'asc' } });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        return String(config.dispatchStatus || 'In Dispatch');
    }

    private getStatusCandidates(status: string): string[] {
        const trimmed = status.trim();
        const slug = trimmed.toLowerCase().replace(/^wc-/, '').replace(/\s+/g, '-');
        return Array.from(new Set([trimmed, trimmed.toLowerCase(), slug, `wc-${slug}`]));
    }

    private async validateResolvedAddress(accountId: string, address: Record<string, unknown>) {
        let errors: any[] = this.validateAddressShape(address);
        let carrierValidation: Record<string, unknown> | null = null;
        let status = errors.length === 0 ? 'valid' : 'invalid';
        if (errors.length === 0 && String(address.country || '').toUpperCase() === 'AU') {
            const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' } });
            if (settings?.credentialsEncrypted) {
                try {
                    const validation = await ausPostShippingTrackingAdapter.validateAddress(accountId, address);
                    carrierValidation = validation;
                    if (!validation.found) {
                        status = 'invalid';
                        errors = [{ field: 'address', message: 'AusPost could not validate the suburb, state, and postcode combination', suggestions: validation.results }];
                    }
                } catch (error: any) {
                    status = 'unverified';
                    errors = [{ field: 'address', message: `AusPost address validation could not be completed: ${error?.message || 'Unknown carrier error'}` }];
                    carrierValidation = { error: error?.message || 'Unknown carrier error' };
                }
            }
        }
        return { errors, status, carrierValidation };
    }

    private async ensureDraftForOrder(accountId: string, order: any, dispatchStatus: string) {
        const existing = await prisma.shippingShipmentDraft.findUnique({ where: { accountId_wooOrderId: { accountId, wooOrderId: order.wooId } } });
        if (existing) return existing;
        const raw = order.rawData as Record<string, any>;
        const addressValidation = await this.validateResolvedAddress(accountId, this.getShippingAddress(raw));
        const addressErrors = addressValidation.errors;
        const packageSelection = await this.selectPackageForOrder(accountId, raw);
        const selectedServiceCode = await this.resolveServiceCodeForOrder(accountId, raw);
        const readinessErrors = [...addressErrors];
        if (packageSelection.confidence === 'manual_required' || packageSelection.confidence === 'missing_dimensions' || packageSelection.confidence === 'overweight') {
            readinessErrors.push({ field: 'package', message: packageSelection.reason });
        }
        const serviceError = await this.getServiceReadinessError(accountId, { selectedServiceCode });
        if (serviceError) readinessErrors.push(serviceError);
        try {
            return await prisma.shippingShipmentDraft.create({
                data: {
                    accountId,
                    orderId: order.id,
                    wooOrderId: order.wooId,
                    status: 'draft',
                    readinessStatus: readinessErrors.length === 0 ? 'ready' : 'blocked',
                    readinessErrors,
                    addressValidationStatus: addressValidation.status,
                    addressValidationErrors: addressErrors,
                    selectedPackagePresetId: packageSelection.packageId,
                    packageSelectionConfidence: packageSelection.confidence,
                    packageSelectionReason: packageSelection.reason || `Order matched dispatch status: ${dispatchStatus}`,
                    manualWeightGrams: packageSelection.weightGrams,
                    selectedServiceCode,
                },
            });
        } catch (error: any) {
            if (error?.code === 'P2002') {
                return prisma.shippingShipmentDraft.findUnique({ where: { accountId_wooOrderId: { accountId, wooOrderId: order.wooId } } });
            }
            throw error;
        }
    }

    private async selectPackageForOrder(accountId: string, raw: Record<string, any>) {
        const lineItems = Array.isArray(raw.line_items) ? raw.line_items : [];
        if (lineItems.length === 0) return { packageId: null, confidence: 'manual_required', reason: 'Order has no line items for package auto-selection', weightGrams: null as number | null };
        const packages = await prisma.shippingPackagePreset.findMany({
            where: { accountId, isActive: true },
            orderBy: [{ selectionPriority: 'asc' }, { outerLengthMm: 'asc' }, { outerWidthMm: 'asc' }, { outerHeightMm: 'asc' }],
        });
        if (packages.length === 0) return { packageId: null, confidence: 'manual_required', reason: 'No active package presets are configured', weightGrams: null as number | null };

        const productIds = lineItems.map((item: any) => Number(item.product_id)).filter(Boolean);
        const variationIds = lineItems.map((item: any) => Number(item.variation_id)).filter(Boolean);
        const [overrides, products] = await Promise.all([
            prisma.shippingItemOverride.findMany({ where: { accountId, wooProductId: { in: productIds } } }),
            prisma.wooProduct.findMany({ where: { accountId, wooId: { in: [...productIds, ...variationIds] } } }),
        ]);

        const productByWooId = new Map<number, any>(products.map((product: any) => [Number(product.wooId), product]));
        let totalWeightGrams = 0;
        let hasMissingWeight = false;
        let hasMissingDimensions = false;
        const packableUnits: Array<{ lengthMm: number; widthMm: number; heightMm: number; quantity: number }> = [];
        const categoryHints = new Set<string>();
        const overridePackageIds = new Set<string>();
        let overridePackageMatches = 0;
        const inferredProfiles = await this.getCategoryInferredProfiles(accountId);

        const resolveDimensionSource = (product: any, override: any, categoryNames: string[]) => {
            const categoryProfile = this.pickCategoryProfile(inferredProfiles, categoryNames);
            const lengthMm = override?.lengthMm ?? this.cmLikeToMm(product?.length) ?? categoryProfile.lengthMm;
            const widthMm = override?.widthMm ?? this.cmLikeToMm(product?.width) ?? categoryProfile.widthMm;
            const heightMm = override?.heightMm ?? this.cmLikeToMm(product?.height) ?? categoryProfile.heightMm;
            return { lengthMm, widthMm, heightMm };
        };

        for (const item of lineItems) {
            const productId = Number(item.product_id);
            const variationId = Number(item.variation_id) || null;
            const quantity = Math.max(1, Number(item.quantity || 1));
            const override = overrides.find((candidate: any) => candidate.wooProductId === productId && candidate.wooVariationId === variationId)
                || overrides.find((candidate: any) => candidate.wooProductId === productId && !candidate.wooVariationId);

            if (override?.packagePresetId) {
                overridePackageIds.add(override.packagePresetId);
                overridePackageMatches += 1;
            }

            const product = productByWooId.get(variationId || productId) || productByWooId.get(productId);
            const categories = this.extractProductCategories(product);
            categories.forEach((name) => categoryHints.add(name));
            const categoryProfile = this.pickCategoryProfile(inferredProfiles, categories);
            const weightGrams = override?.weightGrams ?? this.kgLikeToGrams(product?.weight) ?? categoryProfile.weightGrams;
            if (weightGrams) totalWeightGrams += weightGrams * quantity;
            else hasMissingWeight = true;

            const { lengthMm, widthMm, heightMm } = resolveDimensionSource(product, override, categories);
            if (lengthMm && widthMm && heightMm) {
                packableUnits.push({ lengthMm, widthMm, heightMm, quantity });
            } else {
                hasMissingDimensions = true;
            }
        }

        if (overridePackageIds.size === 1 && overridePackageMatches === lineItems.length) {
            const packageId = Array.from(overridePackageIds)[0];
            const exactPackage = packages.find((pkg: any) => pkg.id === packageId);
            if (exactPackage) {
                const weight = exactPackage.forcedPackageWeightGrams || totalWeightGrams + exactPackage.packagingWeightGrams;
                return { packageId: exactPackage.id, confidence: 'exact_override', reason: 'All matched items use the same package override', weightGrams: weight || null };
            }
        }

        const candidates: Array<{ pkg: any; score: number; fitReason: string; weight: number; usedFallback: boolean }> = [];
        for (const pkg of packages as any[]) {
            const weight = pkg.forcedPackageWeightGrams
                || ((hasMissingWeight ? pkg.fallbackItemWeightGrams : totalWeightGrams) || 0) + pkg.packagingWeightGrams;
            if (pkg.maxWeightGrams && weight > pkg.maxWeightGrams) continue;
            if (hasMissingDimensions) {
                if (pkg.fallbackItemWeightGrams || pkg.forcedPackageWeightGrams) {
                    candidates.push({ pkg, score: -50, fitReason: 'Missing product dimensions or weight; package fallback was used', weight, usedFallback: true });
                }
                continue;
            }
            const fit = this.evaluatePackageFit(packableUnits, pkg);
            if (!fit.fits) continue;
            const score = this.scorePackageCandidate(fit, pkg, weight, Boolean(hasMissingWeight));
            candidates.push({ pkg, score, fitReason: fit.reason, weight, usedFallback: false });
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score || a.pkg.selectionPriority - b.pkg.selectionPriority);
            const best = candidates[0];
            if (best.usedFallback) {
                return { packageId: best.pkg.id, confidence: 'fallback_weight_used', reason: best.fitReason, weightGrams: best.weight || null };
            }
            return {
                packageId: best.pkg.id,
                confidence: 'fits_by_dimensions',
                reason: `${best.fitReason}; scored ${best.score.toFixed(1)} for space, weight, and handling efficiency`,
                weightGrams: best.weight || null,
            };
        }

        const anyPackageCanTakeWeight = packages.some((pkg: any) => !pkg.maxWeightGrams || totalWeightGrams <= pkg.maxWeightGrams);
        if (!anyPackageCanTakeWeight && totalWeightGrams > 0) return { packageId: null, confidence: 'overweight', reason: 'Order exceeds all configured package weight limits', weightGrams: totalWeightGrams };
        const categoryHintText = categoryHints.size ? ` Checked category defaults for: ${Array.from(categoryHints).slice(0, 3).join(', ')}.` : '';
        return { packageId: null, confidence: hasMissingDimensions ? 'missing_dimensions' : 'manual_required', reason: hasMissingDimensions ? `Product dimensions are missing for package auto-selection.${categoryHintText}` : 'No configured package can fit this order', weightGrams: totalWeightGrams || null };
    }

    private evaluatePackageFit(packableUnits: Array<{ lengthMm: number; widthMm: number; heightMm: number; quantity: number }>, pkg: any): { fits: boolean; reason: string; usedVolumeMm3: number; packageVolumeMm3: number; orientation: string | null } {
        const packageLengthMm = pkg.innerLengthMm || pkg.outerLengthMm;
        const packageWidthMm = pkg.innerWidthMm || pkg.outerWidthMm;
        const packageHeightMm = pkg.innerHeightMm || pkg.outerHeightMm;
        if (!packageLengthMm || !packageWidthMm || !packageHeightMm) return { fits: false, reason: 'Package dimensions are incomplete', usedVolumeMm3: 0, packageVolumeMm3: 0, orientation: null };

        if (this.isFlexiblePackageType(pkg.type)) {
            const flexibleFit = this.evaluateFlexiblePackageFit(packableUnits, packageLengthMm, packageWidthMm, packageHeightMm);
            if (!flexibleFit.fits) return { fits: false, reason: flexibleFit.reason, usedVolumeMm3: flexibleFit.usedVolumeMm3, packageVolumeMm3: flexibleFit.packageVolumeMm3, orientation: null };
            return {
                fits: true,
                reason: flexibleFit.reason,
                usedVolumeMm3: flexibleFit.usedVolumeMm3,
                packageVolumeMm3: flexibleFit.packageVolumeMm3,
                orientation: flexibleFit.orientation,
            };
        }

        const clearanceMm = 5;
        const usableLengthMm = Math.max(0, packageLengthMm - clearanceMm * 2);
        const usableWidthMm = Math.max(0, packageWidthMm - clearanceMm * 2);
        const usableHeightMm = Math.max(0, packageHeightMm - clearanceMm * 2);
        const packageVolumeMm3 = usableLengthMm * usableWidthMm * usableHeightMm;
        const usableVolumeMm3 = Math.floor(packageVolumeMm3 * 0.88);

        let totalUsedVolumeMm3 = 0;
        let totalStackHeightMm = 0;
        let totalStackLengthMm = 0;
        let totalStackWidthMm = 0;
        let maxOrientedLengthMm = 0;
        let maxOrientedWidthMm = 0;
        let maxOrientedHeightMm = 0;

        for (const unit of packableUnits) {
            const orientation = this.chooseBestOrientation(unit, usableLengthMm, usableWidthMm, usableHeightMm);
            if (!orientation) {
                return { fits: false, reason: 'At least one item cannot fit in any orientation', usedVolumeMm3: totalUsedVolumeMm3, packageVolumeMm3: usableVolumeMm3, orientation: null };
            }
            const [l, w, h] = orientation;
            totalUsedVolumeMm3 += l * w * h * unit.quantity;
            totalStackHeightMm += h * unit.quantity;
            totalStackLengthMm += l * unit.quantity;
            totalStackWidthMm += w * unit.quantity;
            maxOrientedLengthMm = Math.max(maxOrientedLengthMm, l);
            maxOrientedWidthMm = Math.max(maxOrientedWidthMm, w);
            maxOrientedHeightMm = Math.max(maxOrientedHeightMm, h);
        }

        const volumeFits = totalUsedVolumeMm3 <= usableVolumeMm3;
        const stackByHeightFits = maxOrientedLengthMm <= usableLengthMm && maxOrientedWidthMm <= usableWidthMm && totalStackHeightMm <= usableHeightMm;
        const stackByLengthFits = maxOrientedHeightMm <= usableHeightMm && maxOrientedWidthMm <= usableWidthMm && totalStackLengthMm <= usableLengthMm;
        const stackByWidthFits = maxOrientedHeightMm <= usableHeightMm && maxOrientedLengthMm <= usableLengthMm && totalStackWidthMm <= usableWidthMm;
        const fits = volumeFits || stackByHeightFits || stackByLengthFits || stackByWidthFits;
        if (!fits) {
            return { fits: false, reason: 'Items exceed usable package dimensions after orientation checks', usedVolumeMm3: totalUsedVolumeMm3, packageVolumeMm3: usableVolumeMm3, orientation: null };
        }

        const reason = volumeFits
            ? 'Selected by orientation-aware fit with usable-volume threshold'
            : 'Selected by orientation-aware stacked-dimension fit';
        return { fits: true, reason, usedVolumeMm3: totalUsedVolumeMm3, packageVolumeMm3: usableVolumeMm3, orientation: volumeFits ? 'volume' : 'stacked' };
    }

    private evaluateFlexiblePackageFit(
        packableUnits: Array<{ lengthMm: number; widthMm: number; heightMm: number; quantity: number }>,
        packageLengthMm: number,
        packageWidthMm: number,
        packageHeightMm: number,
    ): { fits: boolean; reason: string; usedVolumeMm3: number; packageVolumeMm3: number; orientation: 'foldover' | 'satchel_volume' | null } {
        const sealAllowanceMm = 45;
        const sideAllowanceMm = 12;
        const usableLengthMm = Math.max(0, packageLengthMm - sealAllowanceMm);
        const usableWidthMm = Math.max(0, packageWidthMm - sideAllowanceMm);
        const relaxedHeightMm = Math.max(packageHeightMm * 2, packageHeightMm + 25);
        const packageVolumeMm3 = Math.max(0, usableLengthMm * usableWidthMm * relaxedHeightMm);
        const usableVolumeMm3 = Math.floor(packageVolumeMm3 * 0.95);

        let totalUsedVolumeMm3 = 0;
        let maxFlatLengthMm = 0;
        let maxFlatWidthMm = 0;
        let totalThicknessMm = 0;
        for (const unit of packableUnits) {
            const orientation = this.chooseBestOrientation(unit, usableLengthMm, usableWidthMm, relaxedHeightMm);
            if (!orientation) {
                return {
                    fits: false,
                    reason: 'At least one item cannot fit the satchel opening or fold-over depth',
                    usedVolumeMm3: totalUsedVolumeMm3,
                    packageVolumeMm3: usableVolumeMm3,
                    orientation: null,
                };
            }
            const [l, w, h] = orientation;
            totalUsedVolumeMm3 += l * w * h * unit.quantity;
            maxFlatLengthMm = Math.max(maxFlatLengthMm, l);
            maxFlatWidthMm = Math.max(maxFlatWidthMm, w);
            totalThicknessMm += h * unit.quantity;
        }

        const flatAreaFit = maxFlatLengthMm <= usableLengthMm && maxFlatWidthMm <= usableWidthMm;
        const foldoverDepthFit = totalThicknessMm <= relaxedHeightMm;
        const volumeFit = totalUsedVolumeMm3 <= usableVolumeMm3;
        const fits = flatAreaFit && (foldoverDepthFit || volumeFit);
        if (!fits) {
            return {
                fits: false,
                reason: 'Satchel fit failed after fold-over allowance and flexible-depth checks',
                usedVolumeMm3: totalUsedVolumeMm3,
                packageVolumeMm3: usableVolumeMm3,
                orientation: null,
            };
        }

        return {
            fits: true,
            reason: foldoverDepthFit
                ? 'Selected by satchel fold-over depth and flat footprint fit'
                : 'Selected by satchel flexible-volume fit',
            usedVolumeMm3: totalUsedVolumeMm3,
            packageVolumeMm3: usableVolumeMm3,
            orientation: foldoverDepthFit ? 'foldover' : 'satchel_volume',
        };
    }

    private scorePackageCandidate(fit: { usedVolumeMm3: number; packageVolumeMm3: number; orientation: string | null }, pkg: any, weightGrams: number, usedWeightFallback: boolean): number {
        const utilization = fit.packageVolumeMm3 > 0 ? Math.min(1, fit.usedVolumeMm3 / fit.packageVolumeMm3) : 0;
        const deadSpacePenalty = (1 - utilization) * 40;
        const packagingPenalty = Math.min(25, (Number(pkg.packagingWeightGrams || 0) / 1000) * 20);
        const fallbackPenalty = usedWeightFallback ? 15 : 0;
        const weightLimit = Number(pkg.maxWeightGrams || 0);
        const weightHeadroomPenalty = weightLimit > 0 ? Math.max(0, 12 - ((weightLimit - weightGrams) / weightLimit) * 12) : 2;
        const priorityBonus = Math.max(0, 8 - Number(pkg.selectionPriority || 0));
        const orientationBonus = fit.orientation === 'stacked'
            ? 2
            : (fit.orientation === 'foldover' || fit.orientation === 'satchel_volume' ? 6 : 5);
        return 100 - deadSpacePenalty - packagingPenalty - fallbackPenalty - weightHeadroomPenalty + priorityBonus + orientationBonus;
    }

    private isFlexiblePackageType(value: unknown): boolean {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return normalized === 'satchel' || normalized === 'mailer_bag' || normalized === 'poly_mailer' || normalized === 'flat_mailer';
    }

    private chooseBestOrientation(item: { lengthMm: number; widthMm: number; heightMm: number }, maxLengthMm: number, maxWidthMm: number, maxHeightMm: number): [number, number, number] | null {
        const rotations: Array<[number, number, number]> = [
            [item.lengthMm, item.widthMm, item.heightMm],
            [item.lengthMm, item.heightMm, item.widthMm],
            [item.widthMm, item.lengthMm, item.heightMm],
            [item.widthMm, item.heightMm, item.lengthMm],
            [item.heightMm, item.lengthMm, item.widthMm],
            [item.heightMm, item.widthMm, item.lengthMm],
        ];
        const fitRotations = rotations.filter(([l, w, h]) => l <= maxLengthMm && w <= maxWidthMm && h <= maxHeightMm);
        if (fitRotations.length === 0) return null;
        fitRotations.sort((a, b) => a[2] - b[2] || (a[0] * a[1]) - (b[0] * b[1]));
        return fitRotations[0];
    }

    private extractProductCategories(product: any): string[] {
        const raw = (product?.rawData && typeof product.rawData === 'object') ? product.rawData as Record<string, any> : {};
        const categories = Array.isArray(raw.categories) ? raw.categories : [];
        return categories
            .map((category: any) => String(category?.slug || category?.name || '').trim().toLowerCase())
            .filter(Boolean);
    }

    private pickCategoryProfile(
        profiles: {
            global: { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null };
            byCategory: Map<string, { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null }>;
        },
        categories: string[],
    ) {
        for (const category of categories) {
            const profile = profiles.byCategory.get(category);
            if (profile) return profile;
        }
        return profiles.global;
    }

    private async getCategoryInferredProfiles(accountId: string): Promise<{
        global: { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null };
        byCategory: Map<string, { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null }>;
    }> {
        const now = Date.now();
        const cached = this.categoryInferenceCache.get(accountId);
        if (cached && cached.expiresAt > now) return { global: cached.global, byCategory: cached.byCategory };

        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: { weight: true, length: true, width: true, height: true, rawData: true },
            take: 1500,
            orderBy: { updatedAt: 'desc' },
        });

        const globalWeights: number[] = [];
        const globalLengths: number[] = [];
        const globalWidths: number[] = [];
        const globalHeights: number[] = [];
        const byCategoryValues = new Map<string, { weights: number[]; lengths: number[]; widths: number[]; heights: number[] }>();

        for (const product of products) {
            const weightGrams = this.kgLikeToGrams(product.weight);
            const lengthMm = this.cmLikeToMm(product.length);
            const widthMm = this.cmLikeToMm(product.width);
            const heightMm = this.cmLikeToMm(product.height);

            if (weightGrams) globalWeights.push(weightGrams);
            if (lengthMm) globalLengths.push(lengthMm);
            if (widthMm) globalWidths.push(widthMm);
            if (heightMm) globalHeights.push(heightMm);

            const categories = this.extractProductCategories(product);
            for (const category of categories) {
                const bucket = byCategoryValues.get(category) || { weights: [], lengths: [], widths: [], heights: [] };
                if (weightGrams) bucket.weights.push(weightGrams);
                if (lengthMm) bucket.lengths.push(lengthMm);
                if (widthMm) bucket.widths.push(widthMm);
                if (heightMm) bucket.heights.push(heightMm);
                byCategoryValues.set(category, bucket);
            }
        }

        const global = {
            weightGrams: this.median(globalWeights) ?? 500,
            lengthMm: this.median(globalLengths) ?? 140,
            widthMm: this.median(globalWidths) ?? 110,
            heightMm: this.median(globalHeights) ?? 35,
        };

        const byCategory = new Map<string, { weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null }>();
        byCategoryValues.forEach((values, category) => {
            if (values.weights.length < 3 && values.lengths.length < 3) return;
            byCategory.set(category, {
                weightGrams: this.median(values.weights) ?? global.weightGrams,
                lengthMm: this.median(values.lengths) ?? global.lengthMm,
                widthMm: this.median(values.widths) ?? global.widthMm,
                heightMm: this.median(values.heights) ?? global.heightMm,
            });
        });

        this.categoryInferenceCache.set(accountId, { global, byCategory, expiresAt: now + (10 * 60 * 1000) });
        return { global, byCategory };
    }

    private median(values: number[]): number | null {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
        return sorted[middle];
    }

    private kgLikeToGrams(value: unknown): number | null {
        if (value === null || value === undefined) return null;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return Math.ceil(numeric * 1000);
    }

    private cmLikeToMm(value: unknown): number | null {
        if (value === null || value === undefined) return null;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return Math.ceil(numeric * 10);
    }

    private toShippingOrderSummary(order: any) {
        const raw = order.rawData as Record<string, any>;
        const lineItems = Array.isArray(raw.line_items) ? raw.line_items : [];
        return {
            id: order.id,
            wooId: order.wooId,
            number: order.number,
            status: order.status,
            dateCreated: order.dateCreated,
            total: order.total,
            currency: order.currency,
            customerName: [raw.billing?.first_name, raw.billing?.last_name].filter(Boolean).join(' ') || raw.shipping?.first_name || 'Customer',
            email: order.billingEmail || raw.billing?.email || null,
            shipping: this.getShippingAddress(raw),
            itemCount: lineItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0),
            items: lineItems.map((item: any) => ({
                id: Number(item.id || 0) || null,
                name: String(item.name || 'Item'),
                sku: item.sku ? String(item.sku) : null,
                productId: Number(item.product_id || 0) || null,
                variationId: Number(item.variation_id || 0) || null,
                quantity: Number(item.quantity || 0),
                total: item.total != null ? String(item.total) : null,
                metadata: Array.isArray(item.meta_data)
                    ? item.meta_data.map((meta: any) => ({
                        key: String(meta?.key || meta?.display_key || ''),
                        value: meta?.display_value ?? meta?.value ?? null,
                    }))
                    : [],
            })),
        };
    }

    private getShippingAddress(raw: Record<string, any>) {
        const source = raw.shipping || {};
        return {
            name: [source.first_name, source.last_name].filter(Boolean).join(' '),
            company: source.company || '',
            address1: source.address_1 || '',
            address2: source.address_2 || '',
            suburb: source.city || '',
            state: source.state || '',
            postcode: source.postcode || '',
            country: source.country || '',
        };
    }

    private async applyResolvedServiceToDraft(accountId: string, order: any, draft: any) {
        if (this.stringSetting(draft.selectedServiceCode)) return draft;
        const selectedServiceCode = await this.resolveServiceCodeForOrder(accountId, order.rawData as Record<string, any>);
        if (!selectedServiceCode) return draft;

        const existingReadinessErrors = Array.isArray(draft.readinessErrors) ? draft.readinessErrors as any[] : [];
        const readinessErrors = existingReadinessErrors.filter((error) => error?.field !== 'service');
        return prisma.shippingShipmentDraft.update({
            where: { accountId_wooOrderId: { accountId, wooOrderId: order.wooId } },
            data: {
                selectedServiceCode,
                readinessErrors: readinessErrors as Prisma.InputJsonValue,
                readinessStatus: readinessErrors.length === 0 ? 'ready' : 'blocked',
            },
        });
    }

    private async resolveServiceCodeForOrder(accountId: string, raw: Record<string, any>): Promise<string | null> {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, select: { config: true } });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        const country = String(raw.shipping?.country || raw.billing?.country || '').toUpperCase();
        if (country && country !== 'AU') return this.stringSetting(config.defaultInternationalService) || null;

        const shippingMethod = this.getWooShippingMethodText(raw);
        const mappedServiceCode = this.resolveMappedServiceCode(shippingMethod, config.shippingMethodServiceMappings);
        if (mappedServiceCode) return mappedServiceCode;

        const normalizedShippingMethod = shippingMethod.toLowerCase();
        if (normalizedShippingMethod.includes('express')) {
            return this.stringSetting(config.defaultExpressService) || this.stringSetting(config.defaultDomesticService) || null;
        }

        return this.stringSetting(config.defaultDomesticService) || null;
    }

    private resolveMappedServiceCode(shippingMethod: string, rawMappings: unknown): string | null {
        const normalizedShippingMethod = shippingMethod.trim().toLowerCase();
        if (!normalizedShippingMethod || !Array.isArray(rawMappings)) return null;
        for (const mapping of rawMappings) {
            if (!mapping || typeof mapping !== 'object') continue;
            const record = mapping as Record<string, unknown>;
            const wooShippingMethod = this.stringSetting(record.wooShippingMethod);
            const auspostServiceCode = this.stringSetting(record.auspostServiceCode);
            if (!wooShippingMethod || !auspostServiceCode) continue;
            const normalizedCandidate = wooShippingMethod.toLowerCase();
            const matchType = record.matchType === 'contains' ? 'contains' : 'exact';
            if (matchType === 'contains') {
                if (normalizedShippingMethod.includes(normalizedCandidate)) return auspostServiceCode;
                continue;
            }
            if (normalizedShippingMethod === normalizedCandidate) return auspostServiceCode;
        }
        return null;
    }

    private getWooShippingMethodText(raw: Record<string, any>) {
        const shippingLines = Array.isArray(raw.shipping_lines) ? raw.shipping_lines : [];
        return shippingLines.map((line: Record<string, unknown>) => [
            line.method_title,
            line.methodTitle,
            line.method_id,
            line.methodId,
        ].filter(Boolean).join(' ')).filter(Boolean).join(' ') || String(raw.shipping_method_title || raw.shipping_method || '');
    }

    private resolveLabelPrintGroupForOrder(raw: Record<string, any>, config: Record<string, unknown>): 'Parcel Post' | 'Express Post' | undefined {
        if (this.getWooShippingMethodText(raw).toLowerCase().includes('express')) return 'Express Post';
        return this.stringSetting(config.labelPrintGroup) as 'Parcel Post' | 'Express Post' | undefined;
    }

    private validateAddressShape(address: Record<string, unknown>) {
        const required = ['address1', 'suburb', 'state', 'postcode', 'country'];
        return required.filter((key) => !String(address[key] || '').trim()).map((key) => ({ field: key, message: `${key} is required` }));
    }

    private stringSetting(value: unknown) {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private buildLabelData(
        accountId: string,
        order: any,
        wooOrderId: number,
        settings: any,
        shipmentResult: any,
        requestId: string,
        draft: any,
        requestSnapshot: Record<string, unknown>,
        labelRequestResult: any,
        resolvedLabelRequest: any,
        userId?: string,
    ) {
        const trackingNumber = shipmentResult.shipment.trackingNumber;
        return {
            accountId,
            orderId: order.id,
            wooOrderId,
            carrier: 'AUSPOST',
            carrierAccountId: settings.id,
            carrierShipmentId: shipmentResult.shipment.carrierShipmentId,
            carrierLabelId: requestId,
            trackingNumber,
            trackingUrl: trackingNumber ? `https://auspost.com.au/mypost/track/#/details/${trackingNumber}` : null,
            serviceCode: draft.selectedServiceCode,
            serviceName: draft.selectedServiceCode,
            labelFormat: 'PDF',
            costAmount: shipmentResult.shipment.totalCost,
            costCurrency: 'AUD',
            requestSnapshot: requestSnapshot as any,
            responseSnapshot: { shipment: shipmentResult.rawResponse, labelRequest: labelRequestResult.rawResponse, resolvedLabelRequest },
            createdByUserId: userId,
        };
    }

    private resolveAddress(draft: any, order: any): Record<string, unknown> {
        const corrected = draft.correctedAddress as Record<string, unknown> | null;
        if (corrected && Object.keys(corrected).length > 0) return corrected;
        return this.getShippingAddress(order.rawData as Record<string, any>);
    }

    private resolveDimensions(draft: any, selectedPackage: any) {
        const packageWeightGrams = selectedPackage
            ? selectedPackage.forcedPackageWeightGrams
                || (draft.manualWeightGrams ? draft.manualWeightGrams + selectedPackage.packagingWeightGrams : null)
                || (selectedPackage.fallbackItemWeightGrams ? selectedPackage.fallbackItemWeightGrams + selectedPackage.packagingWeightGrams : null)
                || selectedPackage.packagingWeightGrams
                || null
            : draft.manualWeightGrams;
        return {
            lengthMm: draft.manualOuterLengthMm || selectedPackage?.outerLengthMm || null,
            widthMm: draft.manualOuterWidthMm || selectedPackage?.outerWidthMm || null,
            heightMm: draft.manualOuterHeightMm || selectedPackage?.outerHeightMm || null,
            weightGrams: packageWeightGrams,
        };
    }

    private validateLabelFilePath(label: any) {
        if (!label.labelFilePath) throw new Error('Stored label PDF is missing');
        if (!this.isSafeLabelFilePath(label.labelFilePath) || !fs.existsSync(label.labelFilePath)) {
            throw new Error('Stored label PDF path is invalid or unavailable');
        }
    }

    private getPrintDeliveryMethod(config: Record<string, unknown>): 'remote_print' | 'open_pdf' {
        return config.printDeliveryMethod === 'open_pdf' ? 'open_pdf' : 'remote_print';
    }

    private getConfiguredLabelLayout(config: Record<string, unknown>): 'A4-1pp' | 'A4-3pp' | 'A4-4pp' | 'A6-1pp' | undefined {
        const layout = this.stringSetting(config.labelLayout);
        if (layout && ['A4-1pp', 'A4-3pp', 'A4-4pp', 'A6-1pp'].includes(layout)) return layout as 'A4-1pp' | 'A4-3pp' | 'A4-4pp' | 'A6-1pp';
        return this.labelLayoutForPaperType(this.stringSetting(config.labelPaperType));
    }

    private labelLayoutForPaperType(value: unknown): 'A4-4pp' | 'A6-1pp' | undefined {
        if (value === 'a4_label_sheet') return 'A4-4pp';
        if (value === 'single_shipping_label') return 'A6-1pp';
        return undefined;
    }

    private async resolveLabelRequestWithRetry(accountId: string, initial: { url?: string | null; status?: string | null; message?: string | null }, requestId: string) {
        if (initial.url) return initial;
        let latest = initial;
        const delaysMs = [500, 1200, 2500, 4000];
        for (const delayMs of delaysMs) {
            await this.sleep(delayMs);
            latest = (await ausPostShippingTrackingAdapter.getLabelRequest(accountId, requestId)).labelRequest;
            if (latest.url) return latest;
            if (String(latest.status || '').toUpperCase() === 'FAILED') return latest;
        }
        return latest;
    }

    private async downloadLabelPdfWithRetry(url: string) {
        let lastError: Error | null = null;
        const delaysMs = [0, 800, 1800];
        for (const delayMs of delaysMs) {
            if (delayMs > 0) await this.sleep(delayMs);
            try {
                return await ausPostShippingTrackingAdapter.downloadLabelPdf(url);
            } catch (error: any) {
                lastError = error instanceof Error ? error : new Error(error?.message || 'Unknown PDF download error');
            }
        }
        throw lastError || new Error('AusPost label PDF download failed');
    }

    private async sleep(ms: number) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async attemptFulfillmentSyncWithBackoff(accountId: string, label: any, metadata: Record<string, unknown>) {
        let lastResult: any = null;
        let lastErrorMessage: string | null = null;
        const delaysMs = [0, 1000, 2500];

        for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
            if (delaysMs[attempt] > 0) await this.sleep(delaysMs[attempt]);
            try {
                const fulfillmentResult = await shippingFulfillmentService.syncPrintedLabel(accountId, label.id);
                lastResult = fulfillmentResult;
                const fulfillmentError = 'error' in fulfillmentResult ? fulfillmentResult.error : null;
                if (!fulfillmentError) {
                    await prisma.shippingLabel.update({ where: { id: label.id }, data: { status: 'fulfilled', errorMessage: null } });
                    await this.recordAuditEvent(accountId, 'LABEL_PRINT_FULFILLMENT_SYNCED', {
                        orderId: label.orderId,
                        labelId: label.id,
                        metadata: { ...metadata, attempt: attempt + 1, wooOrderId: label.wooOrderId, ...fulfillmentResult },
                    });
                    return { ok: true, attempts: attempt + 1, result: fulfillmentResult };
                }
                lastErrorMessage = fulfillmentError;
            } catch (error: any) {
                lastErrorMessage = error?.message || 'Fulfillment sync failed';
            }
        }

        await prisma.shippingLabel.update({
            where: { id: label.id },
            data: { errorMessage: `WooCommerce sync failed: ${lastErrorMessage || 'Unknown error'}` },
        });
        await this.recordAuditEvent(accountId, 'LABEL_PRINT_FULFILLMENT_SYNC_FAILED', {
            orderId: label.orderId,
            labelId: label.id,
            metadata: { ...metadata, wooOrderId: label.wooOrderId, attempts: delaysMs.length, error: lastErrorMessage, fulfillment: lastResult },
        });
        return { ok: false, attempts: delaysMs.length, error: lastErrorMessage, result: lastResult };
    }

    private async getWooFulfillmentBehavior(accountId: string): Promise<'keep_in_dispatch' | 'label_created' | 'print_success'> {
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, select: { config: true } });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        const value = this.stringSetting(config.wooFulfillmentBehavior);
        if (value === 'label_created' || value === 'print_success' || value === 'keep_in_dispatch') return value;
        return 'print_success';
    }

    private async getServiceReadinessError(accountId: string, draft: { selectedServiceCode?: string | null }) {
        const selectedServiceCode = this.stringSetting(draft.selectedServiceCode);
        if (selectedServiceCode) return null;
        const settings = await prisma.shippingCarrierAccount.findFirst({ where: { accountId, carrier: 'AUSPOST' }, select: { config: true } });
        const config = (settings?.config as Record<string, unknown> | null) || {};
        const defaultDomesticService = this.stringSetting(config.defaultDomesticService);
        return defaultDomesticService ? null : { field: 'service', message: 'AusPost service code is required (select a service or set a default in Shipping Settings)' };
    }

    private storeLabelPdf(accountId: string, wooOrderId: number, requestId: string, pdf: Buffer) {
        const safeAccountId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeRequestId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const labelDir = path.join(ShippingService.LABEL_STORAGE_BASE_DIR, safeAccountId);
        fs.mkdirSync(labelDir, { recursive: true });
        const filePath = path.join(labelDir, `${wooOrderId}-${safeRequestId}.pdf`);
        if (!this.isSafeLabelFilePath(filePath)) throw new Error('Resolved label storage path is invalid');
        fs.writeFileSync(filePath, pdf);
        return filePath;
    }

    private isSafeLabelFilePath(filePath: string) {
        if (!filePath || typeof filePath !== 'string') return false;
        const resolved = path.resolve(filePath);
        const base = ShippingService.LABEL_STORAGE_BASE_DIR;
        if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return false;
        try {
            const real = fs.realpathSync(resolved);
            return real === base || real.startsWith(`${base}${path.sep}`);
        } catch {
            return false;
        }
    }

    private compareVersions(left: string, right: string) {
        const leftParts = String(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
        const rightParts = String(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
        for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
            const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    private async getPrintJobForOperations(accountId: string, jobId: string) {
        return prisma.shippingPrintJob.findFirst({
            where: { id: jobId, accountId },
            include: {
                label: { select: { id: true, wooOrderId: true, trackingNumber: true, serviceName: true, labelStoredUntil: true } },
                printStation: { select: { id: true, name: true, status: true, defaultPrinterName: true } },
                reassignedFromStation: { select: { id: true, name: true } },
            },
        });
    }

    private async recordAuditEvent(accountId: string, eventType: string, data: {
        orderId?: string | null;
        labelId?: string | null;
        draftId?: string | null;
        userId?: string | null;
        beforeSnapshot?: Record<string, unknown>;
        afterSnapshot?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }) {
        await prisma.shippingAuditEvent.create({
            data: {
                accountId,
                orderId: data.orderId || null,
                labelId: data.labelId || null,
                draftId: data.draftId || null,
                userId: data.userId || null,
                eventType,
                beforeSnapshot: (data.beforeSnapshot || {}) as Prisma.InputJsonValue,
                afterSnapshot: (data.afterSnapshot || {}) as Prisma.InputJsonValue,
                metadata: (data.metadata || {}) as Prisma.InputJsonValue,
            },
        });
    }

    private snapshotDraft(draft: any) {
        return {
            id: draft.id,
            readinessStatus: draft.readinessStatus,
            readinessErrors: draft.readinessErrors,
            addressValidationStatus: draft.addressValidationStatus,
            addressValidationErrors: draft.addressValidationErrors,
            selectedPackagePresetId: draft.selectedPackagePresetId,
            packageSelectionConfidence: draft.packageSelectionConfidence,
            packageSelectionReason: draft.packageSelectionReason,
            selectedServiceCode: draft.selectedServiceCode,
            selectedPrintStationId: draft.selectedPrintStationId,
            manualWeightGrams: draft.manualWeightGrams,
            updatedAt: draft.updatedAt,
        };
    }

    private hashStationToken(token: string) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }
}

export const shippingService = new ShippingService();

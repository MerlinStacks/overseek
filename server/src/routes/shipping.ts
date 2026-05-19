import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { Logger } from '../utils/logger';
import { SHIPPING_FEATURE_KEY, shippingService } from '../services/shipping/ShippingService';
import { PermissionService } from '../services/PermissionService';
import { shippingTrackingService } from '../services/shipping/ShippingTrackingService';

const listQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(200).default(50),
});

const orderListQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(200).default(50),
});

const orderParamsSchema = z.object({
    wooOrderId: z.coerce.number().int().positive(),
});

const packageSchema = z.object({
    name: z.string().min(1).max(120),
    type: z.string().min(1).max(60).optional(),
    innerLengthMm: z.number().int().positive().nullable().optional(),
    innerWidthMm: z.number().int().positive().nullable().optional(),
    innerHeightMm: z.number().int().positive().nullable().optional(),
    outerLengthMm: z.number().int().positive(),
    outerWidthMm: z.number().int().positive(),
    outerHeightMm: z.number().int().positive(),
    fallbackItemWeightGrams: z.number().int().positive().nullable().optional(),
    forcedPackageWeightGrams: z.number().int().positive().nullable().optional(),
    packagingWeightGrams: z.number().int().min(0).optional(),
    maxWeightGrams: z.number().int().positive().nullable().optional(),
    selectionPriority: z.number().int().min(0).optional(),
    carrierProductCode: z.string().max(80).nullable().optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
});

const packageUpdateSchema = packageSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one package field is required',
});

const itemOverrideSchema = z.object({
    wooProductId: z.number().int().positive(),
    wooVariationId: z.number().int().positive().nullable().optional(),
    packagePresetId: z.string().nullable().optional(),
    weightGrams: z.number().int().positive().nullable().optional(),
    lengthMm: z.number().int().positive().nullable().optional(),
    widthMm: z.number().int().positive().nullable().optional(),
    heightMm: z.number().int().positive().nullable().optional(),
    packingMode: z.string().max(80).optional(),
    dangerousGoods: z.boolean().optional(),
    fragile: z.boolean().optional(),
    customsDescription: z.string().max(255).nullable().optional(),
    countryOfOrigin: z.string().max(2).nullable().optional(),
    hsCode: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

const itemOverrideUpdateSchema = itemOverrideSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one override field is required',
});

const settingsSchema = z.object({
    displayName: z.string().min(1).max(120).optional(),
    isEnabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiProduct: z.string().max(80).optional(),
    apiEnvironment: z.enum(['sandbox', 'production']).optional(),
    apiBaseUrl: z.string().url().max(255).optional(),
    testEndpointPath: z.string().max(255).optional(),
    ratesEndpointPath: z.string().max(255).optional(),
    labelsEndpointPath: z.string().max(255).optional(),
    labelPdfEndpointPath: z.string().max(255).optional(),
    trackingEndpointPath: z.string().max(255).optional(),
    cancellationEndpointPath: z.string().max(255).optional(),
    accountNumber: z.string().max(120).optional(),
    paymentMethod: z.string().max(120).optional(),
    dispatchStatus: z.string().max(80).optional(),
    senderAddress: z.record(z.string(), z.unknown()).optional(),
    defaultDomesticService: z.string().max(80).optional(),
    defaultExpressService: z.string().max(80).optional(),
    defaultInternationalService: z.string().max(80).optional(),
    defaultPackagePresetId: z.string().optional(),
    labelFormat: z.string().max(20).optional(),
    defaultPrintStationId: z.string().optional(),
    wooFulfillmentBehavior: z.enum(['keep_in_dispatch', 'label_created', 'print_success']).optional(),
    trackingSyncEnabled: z.boolean().optional(),
    trackingAutomationAllowlist: z.array(z.enum([
        'SHIPMENT_RECEIVED_BY_CARRIER',
        'SHIPMENT_IN_TRANSIT',
        'SHIPMENT_OUT_FOR_DELIVERY',
        'SHIPMENT_DELIVERY_ATTEMPTED',
        'SHIPMENT_DELIVERED',
        'SHIPMENT_EXCEPTION',
    ])).optional(),
    trackingPollIntervalMinutes: z.number().int().min(5).max(180).optional(),
    trackingPollFailureBackoffMinutes: z.number().int().min(10).max(360).optional(),
    labelPrintGroup: z.enum(['Parcel Post', 'Express Post']).optional(),
    labelLayout: z.enum(['A4-1pp', 'A4-3pp', 'A4-4pp', 'A6-1pp']).optional(),
    labelPaperType: z.enum(['a4_label_sheet', 'single_shipping_label']).optional(),
    printDeliveryMethod: z.enum(['remote_print', 'open_pdf']).optional(),
    labelBranded: z.boolean().optional(),
});

const draftUpdateSchema = z.object({
    selectedPackagePresetId: z.string().nullable().optional(),
    manualOuterLengthMm: z.number().int().positive().nullable().optional(),
    manualOuterWidthMm: z.number().int().positive().nullable().optional(),
    manualOuterHeightMm: z.number().int().positive().nullable().optional(),
    manualWeightGrams: z.number().int().positive().nullable().optional(),
    correctedAddress: z.record(z.string(), z.unknown()).optional(),
    selectedServiceCode: z.string().nullable().optional(),
    selectedPrintStationId: z.string().nullable().optional(),
});

const bulkLabelsSchema = z.object({
    wooOrderIds: z.array(z.number().int().positive()).min(1).max(100),
    printStationId: z.string().nullable().optional(),
});

const createLabelSchema = z.object({
    printStationId: z.string().nullable().optional(),
}).optional();

const reprintSchema = z.object({
    printStationId: z.string().nullable().optional(),
});

const recoverLabelSchema = z.object({
    printStationId: z.string().nullable().optional(),
    queuePrint: z.boolean().optional(),
});

const cancelLabelSchema = z.object({
    reason: z.string().max(500).nullable().optional(),
});

const reassignPrintJobSchema = z.object({
    printStationId: z.string().min(1),
});

const trackingEventSchema = z.object({
    eventCode: z.string().max(120).nullable().optional(),
    status: z.string().max(120).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    occurredAt: z.string().datetime().optional(),
    rawEvent: z.record(z.string(), z.unknown()).optional(),
});

const printStationSchema = z.object({
    name: z.string().min(1).max(120),
    defaultPrinterName: z.string().max(255).nullable().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

async function requireShippingPermission(request: any, reply: any, permission: string) {
    const accountId = request.accountId;
    const userId = request.user?.id;
    if (!accountId || !userId) return reply.code(401).send({ error: 'Authentication required' });
    const allowed = await PermissionService.hasPermission(userId, accountId, permission);
    if (!allowed) return reply.code(403).send({ error: 'Insufficient shipping permission' });
}

const shippingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'Account context required' });
        }

        const enabled = await isAccountFeatureEnabled(accountId, SHIPPING_FEATURE_KEY, false);
        if (!enabled) {
            return reply.code(403).send({ error: 'Shipping Hub feature is disabled for this account' });
        }
    });

    fastify.get('/hub', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return await shippingService.getHubSummary(request.accountId!);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch hub summary', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch shipping hub summary' });
        }
    });

    fastify.get('/packages', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return { packages: await shippingService.listPackages(request.accountId!) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch packages', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch shipping packages' });
        }
    });

    fastify.get('/orders', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const { limit } = orderListQuerySchema.parse(request.query);
            return await shippingService.listDispatchOrders(request.accountId!, limit);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch dispatch orders', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch dispatch orders' });
        }
    });

    fastify.patch<{ Params: { wooOrderId: string } }>('/orders/:wooOrderId/draft', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = orderParamsSchema.safeParse(request.params);
            const parsed = draftUpdateSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid draft payload', details: parsed.error.flatten() });
            return { draft: await shippingService.updateDraft(request.accountId!, params.data.wooOrderId, parsed.data, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to update shipment draft', { error: error?.message || error });
            const status = error?.message === 'Order not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Order not found' : 'Failed to update shipment draft' });
        }
    });

    fastify.post<{ Params: { wooOrderId: string } }>('/orders/:wooOrderId/validate-address', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = orderParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
            return { draft: await shippingService.validateAddress(request.accountId!, params.data.wooOrderId, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to validate address', { error: error?.message || error });
            const status = error?.message === 'Order not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Order not found' : 'Failed to validate address' });
        }
    });

    fastify.post<{ Params: { wooOrderId: string } }>('/orders/:wooOrderId/rates', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = orderParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
            return await shippingService.requestDraftRates(request.accountId!, params.data.wooOrderId, request.user?.id);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Rates unavailable', { error: error?.message || error });
            const knownBadRequest = ['AusPost credentials are not configured', 'Order not found'];
            const status = knownBadRequest.includes(error?.message)
                ? 400
                : error?.message === 'AusPost rates endpoint mapping is not configured yet'
                    ? 501
                    : 500;
            return reply.code(status).send({ error: error.message || 'Rates are not available yet' });
        }
    });

    fastify.get<{ Params: { wooOrderId: string } }>('/orders/:wooOrderId/shipments', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const params = orderParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
            return await shippingService.getOrderShipments(request.accountId!, params.data.wooOrderId);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch order shipments', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch order shipments' });
        }
    });

    fastify.post<{ Params: { wooOrderId: string } }>('/orders/:wooOrderId/labels', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = orderParamsSchema.safeParse(request.params);
            const parsed = createLabelSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid label payload', details: parsed.error.flatten() });
            return { label: await shippingService.createAndQueueLabelPlaceholder(request.accountId!, params.data.wooOrderId, request.user?.id, parsed.data?.printStationId) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Label creation unavailable', { error: error?.message || error });
            const knownBadRequest = [
                'AusPost credentials are not configured',
                'Order not found',
                'Shipment draft is not ready',
                'AusPost label print group must be configured in Shipping Settings',
                'AusPost label layout must be configured in Shipping Settings',
                'Print station not configured',
                'A label create request is already in progress for this order',
            ];
            const status = knownBadRequest.includes(error?.message) || String(error?.message || '').startsWith('Shipment label already exists for this order') ? 400 : 501;
            return reply.code(status).send({ error: error.message || 'AusPost label creation is not available yet' });
        }
    });

    fastify.post('/orders/bulk-labels', async (request, reply) => {
        try {
            const createDenied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (createDenied) return createDenied;
            const printDenied = await requireShippingPermission(request, reply, 'print_shipping_labels');
            if (printDenied) return printDenied;
            const parsed = bulkLabelsSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid bulk label payload', details: parsed.error.flatten() });
            return await shippingService.bulkCreateAndQueueLabels(request.accountId!, {
                wooOrderIds: parsed.data.wooOrderIds,
                printStationId: parsed.data.printStationId,
                userId: request.user?.id,
            });
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Bulk label creation failed', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to process bulk label request' });
        }
    });

    fastify.post('/packages', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const parsed = packageSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid package payload', details: parsed.error.flatten() });
            return reply.code(201).send({ package: await shippingService.createPackage(request.accountId!, parsed.data) });
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to create package', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to create shipping package' });
        }
    });

    fastify.patch<{ Params: { id: string } }>('/packages/:id', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = packageUpdateSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid package id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid package payload', details: parsed.error.flatten() });
            return { package: await shippingService.updatePackage(request.accountId!, params.data.id, parsed.data) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to update package', { error: error?.message || error });
            const status = error?.message === 'Package not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Package not found' : 'Failed to update shipping package' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/packages/:id', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid package id' });
            return { package: await shippingService.deactivatePackage(request.accountId!, params.data.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to deactivate package', { error: error?.message || error });
            const status = error?.message === 'Package not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Package not found' : 'Failed to deactivate shipping package' });
        }
    });

    fastify.get('/item-overwrites', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return { itemOverrides: await shippingService.listItemOverrides(request.accountId!) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch item overrides', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch item overrides' });
        }
    });

    fastify.post('/item-overwrites', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const parsed = itemOverrideSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid item override payload', details: parsed.error.flatten() });
            return reply.code(201).send({ itemOverride: await shippingService.createItemOverride(request.accountId!, parsed.data) });
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to create item override', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to create item override' });
        }
    });

    fastify.patch<{ Params: { id: string } }>('/item-overwrites/:id', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = itemOverrideUpdateSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid item override id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid item override payload', details: parsed.error.flatten() });
            return { itemOverride: await shippingService.updateItemOverride(request.accountId!, params.data.id, parsed.data) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to update item override', { error: error?.message || error });
            const status = error?.message === 'Item override not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Item override not found' : 'Failed to update item override' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/item-overwrites/:id', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_packages');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid item override id' });
            return { itemOverride: await shippingService.deleteItemOverride(request.accountId!, params.data.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to delete item override', { error: error?.message || error });
            const status = error?.message === 'Item override not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Item override not found' : 'Failed to delete item override' });
        }
    });

    fastify.get('/labels', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const { limit } = listQuerySchema.parse(request.query);
            return { labels: await shippingService.listLabels(request.accountId!, limit) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch labels', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch shipping labels' });
        }
    });

    fastify.get('/transactions', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const { limit } = listQuerySchema.parse(request.query);
            return { transactions: await shippingService.listCarrierTransactions(request.accountId!, limit) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch carrier transactions', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch shipping transactions' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/reprint', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'print_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = reprintSchema.safeParse(request.body || {});
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid reprint payload', details: parsed.error.flatten() });
            return { printJob: await shippingService.queueStoredLabelReprint(request.accountId!, params.data.id, parsed.data.printStationId, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to queue label reprint', { error: error?.message || error });
            const known = ['Label not found', 'Stored label PDF is missing', 'Stored label PDF path is invalid or unavailable', 'Print station not configured'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to queue label reprint' });
        }
    });

    fastify.get<{ Params: { id: string } }>('/labels/:id/pdf', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            const label = await shippingService.getStoredLabelPdf(request.accountId!, params.data.id, request.user?.id);
            reply.header('Content-Type', label.contentType);
            reply.header('Content-Disposition', `inline; filename="${label.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
            return reply.send(label.pdf);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to open label PDF', { error: error?.message || error });
            const known = ['Label not found', 'Stored label PDF is missing', 'Stored label PDF path is invalid or unavailable'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to open label PDF' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/recover-pdf', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = recoverLabelSchema.safeParse(request.body || {});
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid recover payload', details: parsed.error.flatten() });
            return {
                label: await shippingService.recoverPendingLabelPdf(
                    request.accountId!,
                    params.data.id,
                    parsed.data.printStationId,
                    request.user?.id,
                    parsed.data.queuePrint !== false,
                ),
            };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to recover label PDF', { error: error?.message || error });
            const known = [
                'Label not found',
                'Carrier label request ID is missing',
                'Cancelled labels cannot be recovered',
                'AusPost label PDF is still pending',
                'Print station not configured',
            ];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to recover label PDF' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/retry-fulfillment', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'create_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            return await shippingService.retryLabelFulfillmentSync(request.accountId!, params.data.id, request.user?.id);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to retry WooCommerce fulfillment sync', { error: error?.message || error });
            const known = ['Label not found', 'Only printed or fulfilled labels can retry WooCommerce sync'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to retry WooCommerce sync' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/cancel', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'cancel_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = cancelLabelSchema.safeParse(request.body || {});
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid cancellation payload', details: parsed.error.flatten() });
            return { label: await shippingService.requestLabelCancellation(request.accountId!, params.data.id, parsed.data.reason, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to cancel label', { error: error?.message || error });
            const known = [
                'Label not found',
                'Label is already cancelled',
                'Carrier shipment ID is missing for this label',
                'Label cannot be cancelled after printed state',
                'Label cannot be cancelled after fulfilled state',
                'Label cannot be cancelled after delivered state',
                'Label cannot be cancelled after returned state',
            ];
            const status = known.includes(error?.message)
                ? 400
                : error?.message === 'AusPost cancellation endpoint mapping is not configured yet'
                    ? 501
                    : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to cancel label' });
        }
    });

    fastify.get<{ Params: { id: string } }>('/labels/:id/tracking', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            return await shippingService.getLabelTracking(request.accountId!, params.data.id);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch label tracking', { error: error?.message || error });
            const status = error?.message === 'Label not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Label not found' : 'Failed to fetch label tracking' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/tracking/events', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_settings');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = trackingEventSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid tracking event payload', details: parsed.error.flatten() });
            return await shippingTrackingService.recordTrackingEvent(request.accountId!, params.data.id, parsed.data);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to record tracking event', { error: error?.message || error });
            const status = error?.message === 'Label not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Label not found' : 'Failed to record tracking event' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/labels/:id/tracking/refresh', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid label id' });
            return await shippingTrackingService.refreshTrackingFromCarrier(request.accountId!, params.data.id);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Tracking refresh unavailable', { error: error?.message || error });
            const status = error?.message === 'Label not found'
                ? 404
                : error?.message === 'AusPost tracking endpoint mapping is not configured yet'
                    ? 501
                    : 500;
            return reply.code(status).send({ error: error.message || 'Tracking refresh is not available yet' });
        }
    });

    fastify.get('/tracking/health', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return await shippingTrackingService.getTrackingHealthSummary(request.accountId!);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch tracking health summary', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch tracking health summary' });
        }
    });

    fastify.get('/print-stations', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return { printStations: await shippingService.listPrintStations(request.accountId!) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch print stations', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch print stations' });
        }
    });

    fastify.get('/print-jobs', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const { limit } = listQuerySchema.parse(request.query);
            return { printJobs: await shippingService.listPrintJobs(request.accountId!, limit) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch print jobs', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch print jobs' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/print-jobs/:id/retry', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'print_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid print job id' });
            return { printJob: await shippingService.retryPrintJob(request.accountId!, params.data.id, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to retry print job', { error: error?.message || error });
            const known = ['Print job not found', 'Only failed or offline print jobs can be retried'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to retry print job' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/print-jobs/:id/reassign', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'print_shipping_labels');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            const parsed = reassignPrintJobSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid print job id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid print job reassignment payload', details: parsed.error.flatten() });
            return { printJob: await shippingService.reassignPrintJob(request.accountId!, params.data.id, parsed.data.printStationId, request.user?.id) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to reassign print job', { error: error?.message || error });
            const known = ['Print job not found', 'Print station not found', 'Printed jobs cannot be reassigned', 'Only queued, failed, or offline print jobs can be reassigned'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to reassign print job' });
        }
    });

    fastify.get('/audit-events', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            const { limit } = listQuerySchema.parse(request.query);
            return { auditEvents: await shippingService.listAuditEvents(request.accountId!, limit) };
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch audit events', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch audit events' });
        }
    });

    fastify.post('/print-stations', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_settings');
            if (denied) return denied;
            const parsed = printStationSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid print station payload', details: parsed.error.flatten() });
            return reply.code(201).send(await shippingService.createPrintStation(request.accountId!, parsed.data.name, parsed.data.defaultPrinterName));
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to create print station', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to create print station' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/print-stations/:id/rotate-token', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_settings');
            if (denied) return denied;
            const params = idParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid print station id' });
            return await shippingService.rotatePrintStationToken(request.accountId!, params.data.id);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to rotate print station token', { error: error?.message || error });
            const status = error?.message === 'Print station not found' ? 404 : 500;
            return reply.code(status).send({ error: status === 404 ? 'Print station not found' : 'Failed to rotate print station token' });
        }
    });

    fastify.get('/settings', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'view_shipping');
            if (denied) return denied;
            return await shippingService.getSafeSettings(request.accountId!);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to fetch settings', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch shipping settings' });
        }
    });

    fastify.patch('/settings', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_settings');
            if (denied) return denied;
            const parsed = settingsSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid settings payload', details: parsed.error.flatten() });
            return await shippingService.saveSettings(request.accountId!, parsed.data);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to save settings', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to save shipping settings' });
        }
    });

    fastify.post('/settings/test-connection', async (request, reply) => {
        try {
            const denied = await requireShippingPermission(request, reply, 'manage_shipping_settings');
            if (denied) return denied;
            return await shippingService.testAusPostSettings(request.accountId!);
        } catch (error: any) {
            Logger.error('[ShippingRoutes] Failed to test AusPost settings', { error: error?.message || error });
            const known = ['AusPost credentials are not configured', 'AusPost API key is not configured', 'AusPost account number is not configured'];
            const status = known.includes(error?.message) ? 400 : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to test AusPost settings' });
        }
    });
};

export default shippingRoutes;

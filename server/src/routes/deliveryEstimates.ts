import { FastifyInstance } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { DeliveryEstimateService, DeliveryResourceNotFound } from '../services/deliveryEstimates/service';
import { productInputSchema, settingsSchema } from '../services/deliveryEstimates/validation';
import { DeliveryDiscoveryError, discoverShippingMethods } from '../services/deliveryEstimates/discovery';
import { deliverySyncStatus, requestDeliverySync } from '../services/deliveryEstimates/sync';
import { inputListQuery, listDeliveryInputs, retryDeliveryInput } from '../services/deliveryEstimates/inputRecovery';
import { activationSchema, cutoverSchema, deliveryLocalStatus, deliveryReadiness, requestActivation, requestCutover } from '../services/deliveryEstimates/launch';
import { listReceiptCycles, listReceipts, observeReceipt, reconciliationSchema, requestReconciliation } from '../services/deliveryEstimates/reconciliation';
import { retryReceiptCascade } from '../services/deliveryEstimates/receiptCascade';
import { legacyReviewSchema, legacyResolutionSchema, listLegacyReceipts, observeLegacyReceipt, requestLegacyResolution, requestLegacyPoReversalReview } from '../services/deliveryEstimates/legacyRecovery';

/** Local delivery drafts and on-demand discovery with account auth and scoped permissions. */
export default async function deliveryEstimateRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!request.accountId) return reply.code(400).send({ error: 'Account context required' });
        if (!request.user?.id) return reply.code(401).send({ error: 'Authentication required' });
        const syncPath = /\/sync(?:\/inputs(?:\/[^/]+\/retry)?)?$/.test(request.routeOptions.url ?? '');
        const path = request.routeOptions.url ?? '';
        const recoveryPath = /\/(activation|readiness|receipts(?:\/.*)?)$/.test(path);
        if (!syncPath && !recoveryPath && !await isAccountFeatureEnabled(request.accountId, 'DELIVERY_ESTIMATES')) {
            return reply.code(403).send({ error: 'Delivery estimates disabled', code: 'FEATURE_DISABLED' });
        }
        const product = request.routeOptions.url?.includes('/products/');
        const permission = path.includes('/receipts') ? 'manage_inventory' : product
            ? (request.method === 'GET' ? 'view_products' : 'edit_products')
            : (request.method === 'GET' ? 'view_shipping' : 'manage_shipping_settings');
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, permission)) {
            return reply.code(403).send({ error: 'Permission denied' });
        }
        if (/\/(cutover|certification)$/.test(path) && !await PermissionService.hasPermission(request.user.id, request.accountId, 'manage_inventory')) return reply.code(403).send({ error: 'Inventory management permission required' });
    });
    fastify.setErrorHandler((error, request, reply) => {
        if (error instanceof DeliveryDiscoveryError) return reply.code(error.statusCode).send({ error: error.message, code: error.code });
        if (error instanceof DeliveryResourceNotFound) return reply.code(404).send({ error: error.message });
        if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
            return reply.code(error.statusCode).send({ error: error.message });
        }
        request.log.error({ err: error }, 'Delivery estimates request failed');
        return reply.code(500).send({ error: 'Unable to process delivery estimates' });
    });
    fastify.get('/shipping-methods', async (request, reply) => {
        if (!await PermissionService.hasPermission(request.user!.id, request.accountId!, 'manage_shipping_settings')) return reply.code(403).send({ error: 'Permission denied' });
        return discoverShippingMethods(request.accountId!);
    });
    fastify.get('/readiness', async request => deliveryReadiness(request.accountId!));
    fastify.post('/cutover', async (request, reply) => {
        const parsed = cutoverSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Confirm paused receiving, drained legacy jobs and restarted pre-upgrade workers.', issues: parsed.error.issues });
        return reply.code(202).send(await requestCutover(request.accountId!, request.user!.id));
    });
    fastify.post('/activation', async (request, reply) => {
        const parsed = activationSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Expected { active: boolean }' });
        return reply.code(202).send(await requestActivation(request.accountId!, parsed.data.active));
    });
    fastify.post('/certification', async (request, reply) => {
        const parsed = cutoverSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Confirm paused receiving, drained legacy jobs and restarted workers.' });
        return reply.code(202).send(await requestCutover(request.accountId!, request.user!.id, true));
    });
    fastify.get<{ Querystring: { cursor?: string } }>('/receipts', async request => listReceipts(request.accountId!, request.query.cursor));
    fastify.get<{ Querystring: { purchaseOrderId?: string; cursor?: string } }>('/receipts/cycles', async request => listReceiptCycles(request.accountId!, request.query.purchaseOrderId, request.query.cursor));
    fastify.post<{ Params: { operationId: string } }>('/receipts/:operationId/cascade/retry', async (request, reply) =>
        reply.code(202).send(await retryReceiptCascade(request.accountId!, request.params.operationId, request.user!.id)));
    fastify.get<{ Querystring: { cursor?: string } }>('/receipts/legacy', async request => listLegacyReceipts(request.accountId!, request.query.cursor));
    fastify.post<{ Params: { purchaseOrderId: string } }>('/receipts/legacy-reversals/:purchaseOrderId', async (request, reply) => {
        const parsed = legacyReviewSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Confirm paused receiving and restarted/drained legacy workers.' });
        return reply.code(202).send(await requestLegacyPoReversalReview(request.accountId!, request.params.purchaseOrderId, request.user!.id));
    });
    fastify.post<{ Params: { jobId: string } }>('/receipts/legacy/:jobId/observation', async (request, reply) => {
        const parsed = legacyReviewSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Confirm receiving is paused and legacy workers are restarted.', issues: parsed.error.issues });
        return observeLegacyReceipt(request.accountId!, request.params.jobId, request.user!.id);
    });
    fastify.post<{ Params: { jobId: string } }>('/receipts/legacy/:jobId/reconcile', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
        const parsed = legacyResolutionSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid legacy inventory attestation', issues: parsed.error.issues });
        return reply.code(202).send(await requestLegacyResolution(request.accountId!, request.params.jobId, request.user!.id, parsed.data));
    });
    fastify.post<{ Params: { operationId: string } }>('/receipts/:operationId/observation', async request => observeReceipt(request.accountId!, request.params.operationId));
    fastify.post<{ Params: { operationId: string } }>('/receipts/:operationId/reconcile', async (request, reply) => {
        const parsed = reconciliationSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid operator attestation', issues: parsed.error.issues });
        return reply.code(202).send(await requestReconciliation(request.accountId!, request.params.operationId, request.user!.id, parsed.data));
    });
    fastify.get('/sync', async request => deliverySyncStatus(request.accountId!));
    fastify.get('/sync/inputs', async (request, reply) => {
        const parsed = inputListQuery.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid delivery input query' });
        return listDeliveryInputs(request.accountId!, parsed.data);
    });
    fastify.post<{ Params: { id: string } }>('/sync/inputs/:id/retry', async (request, reply) =>
        reply.code(202).send(await retryDeliveryInput(request.accountId!, request.params.id)));
    fastify.post('/sync', async request => requestDeliverySync(request.accountId!));
    fastify.get('/settings', async request => ({
        settings: await DeliveryEstimateService.getSettings(request.accountId!), status: await deliveryLocalStatus(request.accountId!),
    }));
    fastify.put('/settings', { bodyLimit: 512 * 1024 }, async (request, reply) => {
        const parsed = settingsSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid settings', issues: parsed.error.issues });
        return { settings: await DeliveryEstimateService.saveSettings(request.accountId!, parsed.data), status: await deliveryLocalStatus(request.accountId!) };
    });
    fastify.get<{ Params: { id: string } }>('/products/:id', async request => ({
        product: await DeliveryEstimateService.getProduct(request.accountId!, request.params.id), status: await deliveryLocalStatus(request.accountId!),
    }));
    fastify.put<{ Params: { id: string } }>('/products/:id', { bodyLimit: 256 * 1024 }, async (request, reply) => {
        const parsed = productInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid production ranges', issues: parsed.error.issues });
        return { product: await DeliveryEstimateService.saveProduct(request.accountId!, request.params.id, parsed.data), status: await deliveryLocalStatus(request.accountId!) };
    });
}

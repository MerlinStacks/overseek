import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ membership: vi.fn(), feature: vi.fn(), permission: vi.fn(), get: vi.fn(), save: vi.fn(), discovery: vi.fn(), sync: vi.fn(), retry: vi.fn() }));
const launch = vi.hoisted(() => ({ readiness: vi.fn(), activation: vi.fn(), cutover: vi.fn(), receipts: vi.fn(), observe: vi.fn(), reconcile: vi.fn() }));
const legacy = vi.hoisted(() => ({ list: vi.fn(), observe: vi.fn(), reconcile: vi.fn() }));
const inventory = vi.hoisted(() => ({ cycles: vi.fn(), cascade: vi.fn(), reversal: vi.fn() }));
vi.mock('../services/deliveryEstimates/receiptCascade', () => ({ retryReceiptCascade: inventory.cascade }));
vi.mock('../services/deliveryEstimates/legacyRecovery', async original => ({ ...await original<typeof import('../services/deliveryEstimates/legacyRecovery')>(), listLegacyReceipts: legacy.list, observeLegacyReceipt: legacy.observe, requestLegacyResolution: legacy.reconcile, requestLegacyPoReversalReview: inventory.reversal }));
vi.mock('../services/deliveryEstimates/launch', async original => ({ ...await original<typeof import('../services/deliveryEstimates/launch')>(), deliveryLocalStatus: async () => ({ syncStatus: 'plugin_update_required', storefrontActivated: false }), deliveryReadiness: launch.readiness, requestActivation: launch.activation, requestCutover: launch.cutover }));
vi.mock('../services/deliveryEstimates/reconciliation', async original => ({ ...await original<typeof import('../services/deliveryEstimates/reconciliation')>(), listReceipts: launch.receipts, observeReceipt: launch.observe, requestReconciliation: launch.reconcile, listReceiptCycles: inventory.cycles }));
vi.mock('../services/deliveryEstimates/sync', () => ({ deliverySyncStatus: mocks.sync, requestDeliverySync: mocks.retry }));
vi.mock('../services/deliveryEstimates/discovery', async importOriginal => ({
    ...await importOriginal<typeof import('../services/deliveryEstimates/discovery')>(),
    discoverShippingMethods: mocks.discovery,
}));
vi.mock('../utils/auth', () => ({ verifyToken: () => ({ userId: 'u' }) }));
vi.mock('../utils/prisma', () => ({ prisma: {
    accountUser: { findUnique: mocks.membership }, accountFeature: { findUnique: mocks.feature },
    user: { findUnique: vi.fn().mockResolvedValue({ isSuperAdmin: false }) },
} }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: mocks.permission } }));
vi.mock('../services/deliveryEstimates/service', () => ({
    DeliveryEstimateService: { getSettings: mocks.get, saveSettings: mocks.save, getProduct: mocks.get, saveProduct: mocks.save },
    DeliveryResourceNotFound: class extends Error {},
    deliveryStatus: { syncStatus: 'plugin_update_required', storefrontActivated: false },
}));
import routes from './deliveryEstimates';
import { defaultSettings } from '../services/deliveryEstimates/validation';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { DeliveryDiscoveryError } from '../services/deliveryEstimates/discovery';

describe('delivery API authorization and contract', () => {
    const apps: ReturnType<typeof Fastify>[] = [];
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.membership.mockResolvedValue({ id: 'membership' });
        mocks.feature.mockResolvedValue(null);
        mocks.permission.mockResolvedValue(true);
        mocks.get.mockResolvedValue(defaultSettings());
        mocks.save.mockImplementation((_account, value) => value);
    });
    afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
    async function app() {
        const instance = Fastify(); apps.push(instance);
        await instance.register(routes, { prefix: '/api/delivery-estimates' });
        return instance;
    }
    const headers = { authorization: 'Bearer token', 'x-account-id': 'a' };
    it('keeps cascade retry, skipped-cycle audit and historical reversal review permission checked even with feature off', async () => {
        mocks.feature.mockResolvedValue({ isEnabled: false });
        inventory.cascade.mockResolvedValue({ accepted: true, operationId: 'op', cascadeState: 'pending' });
        inventory.cycles.mockResolvedValue({ cycles: [], nextCursor: null }); inventory.reversal.mockResolvedValue({ accepted: true, jobId: 'review' });
        const server = await app();
        const url = '/api/delivery-estimates/receipts/op/cascade/retry';
        mocks.permission.mockResolvedValue(false);
        expect((await server.inject({ method: 'POST', url, headers })).statusCode).toBe(403);
        expect(inventory.cascade).not.toHaveBeenCalled();
        mocks.permission.mockResolvedValue(true);
        expect((await server.inject({ method: 'POST', url, headers })).statusCode).toBe(202);
        expect(inventory.cascade).toHaveBeenCalledWith('a', 'op', 'u');
        expect((await server.inject({ url: '/api/delivery-estimates/receipts/cycles?purchaseOrderId=po', headers })).statusCode).toBe(200);
        expect(inventory.cycles).toHaveBeenCalledWith('a', 'po', undefined);
        expect((await server.inject({ method: 'POST', url: '/api/delivery-estimates/receipts/legacy-reversals/po', headers, payload: { receivingPaused: true, workersRestarted: true } })).statusCode).toBe(202);
        expect(inventory.reversal).toHaveBeenCalledWith('a', 'po', 'u');
    });
    it('allows permission-checked legacy recovery when the feature is off and binds audit actor', async () => {
        mocks.feature.mockResolvedValue({ isEnabled: false });
        legacy.list.mockResolvedValue({ jobs: [], nextCursor: null }); legacy.observe.mockResolvedValue({ observationToken: 'signed' }); legacy.reconcile.mockResolvedValue({ accepted: true });
        const server = await app(); const root = '/api/delivery-estimates/receipts/legacy';
        expect((await server.inject({ url: root, headers })).statusCode).toBe(200);
        expect((await server.inject({ method: 'POST', url: root + '/job/observation', headers, payload: { receivingPaused: true } })).statusCode).toBe(400);
        expect((await server.inject({ method: 'POST', url: root + '/job/observation', headers, payload: { receivingPaused: true, workersRestarted: true } })).statusCode).toBe(200);
        expect(legacy.observe).toHaveBeenCalledWith('a', 'job', 'u');
        const payload = { receivingPaused: true, workersRestarted: true, actionId: '90000000-0000-4000-8000-000000000002', reason: 'Inventory corrected and dependent work reviewed', observationToken: 'signed', correctedInventoryIncludesLegacyWork: true, acknowledgeUnobservableTargets: true };
        expect((await server.inject({ method: 'POST', url: root + '/job/reconcile', headers, payload: { ...payload, actorId: 'spoofed' } })).statusCode).toBe(400);
        expect((await server.inject({ method: 'POST', url: root + '/job/reconcile', headers, payload })).statusCode).toBe(202);
        expect(legacy.reconcile).toHaveBeenCalledWith('a', 'job', 'u', payload);
        mocks.permission.mockResolvedValue(false);
        expect((await server.inject({ url: root, headers })).statusCode).toBe(403);
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', 'manage_inventory');
    });
    it('permits explicit disable and readiness recovery while the feature is off', async () => {
        mocks.feature.mockResolvedValue({ isEnabled: false });
        launch.activation.mockResolvedValue({ accepted: true, revision: '1', desiredActive: false });
        launch.readiness.mockResolvedValue({ ready: false, blockers: ['feature_disabled'] });
        const server = await app();
        expect((await server.inject({ method: 'POST', url: '/api/delivery-estimates/activation', headers, payload: { active: false } })).statusCode).toBe(202);
        expect(launch.activation).toHaveBeenCalledWith('a', false);
        expect((await server.inject({ url: '/api/delivery-estimates/readiness', headers })).json().ready).toBe(false);
    });
    it('requires both shipping and inventory authority plus all cutover confirmations', async () => {
        const server = await app(); const url = '/api/delivery-estimates/cutover';
        expect((await server.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(400);
        mocks.permission.mockImplementation(async (_u, _a, p) => p !== 'manage_inventory');
        const payload = { receivingPaused: true, legacyJobsDrained: true, preupgradeWorkersRestarted: true };
        expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403);
        expect(launch.cutover).not.toHaveBeenCalled();
        mocks.permission.mockResolvedValue(true); launch.cutover.mockResolvedValue({ accepted: true, revision: '1', epoch: 'epoch' });
        expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(202);
        expect(launch.cutover).toHaveBeenCalledWith('a', 'u');
    });
    it('uses authenticated audit authority and rejects client actor spoofing', async () => {
        const server = await app(); const url = '/api/delivery-estimates/receipts/op/reconcile';
        const payload = { actionId: '90000000-0000-4000-8000-000000000001', observationToken: 'signed', observedStockQuantity: 4, reason: 'Corrected count includes operation', correctedCountIncludesOperation: true };
        expect((await server.inject({ method: 'POST', url, headers, payload: { ...payload, actorId: 'spoofed' } })).statusCode).toBe(400);
        launch.reconcile.mockResolvedValue({ accepted: true });
        expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(202);
        expect(launch.reconcile).toHaveBeenCalledWith('a', 'op', 'u', payload);
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', 'manage_inventory');
    });
    it.each(['GET', 'POST'] as const)('allows disabled %s sync only with membership and normal permissions', async method => {
        mocks.feature.mockResolvedValue({ isEnabled: false });
        const envelope = { status: { configurationSync: 'pending', storefrontActivated: false, pendingCount: 1, syncedCount: 0, lastAcknowledgedAt: null, lastError: null } };
        mocks.sync.mockResolvedValue(envelope); mocks.retry.mockResolvedValue(envelope);
        const server = await app();
        const url = '/api/delivery-estimates/sync';
        expect((await server.inject({ method, url, headers })).json()).toEqual(envelope);
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', method === 'GET' ? 'view_shipping' : 'manage_shipping_settings');
        expect(method === 'GET' ? mocks.sync : mocks.retry).toHaveBeenCalledWith('a');
        mocks.permission.mockResolvedValue(false);
        expect((await server.inject({ method, url, headers })).statusCode).toBe(403);
        mocks.membership.mockResolvedValue(null);
        expect((await server.inject({ method, url, headers })).statusCode).toBe(403);
        expect((await server.inject({ method, url })).statusCode).toBe(401);
    });
    it('returns discovery for the authenticated tenant with no-store', async () => {
        const result = { status: 'available', timezone: 'UTC', methods: [], warnings: [] };
        mocks.discovery.mockResolvedValue(result);
        const response = await (await app()).inject({ url: '/api/delivery-estimates/shipping-methods', headers });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(result);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(mocks.discovery).toHaveBeenCalledExactlyOnceWith('a');
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', 'view_shipping');
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', 'manage_shipping_settings');
    });
    it('keeps actual option observations private from read-only shipping users', async () => {
        mocks.permission.mockImplementation(async (_user, _account, permission) => permission === 'view_shipping');
        const response = await (await app()).inject({ url: '/api/delivery-estimates/shipping-methods', headers });
        expect(response.statusCode).toBe(403);
        expect(mocks.discovery).not.toHaveBeenCalled();
    });
    it('requires discovery authentication, account membership and feature', async () => {
        const server = await app();
        const url = '/api/delivery-estimates/shipping-methods';
        expect((await server.inject({ url })).statusCode).toBe(401);
        expect((await server.inject({ url, headers: { authorization: 'Bearer token' } })).statusCode).toBe(400);
        mocks.membership.mockResolvedValue(null);
        expect((await server.inject({ url, headers })).statusCode).toBe(403);
        mocks.membership.mockResolvedValue({ id: 'membership' });
        mocks.feature.mockResolvedValue({ isEnabled: false });
        expect((await server.inject({ url, headers })).json().code).toBe('FEATURE_DISABLED');
        expect(mocks.discovery).not.toHaveBeenCalled();
    });
    it.each([502, 503] as const)('returns sanitized discovery %s errors', async status => {
        mocks.discovery.mockRejectedValue(new DeliveryDiscoveryError(status, 'DELIVERY_DISCOVERY_UNAVAILABLE', 'Shipping discovery is unavailable.'));
        const response = await (await app()).inject({ url: '/api/delivery-estimates/shipping-methods', headers });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({ code: 'DELIVERY_DISCOVERY_UNAVAILABLE', error: 'Shipping discovery is unavailable.' });
    });
    it('returns unsupported discovery without changing settings readiness', async () => {
        const result = { status: 'plugin_update_required', methods: [], warnings: ['Update plugin'] };
        mocks.discovery.mockResolvedValue(result);
        const server = await app();
        expect((await server.inject({ url: '/api/delivery-estimates/shipping-methods', headers })).json()).toEqual(result);
        expect((await server.inject({ url: '/api/delivery-estimates/settings', headers })).json().status)
            .toEqual({ syncStatus: 'plugin_update_required', storefrontActivated: false });
    });
    it('defaults on only for DELIVERY_ESTIMATES and respects explicit false', async () => {
        expect(await isAccountFeatureEnabled('a', 'DELIVERY_ESTIMATES')).toBe(true);
        expect(await isAccountFeatureEnabled('a', 'OTHER')).toBe(false);
        mocks.feature.mockResolvedValue({ isEnabled: false });
        expect(await isAccountFeatureEnabled('a', 'DELIVERY_ESTIMATES')).toBe(false);
    });
    it('returns local-only readiness with the authenticated account', async () => {
        const response = await (await app()).inject({ url: '/api/delivery-estimates/settings', headers });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ settings: defaultSettings(), status: { syncStatus: 'plugin_update_required', storefrontActivated: false } });
        expect(mocks.get).toHaveBeenCalledWith('a');
    });
    it('requires authentication, account context and membership', async () => {
        const server = await app();
        expect((await server.inject({ url: '/api/delivery-estimates/settings' })).statusCode).toBe(401);
        expect((await server.inject({ url: '/api/delivery-estimates/settings', headers: { authorization: 'Bearer token' } })).statusCode).toBe(400);
        mocks.membership.mockResolvedValue(null);
        expect((await server.inject({ url: '/api/delivery-estimates/settings', headers })).statusCode).toBe(403);
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it.each(['GET', 'PUT'] as const)('enforces feature disable for %s on both resources', async method => {
        mocks.feature.mockResolvedValue({ isEnabled: false });
        const server = await app();
        for (const path of ['settings', 'products/p']) {
            const response = await server.inject({ method, url: `/api/delivery-estimates/${path}`, headers, ...(method === 'PUT' ? { payload: {} } : {}) });
            expect(response.statusCode).toBe(403);
            expect(response.json().code).toBe('FEATURE_DISABLED');
        }
        expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    });
    it.each([
        ['GET', 'settings', 'view_shipping'], ['PUT', 'settings', 'manage_shipping_settings'],
        ['GET', 'shipping-methods', 'view_shipping'],
        ['GET', 'products/p', 'view_products'], ['PUT', 'products/p', 'edit_products'],
    ] as const)('checks %s %s permission', async (method, path, permission) => {
        mocks.permission.mockResolvedValue(false);
        const response = await (await app()).inject({ method, url: `/api/delivery-estimates/${path}`, headers, ...(method === 'PUT' ? { payload: {} } : {}) });
        expect(response.statusCode).toBe(403);
        expect(mocks.permission).toHaveBeenCalledWith('u', 'a', permission);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.discovery).not.toHaveBeenCalled();
    });
    it('rejects malformed product ranges and persists valid settings locally', async () => {
        const server = await app();
        expect((await server.inject({ method: 'PUT', url: '/api/delivery-estimates/products/p', headers,
            payload: { productionMinDays: 0, productionMaxDays: null } })).statusCode).toBe(400);
        expect(mocks.save).not.toHaveBeenCalled();
        const response = await server.inject({ method: 'PUT', url: '/api/delivery-estimates/settings', headers, payload: defaultSettings() });
        expect(response.statusCode).toBe(200);
        expect(mocks.save).toHaveBeenCalledWith('a', defaultSettings());
    });
    it('passes product and variation ranges to the local service with account context', async () => {
        const payload = { productionMinDays: 0, productionMaxDays: 1,
            variations: [{ id: 'v', productionMinDays: null, productionMaxDays: null }] };
        const response = await (await app()).inject({ method: 'PUT', url: '/api/delivery-estimates/products/p', headers, payload });
        expect(response.statusCode).toBe(200);
        expect(mocks.save).toHaveBeenCalledWith('a', 'p', payload);
        expect(response.json().status.storefrontActivated).toBe(false);
    });
});

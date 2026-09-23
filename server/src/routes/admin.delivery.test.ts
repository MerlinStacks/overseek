import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), rootUpsert: vi.fn(), lock: vi.fn(), intent: vi.fn(), control: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction, accountFeature: { upsert: mocks.rootUpsert } } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async () => {}, requireSuperAdminFastify: async () => {} }));
vi.mock('../utils/auth', () => ({ generateToken: vi.fn() }));
vi.mock('./admin/webhooks', () => ({ webhookAdminRoutes: async () => {} }));
vi.mock('./admin/platformCredentials', () => ({ platformCredentialsRoutes: async () => {} }));
vi.mock('./admin/platformSettings', () => ({ platformSettingsRoutes: async () => {} }));
vi.mock('./admin/geoip', () => ({ geoipRoutes: async () => {} }));
vi.mock('./admin/diagnostics', () => ({ diagnosticsRoutes: async () => {} }));
vi.mock('./admin/backup', () => ({ backupRoutes: async () => {} }));
import adminRoutes from './admin';

describe('admin delivery feature transaction', () => {
    beforeEach(() => vi.clearAllMocks());
    it('does not let an invalid historical configuration draft veto feature-off control', async () => {
        const tx = { $queryRaw: mocks.lock,
            accountFeature: { upsert: async () => ({ isEnabled: false }), findUnique: async () => ({ isEnabled: false }) },
            account: { findUniqueOrThrow: async () => ({ timezone: 'UTC' }) },
            deliveryEstimateSettings: { findUnique: async () => ({ settings: { invalidHistoricalDraft: true } }) },
            receiptAccount: { upsert: mocks.control }, deliveryInputSync: { upsert: mocks.intent },
        };
        mocks.transaction.mockImplementation(callback => callback(tx));
        const server = Fastify(); await server.register(adminRoutes);
        try {
            const response = await server.inject({ method: 'POST', url: '/accounts/a/toggle-feature', payload: { featureKey: 'DELIVERY_ESTIMATES', isEnabled: false } });
            expect(response.statusCode).toBe(200); expect(response.json().isEnabled).toBe(false);
            expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ desiredActive: false, controlAction: 'disable' }) }));
            expect(mocks.intent).not.toHaveBeenCalled();
        } finally { await server.close(); }
    });
    it.each(['unknown', 'blocked', 'plugin_update_required', 'failed_build'])('queues independent disable with %s configuration state and preserves active leases', async configurationState => {
        let enabled = true;
        const upsert = vi.fn(async ({ update }) => { enabled = update.isEnabled; return { isEnabled: enabled }; });
        const tx = {
            $queryRaw: mocks.lock,
            accountFeature: { upsert, findUnique: async () => ({ isEnabled: enabled }) },
            account: { findUniqueOrThrow: async () => ({ timezone: 'UTC' }) },
            deliveryEstimateSettings: { findUnique: async () => null },
            deliveryInputSync: { upsert: mocks.intent },
            deliverySyncAccount: { upsert: async () => ({ capabilityStatus: configurationState === 'failed_build' ? 'supported' : configurationState,
                resyncRequested: configurationState === 'failed_build', buildFailed: configurationState === 'failed_build', resyncGeneration: 0 }) },
            receiptAccount: { upsert: mocks.control },
        };
        mocks.transaction.mockImplementation(callback => callback(tx));
        const server = Fastify();
        await server.register(adminRoutes);
        try {
            const response = await server.inject({ method: 'POST', url: '/accounts/a/toggle-feature', payload: { featureKey: 'DELIVERY_ESTIMATES', isEnabled: false } });
            expect(response.statusCode).toBe(200);
            expect(mocks.rootUpsert).not.toHaveBeenCalled();
            expect(mocks.intent).toHaveBeenCalledWith(expect.objectContaining({
                create: expect.objectContaining({ accountId: 'a', scope: 'settings', entityId: 0, priority: 0, payload: expect.objectContaining({ enabled: false }) }),
                update: expect.objectContaining({ desiredRevision: { increment: 1 }, status: ['blocked', 'plugin_update_required'].includes(configurationState) ? configurationState : 'pending', priority: 0 }),
            }));
            expect(mocks.intent.mock.calls[0][0].update).not.toHaveProperty('leaseToken');
            expect(mocks.intent.mock.calls[0][0].update).not.toHaveProperty('leaseExpiresAt');
            expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(upsert.mock.invocationCallOrder[0]);
            expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({
                where: { accountId: 'a' },
                create: expect.objectContaining({ desiredActive: false, controlAction: 'disable', controlRevision: 1 }),
                update: expect.objectContaining({ desiredActive: false, revalidationRequested: false, controlAction: 'disable', controlRevision: { increment: 1 }, controlAttempts: 0 }),
            }));
            const controlUpdate = mocks.control.mock.calls[0][0].update;
            expect(controlUpdate).not.toHaveProperty('controlLeaseToken');
            expect(controlUpdate).not.toHaveProperty('controlLeaseExpiresAt');
            expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.control.mock.invocationCallOrder[0]);
            expect(mocks.control.mock.invocationCallOrder[0]).toBeLessThan(mocks.intent.mock.invocationCallOrder[0]);
        } finally { await server.close(); }
    });
});

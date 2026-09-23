import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ control: {} as any, account: {} as any, input: {} as any, unresolved: 0, legacy: 0, configuredCount: 1, page: null as any, feature: true, plugin: {} as any, prerequisite: { ready: true }, inventory: { ready: true, blockedCount: 0, targets: [] as { productWooId: number; variationWooId: number | null; reason: string }[] },
    transport: vi.fn(), dirty: vi.fn(), upsertOwner: vi.fn(), upsertAccount: vi.fn(), materialize: vi.fn(), proofs: [{ total: 1n, eligible: 1n, stale: 0n, unverified: 0n, excluded: 0n, excludedProductWooIds: [] as number[] }], owners: [] as any[], operation: null as any }));
vi.mock('./freshnessPrerequisite', () => ({ checkFreshnessPrerequisite: async () => m.prerequisite }));
vi.mock('./inventoryCompatibility', () => ({ checkInventoryCompatibility: async () => m.inventory }));
vi.mock('./bomStockTransport', () => ({ materializeLegacyBomReviews: m.materialize }));
vi.mock('./cutoverBatch', async original => ({ ...await original<typeof import('./cutoverBatch')>(),
    buildCutoverBatch: async (_tx: unknown, _account: string, revision: bigint, epoch: string, cursor: string | null, progress: any) => ({
        schemaVersion: 1, revision: Number(revision), epoch, action: m.page || !progress.baselineEstablished ? 'baseline' : 'guarded',
        owners: m.page ? [10] : [], cursor: m.page?.id ?? cursor ?? null,
        ...(m.page || !progress.baselineEstablished ? { page: { version: 1, after: cursor ?? null, productIds: m.page ? [m.page.id] : [], sourceHash: 'hash', productCount: m.page ? 1 : 0, ownerCount: m.page ? 1 : 0 } } : {}),
    }), cutoverBatchStillCurrent: async () => true,
}));
vi.mock('../../utils/prisma', () => {
    const update = (data: any) => { for (const [k, v] of Object.entries(data)) m.control[k] = v && typeof v === 'object' && 'increment' in v ? (typeof m.control[k] === 'bigint' ? m.control[k] + BigInt((v as any).increment) : (m.control[k] ?? 0) + (v as any).increment) : v; return { ...m.control }; };
    const db: any = {
        account: { findUniqueOrThrow: async () => m.account, update: async ({ data }: any) => Object.assign(m.account, data) },
        receiptAccount: { findUnique: async () => m.control, upsert: async (args: any) => { m.upsertAccount(args); return update(args.update ?? {}); },
            update: async ({ data }: any) => update(data), findFirst: async ({ where }: any) =>
                (where.controlRevision === undefined || where.controlRevision === m.control.controlRevision) &&
                (where.controlLeaseToken === undefined || where.controlLeaseToken === m.control.controlLeaseToken) ? m.control : null,
            findMany: async () => m.control.controlAction ? [{ ...m.control }] : [],
            updateMany: async ({ where, data }: any) => { if (where.controlRevision !== undefined && where.controlRevision !== m.control.controlRevision) return { count: 0 }; if (where.controlLeaseToken !== undefined && where.controlLeaseToken !== m.control.controlLeaseToken) return { count: 0 }; update(data); return { count: 1 }; } },
        receiptLegacyWork: { count: async () => m.legacy }, receiptOperation: { count: async () => m.unresolved, findUnique: async () => m.operation },
        receiptOwner: { upsert: m.upsertOwner, createMany: m.upsertOwner, updateMany: async () => ({ count: 1 }), findMany: async () => m.owners },
        deliveryInputSync: { findUnique: async () => m.input, count: async () => 0 }, deliverySyncAccount: { findUnique: async () => ({}) },
        wooProduct: { count: async () => m.configuredCount, findFirst: async () => m.page }, $queryRaw: async () => m.proofs, $executeRawUnsafe: vi.fn(),
    };
    db.$transaction = (fn: any) => fn(db);
    return { prisma: db };
});
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ deliveryControl: m.transport }) } }));
vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: async () => m.feature }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInbound: m.dirty, configuredInboundProducts: {} }));
vi.mock('./inbound', () => ({ buildInbound: async () => ({ targets: [{ state: 'pending', stockOwnerWooId: 10 }] }) }));
import { defaultSettings } from './validation';
import { deliveryLocalStatus, deliveryReadiness, dispatchDeliveryControl, requestActivation, requestCutover } from './launch';
import { attachReceiptProof } from './receiptProof';
import { prisma } from '../../utils/prisma';
import { queueDeliveryDisable } from './controlIntents';
const drainDeliveryControls = async () => { if (m.control.controlAction) await dispatchDeliveryControl(structuredClone(m.control)); };

beforeEach(() => {
    vi.clearAllMocks(); m.feature = true; m.unresolved = 0; m.legacy = 0; m.page = null; m.owners = []; m.operation = null; m.configuredCount = 1; m.prerequisite = { ready: true };
    m.materialize.mockResolvedValue(0);
    m.inventory = { ready: true, blockedCount: 0, targets: [] };
    m.control = { accountId: 'a', controlRevision: 0n, controlAckRevision: 0n, cutoverState: 'legacy', cutoverEpoch: null, receivingFrozen: false, active: false, desiredActive: false, controlAttempts: 0, controlPayload: null, controlAction: null };
    m.account = { receiptTransportMode: 'LEGACY' };
    m.input = { status: 'synced', ackRevision: 1n, desiredRevision: 1n, payload: { enabled: true, settings: defaultSettings('UTC') } };
    m.proofs = [{ total: 1n, eligible: 1n, stale: 0n, unverified: 0n, excluded: 0n, excludedProductWooIds: [] }];
    m.plugin = { schemaVersion: 1, protocolVersion: 1, blockers: [], wooVersion: '10.6.2', presentation: 'classic', environmentFingerprint: 'a'.repeat(64), state: { revision: 0, mode: 'legacy', epoch: null, active: false } };
    m.transport.mockImplementation(async input => input ? { schemaVersion: 1, revision: input.revision, state: { active: input.action === 'activate', epoch: input.epoch, mode: input.action === 'baseline' ? 'baseline' : 'guarded' } } : m.plugin);
});

function readyStore() {
    Object.assign(m.control, { cutoverState: 'guarded', cutoverEpoch: 'epoch' });
    m.account.receiptTransportMode = 'GUARDED'; m.plugin.state.epoch = 'epoch'; m.plugin.state.mode = 'guarded';
    m.input.payload.settings.shippingMethods = [{ methodId: 'flat_rate', instanceId: 7, zoneId: 0, zoneName: 'Rest', title: 'Shipping', enabled: true, minTransitDays: 1, maxTransitDays: 2, fulfilmentType: 'delivery' }];
}

describe('launch readiness eligibility', () => {
    it('warns with explicit unsupported product IDs without blocking an eligible verified product', async () => {
        readyStore(); m.configuredCount = 2;
        m.proofs = [{ total: 2n, eligible: 1n, stale: 0n, unverified: 0n, excluded: 1n, excludedProductWooIds: [22] }];
        const result = await deliveryReadiness('a');
        expect(result.ready).toBe(true);
        expect(result.excludedProductWooIds).toEqual([22]); expect(result.eligibleConfiguredCount).toBe(1);
        expect(result.warnings).toContain('configured_products_excluded_unsupported_or_BOM');
        await expect(requestActivation('a', true)).resolves.toMatchObject({ desiredActive: true });
    });
    it('does not certify an all-excluded catalogue or hide an eligible uncertified owner behind an exclusion', async () => {
        readyStore(); m.proofs = [{ total: 1n, eligible: 0n, stale: 0n, unverified: 0n, excluded: 1n, excludedProductWooIds: [22] }];
        expect((await deliveryReadiness('a')).blockers).toContain('no_eligible_configured_products');
        m.configuredCount = 2; m.proofs[0] = { total: 2n, eligible: 1n, stale: 0n, unverified: 1n, excluded: 1n, excludedProductWooIds: [22] };
        const result = await deliveryReadiness('a');
        expect(result.ready).toBe(false); expect(result.blockers).toContain('inbound_unverified');
    });
    it.each(['exact_rate', 'all_provider_rates'] as const)('accepts sole core %s mapping and its exact configured default', async kind => {
        readyStore();
        const identity = { methodId: 'flat_rate', instanceId: 7, mappingKind: kind, ...(kind === 'exact_rate' ? { rateId: 'flat_rate:7:actual-option' } : {}) };
        Object.assign(m.input.payload.settings.shippingMethods[0], identity, kind === 'all_provider_rates' ? { allRatesConfirmed: true } : {});
        m.input.payload.settings.defaultMethod = identity;
        expect((await deliveryReadiness('a')).ready).toBe(true);
        m.input.payload.settings.shippingMethods[0].methodId = 'unknown_carrier';
        m.input.payload.settings.defaultMethod.methodId = 'unknown_carrier';
        expect((await deliveryReadiness('a')).blockers).toContain('no_supported_enabled_shipping_mapping');
    });
    it('blocks both activation request and dispatch when exact SQL freshness prerequisites are absent', async () => {
        readyStore(); m.prerequisite = { ready: false };
        const result = await deliveryReadiness('a');
        expect(result.freshnessPrerequisite.ready).toBe(false);
        expect(result.blockers).toContain('freshness_sql_prerequisite_missing');
        await expect(requestActivation('a', true)).rejects.toThrow('freshness_sql_prerequisite_missing');
        Object.assign(m.control, { controlAction: 'activate', controlRevision: 1n, desiredActive: true });
        await drainDeliveryControls();
        expect(m.transport.mock.calls.filter(call => call[0]?.action === 'activate')).toHaveLength(0);
    });
});

describe('durable launch control', () => {
    it.each([false, true])('missing SQL refuses cutover/certification (certify=%s) before any freeze or new work', async certify => {
        if (certify) readyStore();
        const control = structuredClone(m.control); const account = structuredClone(m.account);
        m.prerequisite = { ready: false };
        await expect(requestCutover('a', 'manager', certify)).rejects.toThrow('freshness_sql_prerequisite_missing');
        expect(m.control).toEqual(control); expect(m.account).toEqual(account);
        expect(m.upsertAccount).not.toHaveBeenCalled(); expect(m.materialize).not.toHaveBeenCalled();
        expect(m.transport).not.toHaveBeenCalled();
    });
    it('diagnoses missing SQL even for an already-guarded idempotent cutover request', async () => {
        readyStore(); m.prerequisite = { ready: false };
        await expect(requestCutover('a', 'manager')).rejects.toThrow('schema push alone is insufficient');
        expect(m.control.receivingFrozen).toBe(false); expect(m.account.receiptTransportMode).toBe('GUARDED');
        expect(m.upsertAccount).not.toHaveBeenCalled();
        m.prerequisite = { ready: true };
        await expect(requestCutover('a', 'manager')).resolves.toMatchObject({ accepted: true, epoch: 'epoch' });
        expect(m.control.controlAction).toBeNull(); expect(m.materialize).not.toHaveBeenCalled();
    });
    it('fails closed visibly when an older pending cutover encounters missing SQL', async () => {
        await requestCutover('a', 'manager'); m.control.controlPayload = null;
        m.prerequisite = { ready: false };
        await drainDeliveryControls();
        expect(m.account.receiptTransportMode).toBe('LEGACY');
        expect(m.control).toMatchObject({ cutoverState: 'baseline', receivingFrozen: true, controlAckRevision: 0n, controlAction: 'cutover' });
        expect(m.control.controlError).toContain('freshness_sql_prerequisite_missing');
        expect(m.transport).not.toHaveBeenCalled(); expect(m.dirty).not.toHaveBeenCalled();
    });
    it('rechecks SQL on the final transaction connection after the plugin guarded ACK', async () => {
        await requestCutover('a', 'manager'); m.control.controlPayload = null; m.control.controlCursor = 'last-product';
        m.transport.mockImplementation(async command => {
            if (!command) return m.plugin;
            expect(command.action).toBe('guarded');
            m.prerequisite = { ready: false }; // Schema damaged while the handshake was in flight.
            return { schemaVersion: 1, revision: command.revision, state: { active: false, epoch: command.epoch, mode: 'guarded' } };
        });
        await drainDeliveryControls();
        expect(m.account.receiptTransportMode).toBe('LEGACY');
        expect(m.control).toMatchObject({ receivingFrozen: true, cutoverState: 'baseline', controlAckRevision: 0n });
        expect(m.control.controlError).toContain('freshness_sql_prerequisite_missing');
        expect(m.dirty).not.toHaveBeenCalled();
    });
    it('still delivers explicit disable when SQL prerequisites and feature availability are off', async () => {
        readyStore(); m.prerequisite = { ready: false }; m.feature = false;
        await requestActivation('a', false); m.control.controlPayload = null;
        await drainDeliveryControls();
        expect(m.control).toMatchObject({ active: false, desiredActive: false, controlAction: null });
        expect(m.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'disable' }), expect.any(Number));
    });
    it('prepares baseline and guarded mode with the old display active, but keeps readiness and activation blocked', async () => {
        const blocker = 'deactivate_old_delivery_plugin:pi-edd/pi-edd.php';
        m.plugin.blockers = [blocker];
        await requestCutover('a', 'manager'); m.control.controlPayload = null;
        m.page = { id: 'product-1', wooId: 10 };
        await drainDeliveryControls();
        expect(m.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'baseline' }), expect.any(Number));
        expect(m.control.active).toBe(false);
        m.page = null; m.control.controlPayload = null;
        await drainDeliveryControls();
        expect(m.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'guarded' }), expect.any(Number));
        expect(m.control).toMatchObject({ cutoverState: 'guarded', active: false, receivingFrozen: false });
        readyStore();
        expect((await deliveryReadiness('a')).blockers).toContain(blocker);
        await expect(requestActivation('a', true)).rejects.toThrow(blocker);
        Object.assign(m.control, { controlAction: 'activate', controlPayload: null, desiredActive: true, controlNextAttemptAt: new Date(0) });
        await drainDeliveryControls();
        expect(m.transport.mock.calls.some(call => call[0]?.action === 'activate')).toBe(false);
        m.plugin.blockers = [];
        await requestActivation('a', true); m.control.controlPayload = null;
        await drainDeliveryControls();
        expect(m.control.active).toBe(true);
    });
    it.each(['woocommerce_native_stock_management_required', 'guarded_receipts_native_stock_store_required', 'blocks_woocommerce_9_9_required'])('never waives %s during cutover coexistence', async blocker => {
        m.plugin.blockers = ['deactivate_old_delivery_plugin:pi-edd/pi-edd.php', blocker];
        await requestCutover('a', 'manager'); m.control.controlPayload = null;
        await drainDeliveryControls();
        expect(m.transport.mock.calls.some(call => call[0])).toBe(false);
        expect(m.control.controlError).toBe(blocker);
        expect(m.control.active).toBe(false); expect(m.account.receiptTransportMode).toBe('LEGACY');
    });
    it('refuses inventory-incompatible cutover before freezing or changing mode', async () => {
        m.inventory = { ready: false, blockedCount: 1, targets: [{ productWooId: 42, variationWooId: null, reason: 'unsupported_native_stock_type' }] };
        expect((await deliveryReadiness('a')).blockers).toContain('inventory_compatibility_required');
        await expect(requestCutover('a', 'manager')).rejects.toThrow('42: unsupported_native_stock_type');
        expect(m.control.receivingFrozen).toBe(false); expect(m.account.receiptTransportMode).toBe('LEGACY');
    });
    it('rechecks inventory compatibility before final guarded handshake and makes recovery explicit', async () => {
        await requestCutover('a', 'manager'); m.control.controlPayload = null; m.control.controlCursor = 'last-product';
        m.inventory = { ready: false, blockedCount: 1, targets: [{ productWooId: 42, variationWooId: null, reason: 'unsupported_native_stock_type' }] };
        await drainDeliveryControls();
        expect(m.account.receiptTransportMode).toBe('LEGACY');
        expect(m.control).toMatchObject({ receivingFrozen: true, controlAttempts: 8, controlCursor: null });
        expect(m.transport.mock.calls.some(call => call[0]?.action === 'guarded')).toBe(false);
    });
    it('fences an in-flight activation ACK after admin feature-off and delivers disable independently', async () => {
        readyStore(); Object.assign(m.control, { active: true, desiredActive: true, controlAction: 'activate', controlRevision: 1n });
        m.transport.mockImplementation(async command => {
            if (!command) return m.plugin;
            if (command.action === 'activate') {
                m.feature = false; // Same Account-locked admin transaction queues this intent.
                await queueDeliveryDisable(prisma as any, 'a');
            }
            return { schemaVersion: 1, revision: command.revision, state: { active: command.action === 'activate', epoch: command.epoch, mode: 'guarded' } };
        });
        await drainDeliveryControls();
        expect(m.control).toMatchObject({ desiredActive: false, controlRevision: 2n, controlAction: 'disable', controlAckRevision: 0n });
        m.control.controlPayload = null; // SQL NULL representation in this model.
        m.plugin = {}; // No capability/discovery success is required to deliver disable.
        await drainDeliveryControls();
        expect(m.control).toMatchObject({ active: false, desiredActive: false, controlAckRevision: 2n, controlAction: null });
        expect(m.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'disable', revision: 2 }), expect.any(Number));
    });
    it('automatically reactivates desired activation after settings sync without burning waiting retries', async () => {
        Object.assign(m.control, { cutoverState: 'guarded', cutoverEpoch: 'epoch', desiredActive: true, active: true, revalidationRequested: true, controlAction: 'activate', controlRevision: 2n });
        m.account.receiptTransportMode = 'GUARDED'; m.plugin.state.epoch = 'epoch'; m.plugin.state.mode = 'guarded';
        m.input.payload.settings.shippingMethods = [{ methodId: 'flat_rate', instanceId: 7, zoneId: 0, zoneName: 'Rest', title: 'Shipping', enabled: true, minTransitDays: 1, maxTransitDays: 2, fulfilmentType: 'delivery' }];
        m.input.status = 'pending'; m.input.desiredRevision = 2n;
        await drainDeliveryControls();
        expect(m.transport).not.toHaveBeenCalled(); expect(m.control.controlAttempts).toBe(0);
        expect(m.control.desiredActive).toBe(true);
        m.input.status = 'synced'; m.input.ackRevision = 2n;
        await drainDeliveryControls();
        expect(m.transport).toHaveBeenCalledWith(expect.objectContaining({ action: 'activate', settingsRevision: 2 }), expect.any(Number));
        expect(m.control).toMatchObject({ desiredActive: true, active: true, revalidationRequested: false, controlAction: null });
    });
    it('explicit disable supersedes queued automatic revalidation, even with old discovery metadata', async () => {
        Object.assign(m.control, { cutoverState: 'guarded', desiredActive: true, revalidationRequested: true, controlAction: 'activate', controlRevision: 2n });
        await requestActivation('a', false); m.control.controlPayload = null;
        m.plugin = {};
        await drainDeliveryControls();
        expect(m.transport.mock.calls.every(call => call[0]?.action === 'disable')).toBe(true);
        expect(m.control).toMatchObject({ desiredActive: false, active: false, revalidationRequested: false });
    });
    it('reports persisted activation rather than a constant dormant draft status', async () => {
        expect(await deliveryLocalStatus('a')).toEqual({ syncStatus: 'not_requested', storefrontActivated: false });
        m.control.active = true;
        expect((await deliveryLocalStatus('a')).storefrontActivated).toBe(true);
        expect(m.transport).not.toHaveBeenCalled();
    });
    it('does not infer readiness from an HTTP-successful legacy plugin', async () => {
        expect((await deliveryReadiness('a')).blockers).toContain('cutover_required');
        m.plugin = { schemaVersion: 1 }; expect((await deliveryReadiness('a')).blockers).toContain('plugin_control_unavailable_or_upgrade_required');
    });
    it('refuses tracked legacy and unresolved guarded work', async () => {
        m.legacy = 1; await expect(requestCutover('a', 'manager')).rejects.toThrow('Drain tracked');
        m.legacy = 0; m.unresolved = 1; await expect(requestCutover('a', 'manager')).rejects.toThrow('Drain tracked');
        expect(m.control.receivingFrozen).toBe(true);
        expect(m.control.cutoverState).toBe('legacy_review');
    });
    it('exposes an explicit normal-UI resume action when legacy review is complete', async () => {
        Object.assign(m.control, { receivingFrozen: true, cutoverState: 'legacy_review' });
        m.legacy = 1;
        expect((await deliveryReadiness('a')).actions.resumeCutover).toBeNull();
        m.legacy = 0;
        expect((await deliveryReadiness('a')).actions.resumeCutover).toBe('/api/delivery-estimates/cutover');
    });
    it('freezes receiving, records restart authority and keeps LEGACY until final ACK', async () => {
        await requestCutover('a', 'manager');
        expect(m.transport).not.toHaveBeenCalled();
        expect(m.control).toMatchObject({ receivingFrozen: true, workersRestartedBy: 'manager', cutoverState: 'baseline' });
        expect(m.account.receiptTransportMode).toBe('LEGACY');
        m.control.controlPayload = null; // Prisma DbNull is stored as SQL NULL.
        await drainDeliveryControls(); // explicit empty baseline
        expect(m.account.receiptTransportMode).toBe('LEGACY');
        m.control.controlPayload = null;
        await drainDeliveryControls();
        expect(m.account.receiptTransportMode).toBe('GUARDED');
        expect(m.control.receivingFrozen).toBe(false); expect(m.dirty).toHaveBeenCalledWith(expect.anything(), 'a');
    });
    it('disable queues while feature is off; activate cannot bypass readiness', async () => {
        m.feature = false; await requestActivation('a', false);
        expect(m.control.controlAction).toBe('disable');
        await expect(requestActivation('a', true)).rejects.toThrow('feature_disabled');
    });
    it('persists identical command before transport and replays a lost ACK without changing owners', async () => {
        await requestCutover('a', 'manager'); m.control.controlPayload = null; m.page = { id: 'product-1', wooId: 10 };
        m.transport.mockImplementation(async input => { if (input) throw new Error('lost ACK'); return m.plugin; });
        await drainDeliveryControls();
        const command = structuredClone(m.control.controlPayload);
        expect(command).toMatchObject({ action: 'baseline', owners: [10], cursor: 'product-1' });
        m.page = { id: 'changed-product', wooId: 20 };
        await drainDeliveryControls();
        expect(m.control.controlPayload).toEqual(command); expect(m.control.controlError).toBe('lost ACK');
    });
});

describe('owner proof decorator', () => {
    const payload = { receiptSafety: 'unverified', targets: [{ state: 'unsupported', stockOwnerWooId: null }, { state: 'pending', stockOwnerWooId: 10 }, { state: 'pending', stockOwnerWooId: 10 }] };
    it('never auto-baselines a missing owner and supports repeated parent-owner pointers', async () => {
        m.control.cutoverState = 'guarded'; m.control.cutoverEpoch = 'epoch';
        expect(await attachReceiptProof(prisma as any, 'a', payload)).toEqual(payload);
        m.owners = [{ stockOwnerWooId: 10, certifiedEpoch: 'epoch', lastSequence: 0n, appliedSequence: 0n, parked: false }];
        const decorated = await attachReceiptProof(prisma as any, 'a', payload);
        expect(decorated.receiptSafety).toBe('verified');
        expect(decorated.receiptProof?.owners).toEqual([{ stockOwnerWooId: 10, sequence: 0, operationId: 'baseline_epoch' }]);
    });
    it('requires settled matching sequences and accepts operator-attested resolution', async () => {
        m.control.cutoverState = 'guarded'; m.control.cutoverEpoch = 'epoch';
        m.owners = [{ stockOwnerWooId: 10, certifiedEpoch: 'epoch', lastSequence: 2n, appliedSequence: 1n, parked: false }];
        expect((await attachReceiptProof(prisma as any, 'a', payload)).receiptSafety).toBe('unverified');
        m.owners[0].appliedSequence = 2n; m.operation = { state: 'uncertain', operationId: 'receipt', cascadeState: 'done' };
        expect((await attachReceiptProof(prisma as any, 'a', payload)).receiptSafety).toBe('unverified');
        m.operation.state = 'reconciled';
        expect((await attachReceiptProof(prisma as any, 'a', payload)).receiptProof?.owners[0].operationId).toBe('receipt');
        m.owners[0].cascadePending = true;
        expect((await attachReceiptProof(prisma as any, 'a', payload)).receiptSafety).toBe('unverified');
    });
});

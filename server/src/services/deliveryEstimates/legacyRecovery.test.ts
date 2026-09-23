import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ job: {} as any, control: {} as any, send: vi.fn(), audit: vi.fn(), po: {} as any, guardedCycle: false }));
vi.mock('./launch', () => ({ LaunchConflict: class extends Error {} }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInboundProducts: vi.fn() }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ legacyReceipt: m.send }) } }));
vi.mock('../../utils/prisma', () => {
    const matches = (where: any) => (!where.id || where.id === m.job.id) && (!where.accountId || where.accountId === m.job.accountId)
        && (!where.state || where.state === m.job.state) && (where.attempts === undefined || (typeof where.attempts === 'object' ? m.job.attempts < where.attempts.lt : where.attempts === m.job.attempts))
        && (!where.reconciliation || JSON.stringify(where.reconciliation.equals) === JSON.stringify(m.job.reconciliation));
    const change = (data: any) => { for (const [k, v] of Object.entries(data)) m.job[k] = v && typeof v === 'object' && 'increment' in v ? (m.job[k] ?? 0) + (v as any).increment : v; return m.job; };
    const db: any = { receiptLegacyWork: {
        findFirst: async ({ where }: any) => matches(where) ? m.job : null,
        findMany: async ({ where }: any) => matches(where) ? [structuredClone(m.job)] : [],
        update: async ({ data }: any) => change(data),
        create: async ({ data }: any) => { m.job = { ...data, state: 'pending', attempts: 0, reconciliation: null, targets: null }; return m.job; },
        updateMany: async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; change(data); return { count: 1 }; },
    }, receiptAccount: { upsert: async ({ update }: any) => Object.assign(m.control, update) }, purchaseOrderItem: { findMany: async () => [] }, auditLog: { create: m.audit },
    purchaseOrder: { findFirst: async () => m.po, update: async ({ data }: any) => Object.assign(m.po, data) }, receiptCycle: { findFirst: async () => m.guardedCycle ? { id: 'guarded' } : null }, receiptOperation: { count: async () => 0 } };
    db.$transaction = (fn: any) => fn(db); return { prisma: db };
});
import { drainLegacyResolutions, observeLegacyReceipt, requestLegacyResolution, requestLegacyPoReversalReview } from './legacyRecovery';
const input = { actionId: '90000000-0000-4000-8000-000000000002', observationToken: 'signed-observation', reason: 'Inventory corrected including legacy and dependent work', receivingPaused: true as const, workersRestarted: true as const, correctedInventoryIncludesLegacyWork: true as const, acknowledgeUnobservableTargets: false };
beforeEach(() => {
    vi.clearAllMocks(); m.control = { receivingFrozen: false };
    m.po = { id: 'po', status: 'RECEIVED', items: [] }; m.guardedCycle = false;
    m.job = { id: 'legacy', accountId: 'a', purchaseOrderId: 'po', state: 'pending', targets: [{ productWooId: 20, variationWooId: null, stock: 7 }], reconciliation: null, attempts: 0, nextAttemptAt: new Date() };
    m.send.mockImplementation(async (action, request) => action === 'observe'
        ? { schemaVersion: 1, jobId: request.jobId, observationToken: 'signed-observation', expiresAt: new Date(Date.now() + 300_000).toISOString(), owners: [{ stockOwnerWooId: 20, stockQuantity: 7 }], unobservable: [], sourceIncomplete: request.sourceIncomplete }
        : { schemaVersion: 1, jobId: request.jobId, actionId: request.actionId, state: 'operator_attested_drained' });
});
describe('legacy normal-UI recovery', () => {
    it('reverses a historical untracked PO only after explicit count-correction attestation, without fictional deltas', async () => {
        await requestLegacyPoReversalReview('a', 'po', 'manager');
        expect(m.job.sourceType).toBe('purchase_order_reversal'); expect(m.po.status).toBe('RECEIVED');
        await expect(requestLegacyResolution('a', m.job.id, 'manager', { ...input, acknowledgeUnobservableTargets: true })).rejects.toThrow('Explicitly confirm');
        await requestLegacyResolution('a', m.job.id, 'manager', { ...input, acknowledgeUnobservableTargets: true, legacyReceiptReversalConfirmed: true });
        await drainLegacyResolutions();
        expect(m.po.status).toBe('ORDERED'); expect(m.job.state).toBe('drained');
        expect(m.send.mock.calls.map(c => c[0])).toEqual(['reconcile']);
    });
    it('does not use legacy count review to bypass a real guarded receipt cycle', async () => {
        m.guardedCycle = true;
        await expect(requestLegacyPoReversalReview('a', 'po', 'manager')).rejects.toThrow('guarded receipt provenance');
    });
    it('freezes receiving before Woo observation and scopes identities to the account', async () => {
        m.send.mockImplementationOnce(async (_action, request) => {
            expect(m.control.receivingFrozen).toBe(true);
            expect(request.targets).toEqual([{ productWooId: 20, variationWooId: null }]);
            return { schemaVersion: 1, jobId: 'legacy', observationToken: 'signed-observation', expiresAt: 'later', owners: [], unobservable: [], sourceIncomplete: false };
        });
        await observeLegacyReceipt('a', 'legacy', 'manager');
        expect(m.control.workersRestartedBy).toBe('manager');
        await expect(observeLegacyReceipt('other-account', 'legacy', 'manager')).rejects.toThrow('not found');
    });
    it('requires explicit unobservable acknowledgment for older jobs with no immutable targets', async () => {
        m.job.targets = null;
        const observed = await observeLegacyReceipt('a', 'legacy', 'manager');
        expect(observed.sourceIncomplete).toBe(true);
        await expect(requestLegacyResolution('a', 'legacy', 'manager', input)).rejects.toThrow('explicitly acknowledge');
        await requestLegacyResolution('a', 'legacy', 'manager', { ...input, acknowledgeUnobservableTargets: true });
        await drainLegacyResolutions(); expect(m.job.state).toBe('drained');
        expect(m.control.receivingFrozen).toBe(true); // Explicit cutover resumes receiving, not this attestation.
        expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ actorId: 'manager', resolution: 'operator_attested_legacy_drain_no_stock_replay' }) }) }));
    });
    it('recovers lost ACKs idempotently with attestation only, never legacy stock replay', async () => {
        await requestLegacyResolution('a', 'legacy', 'manager', input);
        m.send.mockRejectedValueOnce(new Error('lost ACK'));
        await drainLegacyResolutions(); expect(m.job.state).toBe('reconciling');
        const saved = structuredClone(m.job.reconciliation);
        await drainLegacyResolutions(); expect(m.job.state).toBe('drained');
        expect(m.send.mock.calls.map(call => call[0])).toEqual(['reconcile', 'reconcile']);
        expect(m.send.mock.calls[1][1]).toEqual(saved);
        await requestLegacyResolution('a', 'legacy', 'manager', input);
        expect(m.job.state).toBe('drained'); expect(m.audit).toHaveBeenCalledTimes(1);
        await expect(requestLegacyResolution('a', 'legacy', 'other-actor', { ...input, reason: 'Different attestation with reused action ID' })).rejects.toThrow('identity conflict');
    });
    it('stale observations keep receiving frozen and expose a fresh-observation recovery error', async () => {
        await requestLegacyResolution('a', 'legacy', 'manager', input);
        m.send.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Legacy observation stale; observe corrected inventory again.' } } });
        await drainLegacyResolutions(); expect(m.job.state).toBe('reconciliation_failed');
        expect(m.job.lastError).toContain('observe corrected inventory again'); expect(m.control.receivingFrozen).toBe(true);
        expect(m.audit).not.toHaveBeenCalled();
    });
    it('another authorized manager can retry a lost ACK without replacing original audit authority', async () => {
        await requestLegacyResolution('a', 'legacy', 'manager', input); m.job.state = 'reconciliation_failed';
        await requestLegacyResolution('a', 'legacy', 'replacement-manager', input);
        expect(m.job.reconciliation.actorId).toBe('manager');
        expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ originalActorId: 'manager', retryRequestedBy: 'replacement-manager' }) }) }));
        await drainLegacyResolutions(); expect(m.job.state).toBe('drained');
        expect(m.send).toHaveBeenCalledWith('reconcile', expect.objectContaining({ actorId: 'manager' }));
    });
    it('retries lock contention without asking the operator to replace a still-current observation', async () => {
        await requestLegacyResolution('a', 'legacy', 'manager', input);
        m.send.mockRejectedValueOnce({ response: { status: 409, data: { code: 'overseek_legacy_busy', message: 'Owner busy; retry same action.' } } });
        await drainLegacyResolutions(); expect(m.job.state).toBe('reconciling');
        await drainLegacyResolutions(); expect(m.job.state).toBe('drained');
        expect(m.send.mock.calls[0][1]).toEqual(m.send.mock.calls[1][1]);
    });
    it('exposes corrupt historical target data as explicit manual scope review, not an unresolvable error', async () => {
        m.job.targets = [{ damaged: 'historical target' }, { productWooId: 20, stock: 7 }];
        const observation = await observeLegacyReceipt('a', 'legacy', 'manager');
        expect(observation.sourceIncomplete).toBe(true);
        expect(m.send).toHaveBeenCalledWith('observe', expect.objectContaining({ targets: [{ productWooId: 20, variationWooId: null }], sourceIncomplete: true }));
        await expect(requestLegacyResolution('a', 'legacy', 'manager', input)).rejects.toThrow('explicitly acknowledge');
        await requestLegacyResolution('a', 'legacy', 'manager', { ...input, acknowledgeUnobservableTargets: true });
        await drainLegacyResolutions(); expect(m.job.state).toBe('drained');
    });
});

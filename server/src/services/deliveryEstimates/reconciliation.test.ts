import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ op: {} as any, owner: {} as any, send: vi.fn(), audit: vi.fn(), dirty: vi.fn(), capability: vi.fn() }));
vi.mock('../../utils/prisma', () => {
    const matches = (where: any) => (!where.accountId || where.accountId === m.op.accountId) && (!where.operationId || where.operationId === m.op.operationId)
        && (!where.state || typeof where.state !== 'string' || where.state === m.op.state) && (where.attempts === undefined || where.attempts === m.op.attempts);
    const apply = (data: any) => { for (const [k, v] of Object.entries(data)) m.op[k] = v && typeof v === 'object' && 'increment' in v ? m.op[k] + (v as any).increment : v; };
    const db: any = {
        receiptOperation: {
            findFirst: async ({ where }: any) => matches(where) ? { ...m.op, owner: m.owner } : null,
            findMany: async () => m.op.state === 'reconciling' ? [structuredClone(m.op)] : [],
            update: async ({ data }: any) => { apply(data); return m.op; },
            updateMany: async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; apply(data); return { count: 1 }; },
        },
        receiptOwner: { update: async ({ data }: any) => Object.assign(m.owner, data), updateMany: async ({ where, data }: any) => {
            if (m.owner.appliedSequence !== where.appliedSequence || m.owner.parked !== where.parked) return { count: 0 };
            Object.assign(m.owner, data); return { count: 1 };
        } }, receiptAccount: { update: m.capability }, auditLog: { create: m.audit },
    };
    db.$transaction = (fn: any) => fn(db);
    return { prisma: db };
});
vi.mock('./launch', () => ({ LaunchConflict: class extends Error {} }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInboundProducts: m.dirty }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ reconcileReceipt: m.send }) } }));
import { drainReconciliations, requestReconciliation } from './reconciliation';
const input = { actionId: '90000000-0000-4000-8000-000000000001', observationToken: 'signed', observedStockQuantity: 7, reason: 'Corrected including receipt, excluding queued receipt', correctedCountIncludesOperation: true as const };
beforeEach(() => {
    vi.clearAllMocks();
    m.owner = { appliedSequence: 0n, parked: true, leaseExpiresAt: null };
    m.op = { operationId: 'op', accountId: 'a', productId: 'p', productWooId: 10, variationWooId: null, stockOwnerWooId: 10, sequence: 1n, delta: 3, state: 'uncertain', attempts: 2, reconciliation: null };
    m.send.mockImplementation(async (_action, request) => ({ schemaVersion: 1, operationId: 'op', sequence: 1, stockOwnerWooId: 10, actionId: request.actionId, state: 'reconciled', stockQuantity: 7 }));
});
describe('durable operator reconciliation', () => {
    it('permits authorized takeover of retry while preserving the original attestation and ledger identity', async () => {
        await requestReconciliation('a', 'op', 'original-manager', input);
        const original = structuredClone(m.op.reconciliation); m.op.state = 'reconciliation_failed';
        await requestReconciliation('a', 'op', 'replacement-manager', input);
        expect(m.op.reconciliation).toEqual(original);
        await drainReconciliations();
        expect(m.op.state).toBe('reconciled'); expect(m.op.operationId).toBe('op'); expect(m.op.sequence).toBe(1n);
        expect(m.send).toHaveBeenCalledWith('reconcile', original);
    });
    it('attests under authenticated authority and resumes exactly the next owner sequence', async () => {
        await requestReconciliation('a', 'op', 'inventory-manager', input);
        expect(m.send).not.toHaveBeenCalled(); expect(m.op.state).toBe('reconciling');
        await drainReconciliations();
        expect(m.send).toHaveBeenCalledWith('reconcile', expect.objectContaining({ actorId: 'inventory-manager', operation: expect.objectContaining({ operationId: 'op', sequence: 1 }) }));
        expect(m.op.state).toBe('reconciled'); expect(m.owner).toMatchObject({ appliedSequence: 1n, parked: false });
        expect(m.op.cascadeState).toBe('pending'); expect(m.owner.cascadePending).toBe(true);
        expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ actorId: 'inventory-manager', resolution: 'operator_attested_no_delta_replay' }) }) }));
        expect(m.capability).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ capability: 'unknown' }) }));
        expect(m.dirty).toHaveBeenCalledWith(expect.anything(), 'a', [10]);
    });
    it('retries only the identical attestation after lost ACK, never an apply operation', async () => {
        await requestReconciliation('a', 'op', 'manager', input);
        m.send.mockRejectedValueOnce(new Error('lost ACK'));
        await drainReconciliations(); const saved = structuredClone(m.op.reconciliation);
        expect(m.op.state).toBe('reconciling'); expect(m.owner.appliedSequence).toBe(0n);
        await drainReconciliations();
        expect(m.send.mock.calls.map(call => call[0])).toEqual(['reconcile', 'reconcile']);
        expect(m.send.mock.calls[1][1]).toEqual(saved); expect(m.op.state).toBe('reconciled');
        await requestReconciliation('a', 'op', 'manager', input); expect(m.op.state).toBe('reconciled');
    });
    it('rejects stale observations without advancing sequence and prevents action identity reuse', async () => {
        await requestReconciliation('a', 'op', 'manager', input);
        m.send.mockRejectedValueOnce({ response: { status: 409 } });
        await drainReconciliations();
        expect(m.op.state).toBe('reconciliation_failed'); expect(m.owner.appliedSequence).toBe(0n);
        await expect(requestReconciliation('a', 'op', 'manager', { ...input, reason: 'Different action with reused ID' })).rejects.toThrow('identity conflict');
        await expect(requestReconciliation('different-account', 'op', 'manager', input)).rejects.toThrow('not found');
    });
});

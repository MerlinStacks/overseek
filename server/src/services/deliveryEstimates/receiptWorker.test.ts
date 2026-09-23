import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: {} as any, woo: vi.fn(), caps: vi.fn(), send: vi.fn(), dirty: vi.fn(), cascade: vi.fn(), audit: vi.fn() }));
vi.mock('../BOMConsumptionService', () => ({ BOMConsumptionService: { cascadeSyncAffectedProducts: mocks.cascade } }));
vi.mock('../../utils/prisma', () => ({ prisma: mocks.db }));
vi.mock('../woo', () => ({ WooService: { forAccount: mocks.woo } }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInboundProducts: mocks.dirty }));
import { dispatchGuardedReceipt, drainGuardedReceipts, RECEIPT_MAX_ATTEMPTS, RECEIPT_CAPABILITY_MAX_ATTEMPTS } from './receiptWorker';
import { parseReceiptAck, ReceiptWireOperation } from './receiptProtocol';
import { dispatchReceiptCascade, retryReceiptCascade } from './receiptCascade';

let state: { accounts: any[]; owners: any[]; operations: any[] };
const operation = (sequence = 1, accountId = 'a', ownerId = 10) => ({ operationId: `${accountId}_${ownerId}_${sequence}`, accountId, productWooId: ownerId, variationWooId: null, stockOwnerWooId: ownerId,
    sequence: BigInt(sequence), delta: sequence % 2 ? 3 : -3, state: 'pending', attempts: 0, nextAttemptAt: new Date(0), productId: 'p', cascadeState: 'waiting_receipt', cascadeAttempts: 0, cascadeNextAttemptAt: new Date(0) });
function enrol(accountId = 'a', stockOwnerWooId = 10, count = 2) {
    if (!state.accounts.some(a => a.accountId === accountId)) state.accounts.push({ accountId, capability: 'unknown', capabilityExpiresAt: null, capabilityAttempts: 0, capabilityNextAttemptAt: new Date(0), leaseToken: null, leaseExpiresAt: null, lastServedAt: new Date(0), cascadeLeaseToken: null, cascadeLeaseExpiresAt: null });
    state.owners.push({ accountId, stockOwnerWooId, lastSequence: BigInt(count), appliedSequence: 0n, parked: false, cascadePending: false, nextAttemptAt: new Date(0), leaseToken: null, leaseExpiresAt: null });
    for (let i = 1; i <= count; i++) state.operations.push(operation(i, accountId, stockOwnerWooId));
}
function matches(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
        if (key === 'OR') return value.some((v: any) => matches(row, v));
        if (key === 'accountId_stockOwnerWooId_sequence' || key === 'accountId_stockOwnerWooId') return matches(row, value);
        if (key === 'owner') return !!row.owner && matches(row.owner, value);
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            if ('in' in value) return value.in.includes(row[key]);
            if ('not' in value) return row[key] !== value.not;
            if ('lte' in value) return row[key] !== null && row[key] <= value.lte;
            if ('gt' in value) return row[key] !== null && row[key] > (value.gt === 'appliedSequence' ? row.appliedSequence : value.gt);
        }
        return value instanceof Date ? +row[key] === +value : row[key] === value;
    });
}
const change = (row: any, data: any) => { for (const [key, value] of Object.entries(data) as any) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; };
function client(getState: () => typeof state) {
    const rows = (name: keyof typeof state) => getState()[name].map(r => name === 'operations' ? { ...r, owner: getState().owners.find(o => o.accountId === r.accountId && o.stockOwnerWooId === r.stockOwnerWooId) } : r);
    const model = (name: keyof typeof state) => ({
        fields: { appliedSequence: 'appliedSequence' },
        findUnique: vi.fn(async ({ where }: any) => structuredClone(getState()[name].find(r => matches(r, where)) ?? null)),
        findFirst: vi.fn(async ({ where }: any) => structuredClone(rows(name).find(r => matches(r, where)) ?? null)),
        updateMany: vi.fn(async ({ where, data }: any) => { const rows = getState()[name].filter(r => matches(r, where)); rows.forEach(r => change(r, data)); return { count: rows.length }; }),
        update: vi.fn(async ({ where, data }: any) => { const row = getState()[name].find(r => matches(r, where)); if (!row) throw new Error('row not found'); change(row, data); return row; }),
    });
    return { receiptAccount: { ...model('accounts'), findMany: vi.fn(async ({ take, where: { account: _account, ...where } }: any) => getState().accounts.filter(a => matches(a, where) && getState().owners.some(o => o.accountId === a.accountId && !o.parked && o.nextAttemptAt <= new Date() && o.lastSequence > o.appliedSequence)).slice(0, take)) }, receiptOwner: model('owners'), receiptOperation: { ...model('operations'), count: async ({ where }: any) => getState().operations.filter(o => matches(o, where)).length }, bOM: { findFirst: async () => ({ id: 'derived-bom', product: { wooId: 20 } }) }, auditLog: { create: mocks.audit } };
}
const ack = (op: ReceiptWireOperation, phase: string) => ({ schemaVersion: 1, operationId: op.operationId, sequence: op.sequence, stockOwnerWooId: op.stockOwnerWooId,
    state: phase === 'prepare' ? 'prepared' : 'applied', stockQuantity: phase === 'prepare' ? null : 8, guardActive: true, receiptSafety: 'unverified' });
const due = () => { state.owners.forEach(o => { o.nextAttemptAt = new Date(0); }); };
beforeEach(() => {
    vi.clearAllMocks(); state = { accounts: [], owners: [], operations: [] }; enrol();
    Object.assign(mocks.db, client(() => state), { $transaction: async (callback: any) => { const staged = structuredClone(state); const result = await callback(client(() => staged)); state = staged; return result; } });
    mocks.woo.mockResolvedValue({ getDeliveryDiscovery: mocks.caps, postGuardedReceipt: mocks.send });
    mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { guardedReceipts: true, receiptFinalization: false, inboundReceiptSafety: false, storefront: false } });
    mocks.send.mockImplementation(async (phase, op) => ack(op, phase)); mocks.dirty.mockResolvedValue(undefined);
    mocks.cascade.mockImplementation(async (_account, _product, _variation, _type, _visited, options) => { await options.beforeWrite('derived', 0); });
});
afterEach(() => vi.useRealTimers());

describe('guarded receipt worker ordering and fencing', () => {
    it('durably queues cascade once after stock ACK without stalling the next same-owner stock sequence', async () => {
        await dispatchGuardedReceipt('a');
        expect(state.operations[0]).toMatchObject({ state: 'applied', cascadeState: 'pending', cascadeAttempts: 0 });
        expect(state.owners[0].cascadePending).toBe(true);
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(4);
        await dispatchReceiptCascade('a'); await dispatchReceiptCascade('a');
        expect(mocks.cascade).toHaveBeenCalledTimes(2);
        expect(state.operations[0].cascadeState).toBe('done'); expect(state.owners[0].cascadePending).toBe(false);
        await dispatchReceiptCascade('a'); expect(mocks.cascade).toHaveBeenCalledTimes(2);
        expect(state.operations[1].state).toBe('applied');
        expect(mocks.send.mock.calls.filter(([phase]) => phase === 'apply')).toHaveLength(2);
    });
    it('backs off a failed cascade, resumes after a worker restart and never replays the applied delta', async () => {
        await dispatchGuardedReceipt('a'); mocks.cascade.mockRejectedValueOnce(new Error('derived BOM unavailable'));
        await dispatchReceiptCascade('a');
        expect(state.operations[0]).toMatchObject({ state: 'applied', cascadeState: 'pending', cascadeError: 'derived BOM unavailable', cascadeAttempts: 1 });
        expect(state.operations[0].cascadeNextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        await dispatchReceiptCascade('a');
        expect(mocks.cascade).toHaveBeenCalledTimes(1);
        state.accounts[0].cascadeLeaseToken = 'crashed'; state.accounts[0].cascadeLeaseExpiresAt = new Date(0);
        state.operations[0].cascadeNextAttemptAt = new Date(0);
        await dispatchReceiptCascade('a');
        expect(state.operations[0].cascadeState).toBe('done');
        expect(mocks.send.mock.calls.filter(([phase]) => phase === 'apply')).toHaveLength(1);
    });
    it('parks exhausted cascade work visibly and retries only cascade under inventory authority', async () => {
        await dispatchGuardedReceipt('a'); mocks.cascade.mockRejectedValue(new Error('BOM failure'));
        for (let i = 0; i < 9; i++) { state.operations[0].cascadeNextAttemptAt = new Date(0); await dispatchReceiptCascade('a'); }
        expect(state.operations[0]).toMatchObject({ state: 'applied', cascadeState: 'failed', cascadeAttempts: 8, cascadeError: 'BOM failure' });
        expect(mocks.cascade).toHaveBeenCalledTimes(8);
        await dispatchGuardedReceipt('a'); expect(state.operations[1].state).toBe('applied');
        mocks.cascade.mockResolvedValueOnce(undefined); await dispatchReceiptCascade('a');
        expect(state.operations[1].cascadeState).toBe('done');
        expect(state.owners[0].cascadePending).toBe(true); // Older failed work still fences proof release.
        await retryReceiptCascade('a', state.operations[0].operationId, 'inventory-manager');
        mocks.cascade.mockResolvedValueOnce(undefined); await dispatchReceiptCascade('a');
        expect(state.operations[0].cascadeState).toBe('done');
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ actorId: 'inventory-manager', action: 'retry_bom_cascade_no_receipt_delta' }) }) }));
        expect(mocks.send.mock.calls.filter(([phase]) => phase === 'apply')).toHaveLength(2);
    });
    it('rejects stale cascade completion and preserves the replacement worker lease', async () => {
        await dispatchGuardedReceipt('a');
        mocks.cascade.mockImplementationOnce(async () => { state.accounts[0].cascadeLeaseToken = 'replacement'; state.owners[0].leaseToken = 'replacement'; });
        await dispatchReceiptCascade('a');
        expect(state.operations[0].cascadeState).toBe('pending'); expect(state.owners[0].cascadePending).toBe(true);
        expect(state.accounts[0].cascadeLeaseToken).toBe('replacement'); expect(state.owners[0].leaseToken).toBe('replacement');
    });
    it('turns a crashed final cascade attempt into a visible retryable failure instead of permanent pending', async () => {
        await dispatchGuardedReceipt('a'); state.operations[0].cascadeAttempts = 8;
        state.accounts[0].cascadeLeaseToken = 'dead'; state.accounts[0].cascadeLeaseExpiresAt = new Date(0);
        await dispatchReceiptCascade('a');
        expect(state.operations[0].cascadeState).toBe('failed'); expect(mocks.cascade).not.toHaveBeenCalled();
        expect(state.accounts[0].cascadeLeaseToken).toBeNull();
        await retryReceiptCascade('a', state.operations[0].operationId, 'manager'); await dispatchReceiptCascade('a');
        expect(state.operations[0].cascadeState).toBe('done');
    });
    it('requires prepare before apply, then drains +receipt/-reversal in sequence with exact envelopes', async () => {
        await dispatchGuardedReceipt('a'); await dispatchReceiptCascade('a'); await dispatchGuardedReceipt('a');
        expect(mocks.send.mock.calls.map(([phase, op]) => [phase, op.sequence, op.delta])).toEqual([['prepare', 1, 3], ['apply', 1, 3], ['prepare', 2, -3], ['apply', 2, -3]]);
        expect(Object.keys(mocks.send.mock.calls[0][1]).sort()).toEqual(['operationId', 'sequence', 'productWooId', 'variationWooId', 'stockOwnerWooId', 'delta'].sort());
        expect(state.operations.map(o => o.state)).toEqual(['applied', 'applied']); expect(state.owners[0].appliedSequence).toBe(2n);
        expect(mocks.caps).toHaveBeenCalledTimes(1); expect(mocks.dirty).toHaveBeenCalledTimes(3);
    });
    it.each(['prepare', 'apply'])('lost %s ACK replays the same operation ID without sending the next sequence', async lost => {
        const journal = new Set<string>(); let stockAttempts = 0; let dropped = false;
        mocks.send.mockImplementation(async (phase, op) => {
            if (phase === 'apply' && !journal.has(op.operationId)) { journal.add(op.operationId); stockAttempts++; }
            if (phase === lost && !dropped) { dropped = true; throw new Error('response lost'); }
            return ack(op, phase);
        });
        await dispatchGuardedReceipt('a'); expect(state.owners[0].appliedSequence).toBe(0n);
        due(); await dispatchGuardedReceipt('a');
        expect(stockAttempts).toBe(1); expect(new Set(mocks.send.mock.calls.map(([, op]) => op.operationId)).size).toBe(1);
        expect(state.operations[0].state).toBe('applied'); expect(state.operations[1].state).toBe('pending');
    });
    it('uncertain result parks and blocks every later same-owner operation', async () => {
        mocks.send.mockImplementation(async (phase, op) => ({ ...ack(op, phase), ...(phase === 'apply' ? { state: 'uncertain', stockQuantity: null } : {}) }));
        await dispatchGuardedReceipt('a'); due(); await dispatchGuardedReceipt('a');
        expect(state.operations[0].state).toBe('uncertain'); expect(state.owners[0].parked).toBe(true);
        expect(mocks.send).toHaveBeenCalledTimes(2); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it.each(['schemaVersion', 'operationId', 'sequence', 'stockOwnerWooId', 'guardActive', 'receiptSafety', 'stockQuantity', 'state'])('rejects mismatched %s prepare ACK before apply', async field => {
        mocks.send.mockImplementation(async (phase, op) => ({ ...ack(op, phase), [field]: 'wrong' }));
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(1); expect(state.owners[0].parked).toBe(true); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it('rejects an apply ACK for a different owner and does not mark applied', async () => {
        mocks.send.mockImplementation(async (phase, op) => ({ ...ack(op, phase), ...(phase === 'apply' ? { stockOwnerWooId: 99 } : {}) }));
        await dispatchGuardedReceipt('a'); expect(state.operations[0].state).toBe('parked'); expect(state.owners[0].appliedSequence).toBe(0n);
    });
    it('parks at a durable capped retry count, including attempts consumed by crashed processes', async () => {
        mocks.send.mockRejectedValue(new Error('timeout'));
        for (let i = 0; i < RECEIPT_MAX_ATTEMPTS + 2; i++) { due(); await dispatchGuardedReceipt('a'); }
        expect(mocks.send).toHaveBeenCalledTimes(RECEIPT_MAX_ATTEMPTS); expect(state.operations[0].attempts).toBe(RECEIPT_MAX_ATTEMPTS); expect(state.owners[0].parked).toBe(true);
    });
    it('suppresses old-plugin discovery at account level across owners and future ticks', async () => {
        enrol('a', 11); enrol('a', 12);
        mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true } });
        await drainGuardedReceipts(); due(); await drainGuardedReceipts(); await dispatchGuardedReceipt('a');
        expect(mocks.caps).toHaveBeenCalledTimes(1); expect(mocks.send).not.toHaveBeenCalled(); expect(state.accounts[0].capability).toBe('blocked');
    });
    it.each([401, 403, 404])('suppresses account-wide HTTP %s failures', async status => {
        mocks.send.mockRejectedValue({ response: { status } });
        await dispatchGuardedReceipt('a'); due(); await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(1); expect(state.accounts[0].capability).toBe('blocked');
    });
    it('account and owner isolation allow another tenant to proceed after uncertainty', async () => {
        enrol('b'); mocks.send.mockImplementation(async (phase, op) => ({ ...ack(op, phase), ...(op.operationId.startsWith('a_') ? { state: 'uncertain', stockQuantity: null } : {}) }));
        await drainGuardedReceipts(); expect(state.operations.find(o => o.accountId === 'b').state).toBe('applied'); expect(state.operations[0].state).toBe('uncertain');
        expect(mocks.woo.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    });
    it.each(['prepare', 'apply'])('ignores late %s ACK and cannot clear a replacement lease', async phaseToSteal => {
        mocks.send.mockImplementation(async (phase, op) => {
            if (phase === phaseToSteal) {
                state.accounts[0].leaseToken = 'new-worker'; state.owners[0].leaseToken = 'new-worker';
            }
            return ack(op, phase);
        });
        await dispatchGuardedReceipt('a');
        expect(state.owners[0].appliedSequence).toBe(0n); expect(state.owners[0].leaseToken).toBe('new-worker'); expect(state.accounts[0].leaseToken).toBe('new-worker'); expect(mocks.dirty).not.toHaveBeenCalled();
        expect(mocks.send).toHaveBeenCalledTimes(phaseToSteal === 'prepare' ? 1 : 2);
    });
    it('rolls back applied state when inbound dirty persistence fails; apply replay recovers', async () => {
        mocks.dirty.mockRejectedValueOnce(new Error('database commit failed'));
        await dispatchGuardedReceipt('a'); expect(state.operations[0].state).toBe('prepared'); expect(state.owners[0].appliedSequence).toBe(0n);
        due(); await dispatchGuardedReceipt('a'); expect(state.operations[0].state).toBe('applied');
        expect(mocks.send.mock.calls.map(([phase]) => phase)).toEqual(['prepare', 'apply', 'apply']);
    });
    it('owner token alone fences a late ACK even while the account token still matches', async () => {
        mocks.send.mockImplementation(async (phase, op) => { state.owners[0].leaseToken = 'replacement-owner'; return ack(op, phase); });
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(state.operations[0].state).toBe('pending'); expect(state.owners[0].leaseToken).toBe('replacement-owner');
    });
    it('an expired owner lease cannot acknowledge an apply', async () => {
        mocks.send.mockImplementation(async (phase, op) => { if (phase === 'apply') state.owners[0].leaseExpiresAt = new Date(0); return ack(op, phase); });
        await dispatchGuardedReceipt('a'); expect(state.operations[0].state).toBe('prepared'); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it('crashed final attempt parks without another network attempt', async () => {
        state.operations[0].attempts = RECEIPT_MAX_ATTEMPTS;
        await dispatchGuardedReceipt('a'); expect(mocks.woo).not.toHaveBeenCalled(); expect(state.owners[0].parked).toBe(true);
    });
    it('recognises an exact already-applied prepare replay without attempting another apply', async () => {
        mocks.send.mockImplementation(async (_phase, op) => ack(op, 'apply'));
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(1); expect(state.operations[0].state).toBe('applied');
    });
    it('bounded drain never processes more accounts than its budget', async () => {
        enrol('b'); enrol('c'); await drainGuardedReceipts(1); expect(mocks.woo).toHaveBeenCalledTimes(1);
    });
    it('ACK safety remains unverified even after success', () => {
        const op = { ...operation(), sequence: 1 };
        expect(parseReceiptAck({ ...ack(op, 'apply'), receiptSafety: 'verified' }, op)).toBeNull();
        expect(parseReceiptAck(ack(op, 'apply'), op)?.receiptSafety).toBe('unverified');
    });
    it('slow original apply, busy replay, then historical applied ACK never double-mutates or sends the next operation', async () => {
        vi.useFakeTimers();
        let nativeCalls = 0;
        let originalApplying = false;
        mocks.send.mockImplementation(async (phase, op) => {
            if (phase === 'prepare') return ack(op, phase);
            if (!nativeCalls) {
                nativeCalls++;
                originalApplying = true; // Plugin continues processing after the server request times out.
                throw new Error('apply response timeout');
            }
            if (originalApplying) throw { response: { status: 409, data: { code: 'overseek_receipt_busy' } } };
            return { ...ack(op, 'apply'), stockQuantity: -2 }; // Historical journal ACK after original completion.
        });
        await dispatchGuardedReceipt('a');
        vi.setSystemTime(state.owners[0].nextAttemptAt);
        await dispatchGuardedReceipt('a');
        expect(state.owners[0].parked).toBe(false); expect(state.operations[0].state).toBe('prepared');
        expect(state.owners[0].nextAttemptAt.getTime() - Date.now()).toBe(60_000);
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(3);
        originalApplying = false;
        vi.setSystemTime(state.owners[0].nextAttemptAt);
        await dispatchGuardedReceipt('a');
        expect(nativeCalls).toBe(1); expect(state.operations[0]).toMatchObject({ state: 'applied', stockQuantity: -2, attempts: 3 });
        expect(state.operations[1]).toMatchObject({ state: 'pending', attempts: 0 });
        expect(new Set(mocks.send.mock.calls.map(([, op]) => op.operationId)).size).toBe(1);
    });
    it.each(['overseek_receipt_conflict', undefined])('parks other HTTP409 code %s', async code => {
        mocks.send.mockRejectedValue({ response: { status: 409, data: { code } } });
        await dispatchGuardedReceipt('a'); due(); await dispatchGuardedReceipt('a');
        expect(state.owners[0].parked).toBe(true); expect(mocks.send).toHaveBeenCalledTimes(1);
    });
    it('caps repeated advisory-lock busy retries', async () => {
        mocks.send.mockRejectedValue({ response: { status: 409, data: { code: 'overseek_receipt_busy' } } });
        for (let i = 0; i < RECEIPT_MAX_ATTEMPTS + 1; i++) { due(); await dispatchGuardedReceipt('a'); }
        expect(mocks.send).toHaveBeenCalledTimes(RECEIPT_MAX_ATTEMPTS); expect(state.operations[0].state).toBe('parked');
    });
    it.each([
        ['prepared', 8], ['applied', null], ['applied', 1.5], ['applied', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects prepare ACK state=%s quantity=%s without sending apply', async (ackState, stockQuantity) => {
        mocks.send.mockImplementation(async (_phase, op) => ({ ...ack(op, 'prepare'), state: ackState, stockQuantity }));
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(state.operations[0].state).toBe('parked'); expect(state.owners[0].appliedSequence).toBe(0n); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it('rejects a prepared ACK from apply even with the correct null quantity', async () => {
        mocks.send.mockImplementation(async (_phase, op) => ack(op, 'prepare'));
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(2); expect(state.operations[0].state).toBe('parked');
    });
    it.each([null, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects applied quantity %s after successful prepare', async stockQuantity => {
        mocks.send.mockImplementation(async (phase, op) => ({ ...ack(op, phase), ...(phase === 'apply' ? { stockQuantity } : {}) }));
        await dispatchGuardedReceipt('a'); expect(mocks.send).toHaveBeenCalledTimes(2);
        expect(state.operations[0].state).toBe('parked'); expect(state.owners[0].appliedSequence).toBe(0n); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it.each([undefined, 429, 500, 503])('account discovery outage (%s) probes only once per due window across multiple owners', async status => {
        vi.useFakeTimers(); enrol('a', 11); enrol('a', 12);
        const supported = { schemaVersion: 1, capabilities: { guardedReceipts: true } };
        mocks.caps.mockRejectedValue(status === undefined ? new Error('discovery timeout') : { response: { status } });
        await drainGuardedReceipts();
        const firstDue = state.accounts[0].capabilityNextAttemptAt;
        expect(firstDue.getTime() - Date.now()).toBe(30_000);
        expect(state.accounts[0].capabilityAttempts).toBe(1);
        // Different owners are due, and both entry points must respect the account deadline.
        state.owners[0].nextAttemptAt = new Date(Date.now() + 3_600_000);
        await drainGuardedReceipts(); await dispatchGuardedReceipt('a');
        vi.setSystemTime(new Date(firstDue.getTime() - 1));
        await drainGuardedReceipts(); await dispatchGuardedReceipt('a');
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.db.receiptAccount.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ capabilityNextAttemptAt: { lte: new Date() } }) }));
        vi.setSystemTime(firstDue); await drainGuardedReceipts();
        expect(mocks.caps).toHaveBeenCalledTimes(2);
        expect(state.accounts[0].capabilityNextAttemptAt.getTime() - Date.now()).toBe(60_000);
        expect(state.operations.every(op => op.attempts === 0 && op.state === 'pending')).toBe(true); expect(mocks.send).not.toHaveBeenCalled();
        mocks.caps.mockResolvedValue(supported);
        vi.setSystemTime(state.accounts[0].capabilityNextAttemptAt); await dispatchGuardedReceipt('a');
        expect(state.accounts[0]).toMatchObject({ capability: 'supported', capabilityAttempts: 0, lastError: null });
        expect(state.operations.find(op => op.stockOwnerWooId === 11 && op.sequence === 1n)).toMatchObject({ state: 'applied', attempts: 1 });
    });
    it('caps durable account discovery attempts without consuming any operation budget', async () => {
        vi.useFakeTimers(); enrol('a', 11); mocks.caps.mockRejectedValue(new Error('timeout'));
        for (let i = 0; i < RECEIPT_CAPABILITY_MAX_ATTEMPTS + 2; i++) {
            await dispatchGuardedReceipt('a'); vi.setSystemTime(state.accounts[0].capabilityNextAttemptAt);
        }
        expect(mocks.caps).toHaveBeenCalledTimes(RECEIPT_CAPABILITY_MAX_ATTEMPTS);
        expect(state.accounts[0]).toMatchObject({ capability: 'blocked', capabilityAttempts: RECEIPT_CAPABILITY_MAX_ATTEMPTS });
        expect(state.operations.every(op => op.attempts === 0)).toBe(true); expect(state.owners.every(o => !o.parked)).toBe(true);
    });
    it('a crashed final discovery attempt cannot trigger another probe', async () => {
        state.accounts[0].capabilityAttempts = RECEIPT_CAPABILITY_MAX_ATTEMPTS;
        await dispatchGuardedReceipt('a'); expect(mocks.caps).not.toHaveBeenCalled(); expect(state.accounts[0].capability).toBe('blocked');
        expect(state.operations.every(op => op.attempts === 0)).toBe(true);
    });
    it('reserves discovery attempt/deadline before probing and fences a late capability ACK', async () => {
        vi.useFakeTimers();
        mocks.caps.mockImplementation(async () => {
            expect(state.accounts[0].capabilityAttempts).toBe(1);
            expect(state.accounts[0].capabilityNextAttemptAt.getTime() - Date.now()).toBe(30_000);
            expect(state.operations.every(op => op.attempts === 0)).toBe(true);
            state.accounts[0].leaseToken = 'replacement'; state.owners[0].leaseToken = 'replacement';
            return { schemaVersion: 1, capabilities: { guardedReceipts: true } };
        });
        await dispatchGuardedReceipt('a');
        expect(state.accounts[0]).toMatchObject({ capability: 'unknown', capabilityAttempts: 1, leaseToken: 'replacement' });
        expect(mocks.send).not.toHaveBeenCalled();
    });
    it.each([401, 403, 404])('discovery HTTP%s remains account-blocking', async status => {
        mocks.caps.mockRejectedValue({ response: { status } });
        await dispatchGuardedReceipt('a'); due(); await drainGuardedReceipts();
        expect(state.accounts[0].capability).toBe('blocked'); expect(mocks.caps).toHaveBeenCalledTimes(1); expect(mocks.send).not.toHaveBeenCalled();
        expect(state.operations.every(op => op.attempts === 0)).toBe(true);
    });
    it('discovery backoff for one account does not stop a different account', async () => {
        enrol('b');
        mocks.woo.mockImplementation(async accountId => ({ getDeliveryDiscovery: accountId === 'a' ? async () => { throw new Error('timeout'); } : mocks.caps, postGuardedReceipt: mocks.send }));
        await drainGuardedReceipts();
        expect(state.operations.find(op => op.accountId === 'b').state).toBe('applied');
        expect(state.operations.filter(op => op.accountId === 'a').every(op => op.attempts === 0)).toBe(true);
    });
});

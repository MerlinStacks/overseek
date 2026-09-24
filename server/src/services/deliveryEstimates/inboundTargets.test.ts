import { describe, expect, it, vi } from 'vitest';
import { configuredInboundProducts, dirtyInboundProductIds, dirtyInboundProducts, recordIntent, recordProductIntent } from './intents';

function adapter() {
    const targets = new Map<number, number>();
    const tx = {
        wooProduct: { findMany: vi.fn().mockResolvedValue([]) },
        deliveryInputSync: { findMany: vi.fn().mockResolvedValue([]) },
        deliveryInboundDirtyTarget: { upsert: vi.fn(async ({ create }: any) => { targets.set(create.wooId, (targets.get(create.wooId) ?? 0) + 1); }) },
        deliverySyncAccount: { upsert: vi.fn() },
    };
    return { tx, targets };
}

describe('low-load durable inbound targets', () => {
    it('indexes renewal four hours before the generated expiry and parks empty tombstones', async () => {
        const input = vi.fn();
        const tx = { deliverySyncAccount: { upsert: vi.fn().mockResolvedValue({ capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', resyncGeneration: 0 }) }, deliveryInputSync: { upsert: input } };
        await recordIntent(tx as any, 'a', 'inbound', 10, { generatedAt: '2026-09-21T12:00:00Z', expiresAt: '2026-09-22T12:00:00Z', targets: [{ wooId: 10 }] });
        expect(input.mock.calls[0][0]).toMatchObject({ create: { inboundRenewAt: new Date('2026-09-22T08:00:00Z') }, update: { inboundRenewAt: new Date('2026-09-22T08:00:00Z') } });
        await recordIntent(tx as any, 'a', 'inbound', 10, { generatedAt: '2026-09-21T12:00:00Z', expiresAt: '2026-09-22T12:00:00Z', targets: [] });
        expect(input.mock.calls[1][0].update.inboundRenewAt).toBeNull();
    });
    it('preserves null production clears and avoids product revision churn on unchanged renewal', async () => {
        const payload = { wooId: 10, productionMinDays: null, productionMaxDays: null, variations: [] };
        const input = vi.fn();
        const find = vi.fn().mockImplementation(async ({ where }) => where.accountId_scope_entityId.scope === 'settings' ? { id: 'settings' } : { payload });
        const tx = { deliverySyncAccount: { upsert: vi.fn().mockResolvedValue({ capabilityStatus: 'supported', resyncGeneration: 0 }) }, deliveryInputSync: { findUnique: find, upsert: input } };
        await recordProductIntent(tx as any, 'a', payload, true);
        expect(input).not.toHaveBeenCalled();
        find.mockImplementation(async ({ where }) => where.accountId_scope_entityId.scope === 'settings' ? { id: 'settings' } : { payload: { ...payload, productionMinDays: 0, productionMaxDays: 2 } });
        await recordProductIntent(tx as any, 'a', payload, true);
        expect(input.mock.calls[0][0].update.payload).toEqual(payload);
    });
    it('unconfigured inventory activity does not enrol products or create account work', async () => {
        const { tx, targets } = adapter();
        await dirtyInboundProducts(tx as any, 'a', [10, 10, 20]);
        expect(targets.size).toBe(0); expect(tx.deliverySyncAccount.upsert).not.toHaveBeenCalled();
        expect(tx.wooProduct.findMany).toHaveBeenCalledWith({ where: { accountId: 'a', wooId: { in: [10, 20] }, ...configuredInboundProducts }, select: { wooId: true } });
        expect(tx.deliveryInputSync.findMany).toHaveBeenCalledWith({ where: { accountId: 'a', scope: 'inbound', entityId: { in: [10, 20] } }, select: { entityId: true } });
    });
    it('coalesces configured parents/variation overrides and preserves existing clears without clearing suppression', async () => {
        const { tx, targets } = adapter();
        tx.wooProduct.findMany.mockResolvedValue([{ wooId: 10 }, { wooId: 20 }]);
        tx.deliveryInputSync.findMany.mockResolvedValue([{ entityId: 20 }, { entityId: 30 }]);
        await dirtyInboundProducts(tx as any, 'a', [10, 20, 30]);
        await dirtyInboundProducts(tx as any, 'a', [10, 20, 30]);
        expect([...targets]).toEqual([[10, 2], [20, 2], [30, 2]]);
        expect(tx.deliverySyncAccount.upsert.mock.calls[0][0]).toEqual({ where: { accountId: 'a' }, create: { accountId: 'a', inboundRequested: true }, update: { inboundRequested: true, inboundVersion: { increment: 1 } } });
        expect(configuredInboundProducts.OR).toContainEqual({ variations: { some: { OR: [{ productionMinDays: { not: null } }, { productionMaxDays: { not: null } }] } } });
    });
    it('resolves old/new direct IDs inside the tenant and bounds each lookup to 100 identities', async () => {
        const { tx, targets } = adapter();
        tx.wooProduct.findMany.mockImplementation(async ({ where }: any) => where.id
            ? where.id.in.filter((id: string) => id !== 'foreign').map((id: string) => ({ wooId: Number(id) }))
            : where.wooId.in.map((wooId: number) => ({ wooId })));
        await dirtyInboundProductIds(tx as any, 'a', [...Array.from({ length: 205 }, (_, n) => String(n + 1)), 'foreign', null, '1']);
        expect(targets.size).toBe(205);
        expect(tx.wooProduct.findMany.mock.calls.every(([query]: any[]) => query.where.accountId === 'a' && (query.where.id?.in ?? query.where.wooId.in).length <= 100)).toBe(true);
        expect(tx.wooProduct.findMany).toHaveBeenCalledTimes(6);
        expect(tx.deliveryInputSync.findMany).toHaveBeenCalledTimes(3);
    });
    it('new target snapshots inherit inbound suppression without changing existing disabled settings', async () => {
        const input = vi.fn();
        const control = vi.fn().mockResolvedValue({ capabilityStatus: 'supported', inboundCapabilityStatus: 'plugin_update_required', resyncGeneration: 3 });
        const tx = { deliverySyncAccount: { upsert: control }, deliveryInputSync: { upsert: input } };
        await recordIntent(tx as any, 'a', 'inbound', 10, { wooId: 10, receiptSafety: 'unverified', targets: [] });
        expect(input).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ scope: 'inbound', status: 'plugin_update_required' }),
            update: expect.objectContaining({ status: 'plugin_update_required' }),
        }));
        expect(control.mock.calls[0][0].update).toEqual({ hasWork: true, nextAttemptAt: expect.any(Date) });
        expect(input.mock.calls.every(([query]) => query.create.scope === 'inbound')).toBe(true);
    });
});

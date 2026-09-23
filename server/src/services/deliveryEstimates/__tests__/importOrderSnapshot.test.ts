import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { importOrderSnapshot } from '../importOrderSnapshot';
import { snapshotFixture, snapshotMetadata } from './snapshotFixture';

describe('first valid snapshot CAS', () => {
    it('concurrent initial imports return one winner per account/order', async () => {
        const rows = new Map<string, unknown>();
        const tx = { wooOrder: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                expect(where.deliveryEstimateSnapshot.equals).toBe(Prisma.DbNull);
                const key = `${where.accountId}:${where.wooId}`;
                if (rows.has(key)) return { count: 0 };
                rows.set(key, data.deliveryEstimateSnapshot);
                await Promise.resolve();
                return { count: 1 };
            }),
            findUnique: vi.fn(async ({ where }: any) => ({ deliveryEstimateSnapshot: rows.get(`${where.accountId_wooId.accountId}:${where.accountId_wooId.wooId}`) }))
        } };
        const a = snapshotFixture();
        const b = { ...a, capturedAt: '2026-09-23T10:00:00Z' };
        const results = await Promise.all([
            importOrderSnapshot(tx as any, 'a', 42, snapshotMetadata(a), null),
            importOrderSnapshot(tx as any, 'a', 42, snapshotMetadata(b), null),
            importOrderSnapshot(tx as any, 'b', 42, snapshotMetadata(b), null)
        ]);
        expect(results).toEqual([a, a, b]);
    });
    it('invalid metadata cannot initialize; existing persisted values are never rewritten', async () => {
        const tx = { wooOrder: { updateMany: vi.fn(), findUnique: vi.fn() } };
        expect(await importOrderSnapshot(tx as any, 'a', 42, snapshotMetadata({}), null)).toBeNull();
        const persisted = snapshotFixture();
        expect(await importOrderSnapshot(tx as any, 'a', 42, [], persisted)).toEqual(persisted);
        expect(await importOrderSnapshot(tx as any, 'a', 42, snapshotMetadata(persisted), {})).toEqual({});
        expect(tx.wooOrder.updateMany).not.toHaveBeenCalled();
    });
});

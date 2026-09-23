import { describe, expect, it, vi } from 'vitest';
import { requestSettingsRevalidation } from './revalidation';

describe('settings activation intent', () => {
    it.each([false, true])('preserves merchant desiredActive=%s and only queues guarded desired activation', async desiredActive => {
        const row: any = { desiredActive, cutoverState: 'guarded', receivingFrozen: false, controlAction: null, controlRevision: 5n, controlLeaseToken: 'existing-lease' };
        const updateMany = vi.fn(async ({ where, data }) => {
            if (row.desiredActive !== where.desiredActive || row.cutoverState !== where.cutoverState || row.receivingFrozen !== where.receivingFrozen || !where.OR.some((c: any) => row.controlAction === c.controlAction)) return { count: 0 };
            Object.assign(row, { ...data, controlRevision: row.controlRevision + BigInt(data.controlRevision.increment) }); return { count: 1 };
        });
        await requestSettingsRevalidation({ receiptAccount: { updateMany } } as any, 'account');
        expect(row.desiredActive).toBe(desiredActive);
        expect(row.controlAction).toBe(desiredActive ? 'activate' : null);
        expect(row.controlRevision).toBe(desiredActive ? 6n : 5n);
        expect(row.controlLeaseToken).toBe('existing-lease');
        expect(updateMany.mock.calls[0][0].where.accountId).toBe('account');
    });
});

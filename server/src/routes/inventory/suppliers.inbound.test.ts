import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), find: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction, supplier: { findFirst: mocks.find } } }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'a'; } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { supplierRoutes } from './suppliers';

describe('supplier inbound invalidation', () => {
    beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue({ id: 's' }); });
    it.each(['PUT', 'DELETE'] as const)('%s commits source and dirty intent together, with account-first locking', async method => {
        let state = { dirty: false, changed: false };
        let fail = true;
        const events: string[] = [];
        mocks.transaction.mockImplementation(async callback => {
            const staged = { ...state };
            // Real trigger coverage is in freshnessMigration.test.ts.
            const write = async () => { events.push('write'); staged.changed = true; staged.dirty = true; if (fail) throw new Error('source unavailable'); return { id: 's' }; };
            const result = await callback({ $queryRaw: async () => { events.push('lock'); }, supplier: { update: write, delete: write } });
            state = staged; return result;
        });
        const app = Fastify(); await app.register(supplierRoutes);
        try {
            const request = { method, url: '/suppliers/s', ...(method === 'PUT' ? { payload: { leadTimeMin: 2, leadTimeMax: 4 } } : {}) };
            expect((await app.inject(request)).statusCode).toBe(500);
            expect(state).toEqual({ dirty: false, changed: false });
            fail = false;
            expect((await app.inject(request)).statusCode).toBe(200);
            expect(state).toEqual({ dirty: true, changed: true });
            expect(events).toEqual(['lock', 'write', 'lock', 'write']);
        } finally { await app.close(); }
    });
});

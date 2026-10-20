import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pool: vi.fn(), adapter: vi.fn(), client: vi.fn() }));
vi.mock('pg', () => ({ Pool: class { constructor(config: unknown) { mocks.pool(config); } } }));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class { constructor(pool: unknown, options: unknown) { mocks.adapter(pool, options); } } }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor(config: unknown) { mocks.client(config); } } }));
import { createPrismaClient } from './prisma';
describe('standalone Prisma clients', () => {
    it('makes the adapter dispose its externally supplied script pool on disconnect', () => {
        createPrismaClient();
        expect(mocks.adapter).toHaveBeenCalledWith(expect.any(Object), { disposeExternalPool: true });
        expect(mocks.client).toHaveBeenCalledWith({ adapter: expect.any(Object) });
    });
});

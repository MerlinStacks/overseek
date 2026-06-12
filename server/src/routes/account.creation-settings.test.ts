import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
    platformSettings: {
        findUnique: vi.fn(),
    },
    user: {
        findUnique: vi.fn(),
    },
}));

vi.mock('../utils/prisma', () => ({ prisma: prismaMock }));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
    },
}));

vi.mock('../services/GoldPriceService', () => ({
    GoldPriceService: { updateAccountPrices: vi.fn() },
}));

vi.mock('../services/tracking/CrawlerService', () => ({
    seedDefaultBlockRules: vi.fn(),
}));

import accountRoutes from './account';

describe('account creation platform setting', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        await app.register(accountRoutes, { prefix: '/api/accounts' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    it('rejects non-super-admin account creation when disabled', async () => {
        prismaMock.platformSettings.findUnique.mockResolvedValue({ accountCreationEnabled: false });
        prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false });

        const res = await app.inject({
            method: 'POST',
            url: '/api/accounts',
            payload: {},
        });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'New account creation is currently disabled.' });
    });

    it('allows super admins past the disabled setting', async () => {
        prismaMock.platformSettings.findUnique.mockResolvedValue({ accountCreationEnabled: false });
        prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true });

        const res = await app.inject({
            method: 'POST',
            url: '/api/accounts',
            payload: {},
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Missing required fields' });
    });
});

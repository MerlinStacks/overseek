import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMembership: vi.fn(),
    forAccount: vi.fn(),
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        accountUser: { findUnique: mocks.findMembership },
    },
}));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
    },
}));

vi.mock('../services/woo', () => ({
    WooService: class {
        static forAccount = mocks.forAccount;
    },
}));

vi.mock('../services/GoldPriceService', () => ({
    GoldPriceService: { updateAccountPrices: vi.fn() },
}));

vi.mock('../services/tracking/CrawlerService', () => ({
    seedDefaultBlockRules: vi.fn(),
}));

import accountRoutes from './account';

describe('account route security', () => {
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

    it('rejects WooCommerce settings sync for a foreign account', async () => {
        mocks.findMembership.mockResolvedValue(null);

        const response = await app.inject({
            method: 'POST',
            url: '/api/accounts/foreign-account/sync-settings',
        });

        expect(response.statusCode).toBe(403);
        expect(mocks.forAccount).not.toHaveBeenCalled();
    });
});

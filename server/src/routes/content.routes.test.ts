import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWooPageFindFirst } = vi.hoisted(() => ({
    mockWooPageFindFirst: vi.fn(),
}));

const { mockWooBlogPostFindFirst } = vi.hoisted(() => ({
    mockWooBlogPostFindFirst: vi.fn(),
}));

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = 'acct-1';
    },
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        wooPage: {
            findFirst: mockWooPageFindFirst,
        },
        wooBlogPost: {
            findFirst: mockWooBlogPostFindFirst,
        },
    },
}));

import contentRoutes from './content';

describe('content routes id lookup', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(contentRoutes, { prefix: '/api/content' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('loads page details by UUID id', async () => {
        mockWooPageFindFirst.mockResolvedValueOnce({ id: 'uuid-1', title: 'Page A' });

        const res = await app.inject({
            method: 'GET',
            url: '/api/content/pages/0f5ce436-fb3d-4067-8a8e-6ceff4f5d113',
        });

        expect(res.statusCode).toBe(200);
        expect(mockWooPageFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: '0f5ce436-fb3d-4067-8a8e-6ceff4f5d113',
                    accountId: 'acct-1',
                },
            })
        );
    });

    it('loads page details by numeric Woo id', async () => {
        mockWooPageFindFirst.mockResolvedValueOnce({ id: 'uuid-2', wooId: 12345, title: 'Page B' });

        const res = await app.inject({
            method: 'GET',
            url: '/api/content/pages/12345',
        });

        expect(res.statusCode).toBe(200);
        expect(mockWooPageFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    accountId: 'acct-1',
                    OR: [{ id: '12345' }, { wooId: 12345 }],
                },
            })
        );
    });

    it('loads post details by UUID id', async () => {
        mockWooBlogPostFindFirst.mockResolvedValueOnce({ id: 'uuid-3', title: 'Post A' });

        const res = await app.inject({
            method: 'GET',
            url: '/api/content/posts/73db65af-d24e-423c-9000-a391573b3321',
        });

        expect(res.statusCode).toBe(200);
        expect(mockWooBlogPostFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: '73db65af-d24e-423c-9000-a391573b3321',
                    accountId: 'acct-1',
                },
            })
        );
    });

    it('loads post details by numeric Woo id', async () => {
        mockWooBlogPostFindFirst.mockResolvedValueOnce({ id: 'uuid-4', wooId: 9876, title: 'Post B' });

        const res = await app.inject({
            method: 'GET',
            url: '/api/content/posts/9876',
        });

        expect(res.statusCode).toBe(200);
        expect(mockWooBlogPostFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    accountId: 'acct-1',
                    OR: [{ id: '9876' }, { wooId: 9876 }],
                },
            })
        );
    });
});

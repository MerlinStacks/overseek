import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockIsAccountFeatureEnabled,
    mockPrisma,
    mockGenerateSuggestions,
} = vi.hoisted(() => ({
    mockIsAccountFeatureEnabled: vi.fn(),
    mockPrisma: {
        searchConsoleAccount: { count: vi.fn() },
        adAccount: { count: vi.fn() },
        recommendationLog: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
            update: vi.fn(),
        },
    },
    mockGenerateSuggestions: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = request.headers['x-account-id'] || null;
    },
}));

vi.mock('../utils/accountFeatures', () => ({
    isAccountFeatureEnabled: (...args: any[]) => mockIsAccountFeatureEnabled(...args),
}));

vi.mock('../utils/prisma', () => ({ prisma: mockPrisma }));

vi.mock('../services/ai/AiManagerService', () => ({
    AiManagerService: {
        generateSuggestions: (...args: any[]) => mockGenerateSuggestions(...args),
    }
}));

import aiManagerRoutes from './aiManager';

describe('aiManager routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(aiManagerRoutes, { prefix: '/api/ai-manager' });
        await app.ready();

        mockIsAccountFeatureEnabled.mockResolvedValue(true);
        mockPrisma.searchConsoleAccount.count.mockResolvedValue(1);
        mockPrisma.adAccount.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
        mockPrisma.recommendationLog.findMany.mockResolvedValue([]);
        mockPrisma.recommendationLog.findFirst.mockResolvedValue({ id: 'rec-1' });
        mockPrisma.recommendationLog.update.mockResolvedValue({ id: 'rec-1' });
        mockGenerateSuggestions.mockResolvedValue({ created: 3 });
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('returns source health when feature enabled', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/ai-manager/health',
            headers: { 'x-account-id': 'acc-1' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.searchConsoleConnected).toBe(true);
        expect(body.googleAdsConnected).toBe(true);
        expect(body.metaAdsConnected).toBe(true);
    });

    it('blocks access when feature disabled', async () => {
        mockIsAccountFeatureEnabled.mockResolvedValue(false);

        const res = await app.inject({
            method: 'GET',
            url: '/api/ai-manager/suggestions',
            headers: { 'x-account-id': 'acc-1' },
        });

        expect(res.statusCode).toBe(403);
    });

    it('refreshes suggestions', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/ai-manager/suggestions/refresh',
            headers: { 'x-account-id': 'acc-1' },
        });

        expect(res.statusCode).toBe(200);
        expect(mockGenerateSuggestions).toHaveBeenCalledWith('acc-1');
        expect(res.json()).toEqual({ created: 3 });
    });

    it('updates suggestion status for account-scoped record', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/ai-manager/suggestions/rec-1/status',
            headers: { 'x-account-id': 'acc-1' },
            payload: { status: 'dismissed' },
        });

        expect(res.statusCode).toBe(200);
        expect(mockPrisma.recommendationLog.findFirst).toHaveBeenCalled();
        expect(mockPrisma.recommendationLog.update).toHaveBeenCalled();
    });
});

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetAutomationEnabled } = vi.hoisted(() => ({
    mockSetAutomationEnabled: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1', accountId: 'acct-1' };
    },
}));

vi.mock('../services/MarketingService', () => {
    class MarketingService {
        listCampaigns = vi.fn();
        createCampaign = vi.fn();
        getCampaign = vi.fn();
        updateCampaign = vi.fn();
        deleteCampaign = vi.fn();
        sendTestEmail = vi.fn();
        listAutomations = vi.fn();
        upsertAutomation = vi.fn();
        getAutomation = vi.fn();
        setAutomationEnabled = mockSetAutomationEnabled;
        getAutomationAnalytics = vi.fn();
        listAutomationEnrollments = vi.fn();
        listAutomationRunEvents = vi.fn();
        deleteAutomation = vi.fn();
        listTemplates = vi.fn();
        upsertTemplate = vi.fn();
        deleteTemplate = vi.fn();
    }

    return { MarketingService };
});

vi.mock('../services/CartRecoveryService', () => ({
    cartRecoveryService: {
        verifyToken: vi.fn(),
        getRecoveryDetails: vi.fn(),
    },
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        emailAccount: { findFirst: vi.fn() },
    },
}));

import marketingRoutes from './marketing';

describe('marketing automation status route', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(marketingRoutes, { prefix: '/api/marketing' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('updates automation status when payload is valid', async () => {
        mockSetAutomationEnabled.mockResolvedValueOnce({
            id: 'auto-1',
            isActive: true,
            status: 'ACTIVE',
        });

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/auto-1/status',
            payload: { isActive: true },
        });

        expect(res.statusCode).toBe(200);
        expect(mockSetAutomationEnabled).toHaveBeenCalledWith('auto-1', 'acct-1', true);
    });

    it('returns 400 when isActive is missing', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/auto-1/status',
            payload: {},
        });

        expect(res.statusCode).toBe(400);
        expect(mockSetAutomationEnabled).not.toHaveBeenCalled();
    });

    it('returns 404 when automation does not exist', async () => {
        mockSetAutomationEnabled.mockRejectedValueOnce(new Error('Automation not found'));

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/missing/status',
            payload: { isActive: false },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Automation not found' });
    });
});

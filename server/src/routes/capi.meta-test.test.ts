import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({ prisma: {
    accountFeature: { findUnique: vi.fn() },
    conversionDelivery: { findFirst: vi.fn() },
} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'acct-1'; } }));
vi.mock('../services/StorefrontConfigSync', () => ({ syncStorefrontConfigToWoo: vi.fn() }));
vi.mock('../services/tracking/ConversionForwarder', () => ({ ConversionForwarder: { forwardToPlatform: vi.fn() } }));
vi.mock('../utils/capiConfig', () => ({
    decryptCapiConfig: (config: unknown) => config,
    maskCapiConfig: vi.fn(), prepareCapiConfigForStorage: vi.fn(), redactCapiText: vi.fn(), validateCapiConfig: vi.fn(),
}));

import { prisma } from '../utils/prisma';
import { ConversionForwarder } from '../services/tracking/ConversionForwarder';
import capiRoutes from './capi';

describe('Meta connection tests', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        await app.register(capiRoutes, { prefix: '/api/capi' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it.each([undefined, '', '   '])('blocks synthetic purchases without a test-event code (%s)', async testEventCode => {
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue({
            isEnabled: true, config: { pixelId: '123', accessToken: 'token', testEventCode },
        } as any);
        const res = await app.inject({ method: 'POST', url: '/api/capi/test/meta' });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('Test Event Code');
        expect(ConversionForwarder.forwardToPlatform).not.toHaveBeenCalled();
    });

    it('forwards test purchases only with the configured test-event code', async () => {
        const config = { pixelId: '123', accessToken: 'token', testEventCode: 'TEST123' };
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue({ isEnabled: true, config } as any);
        vi.mocked(prisma.conversionDelivery.findFirst).mockResolvedValue({ status: 'SENT' } as any);
        const res = await app.inject({ method: 'POST', url: '/api/capi/test/meta' });
        expect(res.statusCode).toBe(200);
        expect(ConversionForwarder.forwardToPlatform).toHaveBeenCalledWith(
            'META', 'acct-1', config, expect.objectContaining({ type: 'purchase' }), null,
        );
    });
});

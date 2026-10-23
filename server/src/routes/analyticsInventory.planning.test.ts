import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ forecast: vi.fn(), alerts: vi.fn(), detail: vi.fn(), error: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: mocks.error } }));
vi.mock('../services/InventoryService', () => ({ InventoryService: {} }));
vi.mock('../services/analytics/InventoryForecastService', () => ({ InventoryForecastService: {
    getSkuForecasts: mocks.forecast, getStockoutAlerts: mocks.alerts, getSkuForecastDetail: mocks.detail,
} }));
import routes from './analyticsInventory';
import { BOMForecastCycleError, BOMForecastDataError } from '../services/analytics/inventory-forecast/errors';

describe('cyclic inventory planning responses', () => {
    it.each(['/sku-forecasts', '/stockout-alerts', '/sku-forecasts/123'])('returns an explicit conflict, not false empty data or HTTP 500: %s', async url => {
        vi.resetAllMocks();
        for (const mock of [mocks.forecast, mocks.alerts, mocks.detail]) mock.mockRejectedValue(new BOMForecastCycleError());
        const app = Fastify();
        await app.register(routes);
        try {
            const response = await app.inject({ url });
            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({ code: 'BOM_CYCLE_DETECTED', error: expect.stringContaining('cyclic') });
            expect(mocks.error).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });
    it.each(['/sku-forecasts', '/stockout-alerts', '/sku-forecasts/123'])('reports invalid active references as a repairable conflict without error-log flooding: %s', async url => {
        vi.resetAllMocks();
        for (const mock of [mocks.forecast, mocks.alerts, mocks.detail]) mock.mockRejectedValue(new BOMForecastDataError('BOM component unresolved'));
        const app = Fastify(); await app.register(routes);
        try {
            const response = await app.inject({ url });
            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({ code: 'BOM_FORECAST_INVALID', error: 'BOM component unresolved' });
            expect(mocks.error).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
});

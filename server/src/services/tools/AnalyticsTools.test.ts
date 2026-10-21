import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ orders: vi.fn(), customers: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { findMany: m.orders }, wooCustomer: { findMany: m.customers } } }));
vi.mock('../AnalyticsService', () => ({ AnalyticsService: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { AnalyticsTools } from './AnalyticsTools';
beforeEach(() => { vi.resetAllMocks(); m.customers.mockResolvedValue([]); });
describe('truthful analytics tools', () => {
    it('does not label recently active high spenders at risk', async () => {
        m.orders.mockResolvedValue([{ wooCustomerId: 1, total: 600, currency: 'AUD', dateCreated: new Date(), rawData: {} }]);
        expect(await AnalyticsTools.analyzeCustomerSegments('tenant', 'at_risk')).toMatchObject({ customers: [], currency: 'AUD' });
    });
    it('forecasts from 30 complete days including zero-sale days without invented confidence', async () => {
        const end = new Date(); end.setUTCHours(0, 0, 0, 0);
        m.orders.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ dateCreated: new Date(end.getTime() - (30 - index) * 86400000), total: 30, currency: 'AUD' })));
        const result = await AnalyticsTools.forecastSales('tenant'); expect(result).toMatchObject({ forecast_next_7_days: '35.00', currency: 'AUD', confidence: expect.stringContaining('Unvalidated') });
    });
    it('refuses mixed-currency or truncated history rather than aggregating it', async () => {
        m.orders.mockResolvedValue([{ currency: 'AUD' }, { currency: 'USD' }]); expect(await AnalyticsTools.forecastSales('tenant')).toBe('Failed to generate forecast.');
    });
});

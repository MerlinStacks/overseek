import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ currencies: vi.fn(), count: vi.fn(), sessions: vi.fn(), sales: vi.fn(), products: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { groupBy: m.currencies }, wooCustomer: { count: m.count }, analyticsSession: { groupBy: m.sessions, count: m.count } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./sales', () => ({ SalesAnalytics: { getTotalSales: m.sales, getTopProducts: m.products } }));
import { DigestReportService as service } from './DigestReportService';
beforeEach(() => { vi.resetAllMocks(); m.currencies.mockResolvedValue([{ currency: 'AUD' }]); m.count.mockResolvedValue(2); m.sales.mockResolvedValue({ total: 10, count: 1 }); m.products.mockResolvedValue([{ name: '<img>', quantity: 1 }]); m.sessions.mockResolvedValue([{ utmSource: '<script>', _count: { id: 3 } }]); });
describe('truthful digest metrics and rendering', () => {
    it('exposes unavailable attribution revenue and labels import-date counts', async () => {
        const data = await service.generateDailyDigest('tenant', new Date('2026-10-01')); expect(data.topProducts[0].revenue).toBeNull(); expect(data.topSources[0].revenue).toBeNull();
        const html = service.generateHtml(data, 'AUD'); expect(html).toContain('Customer records added locally'); expect(html).toContain('&lt;img&gt;'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    });
    it('rejects mixed currency totals and missing currency labels', async () => {
        m.currencies.mockResolvedValue([{ currency: 'AUD' }, { currency: 'USD' }]); await expect(service.generateDailyDigest('tenant')).rejects.toThrow('mixed');
        expect(() => service.generateHtml({} as any)).toThrow('currency');
    });
});

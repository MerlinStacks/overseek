import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ schedule: vi.fn(), update: vi.fn(), sender: vi.fn(), send: vi.fn(), report: vi.fn(), daily: vi.fn(), html: vi.fn(), currencies: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { reportSchedule: { findFirst: m.schedule, updateMany: m.update }, wooOrder: { groupBy: m.currencies } } }));
vi.mock('../../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: m.sender }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../EmailService', () => ({ EmailService: class { sendEmail = m.send; } }));
vi.mock('./sales', () => ({ SalesAnalytics: { getCustomReport: m.report } }));
vi.mock('./DigestReportService', () => ({ DigestReportService: { generateDailyDigest: m.daily, generateHtml: m.html } }));
import { ReportWorker as service } from './ReportWorker';
const job = { data: { scheduleId: 'schedule', accountId: 'tenant', runAt: '2026-10-01T09:00:00Z' } } as any;
const schedule = () => ({ id: 'schedule', accountId: 'tenant', isActive: true, account: { id: 'tenant', currency: 'AUD' }, emailRecipients: ['a@test.example'], reportType: 'CUSTOM', template: { accountId: 'tenant', name: '<img src=x>', config: { dateRange: 'yesterday', dimension: 'day', metrics: ['sales'] } } });
beforeEach(() => { vi.resetAllMocks(); m.currencies.mockResolvedValue([{ currency: 'AUD' }]); m.schedule.mockResolvedValue(schedule()); m.sender.mockResolvedValue({ id: 'sender', accountId: 'tenant' }); m.report.mockResolvedValue([{ dimension: '<script>', sales: 12 }]); m.send.mockResolvedValue({ messageId: 'sent' }); });
describe('account-bound, idempotent report delivery', () => {
    it('binds schedule lookup to account and rejects foreign templates before generation', async () => {
        m.schedule.mockResolvedValue({ ...schedule(), template: { accountId: 'foreign' } }); await expect(service.process(job)).rejects.toThrow('ownership'); expect(m.report).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled(); expect(m.schedule.mock.calls[0][0].where).toEqual({ id: 'schedule', accountId: 'tenant' });
    });
    it('uses stable occurrence/recipient idempotency and escaped currency-aware HTML', async () => {
        await service.process(job); await service.process(job);
        expect(m.send.mock.calls[0][6]).toEqual(m.send.mock.calls[1][6]); expect(m.send.mock.calls[0][6].idempotencyKey).toMatch(/^report-/);
        const html = m.send.mock.calls[0][4]; expect(html).toContain('&lt;img'); expect(html).not.toContain('<script>'); expect(html).toContain('A$');
        expect(m.update.mock.invocationCallOrder[0]).toBeGreaterThan(m.send.mock.invocationCallOrder[0]);
        expect(m.report.mock.calls[0][1]).toMatchObject({ startDate: expect.stringContaining('2026-09-30'), endDate: expect.stringContaining('2026-09-30') });
    });
    it('does not mark skipped or failed deliveries as a successful schedule run', async () => {
        m.send.mockResolvedValue({ skipped: true }); await expect(service.process(job)).rejects.toThrow('not confirmed'); expect(m.update).not.toHaveBeenCalled();
    });
    it('rejects invalid run identities and foreign senders', async () => {
        await expect(service.process({ data: { accountId: 'tenant', scheduleId: 'schedule' } } as any)).rejects.toThrow();
        m.sender.mockResolvedValue({ id: 'sender', accountId: 'foreign' }); await expect(service.process(job)).rejects.toThrow('sender'); expect(m.send).not.toHaveBeenCalled();
    });
    it('rejects mismatched monetary currencies before generating or sending totals', async () => {
        m.currencies.mockResolvedValue([{ currency: 'USD' }]); await expect(service.process(job)).rejects.toThrow('currency'); expect(m.report).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
    });
});

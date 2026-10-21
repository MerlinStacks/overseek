import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ api: { request } }));
import { AnalyticsService as service } from './AnalyticsService';
const payload = { metrics: ['sales'], dimension: 'day', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-20') };
beforeEach(() => vi.resetAllMocks());
describe('account report service', () => {
    it('refuses missing scope before making a request', async () => { await expect(service.generateReport('', 'a', payload)).rejects.toThrow(); expect(request).not.toHaveBeenCalled(); });
    it('forwards cancellation and validates reported metrics', async () => {
        request.mockResolvedValueOnce([{ dimension: 'today', sales: 'bad' }]).mockResolvedValueOnce([{ dimension: 'today', sales: 0 }]); const signal = new AbortController().signal;
        await expect(service.generateReport('token', 'a', payload, { signal })).rejects.toThrow('Invalid report'); await expect(service.generateReport('token', 'a', payload, { signal })).resolves.toEqual([{ dimension: 'today', sales: 0 }]); expect(request.mock.calls[0][1]).toMatchObject({ token: 'token', accountId: 'a', signal });
    });
    it('rejects malformed template and schedule confirmations', async () => {
        request.mockResolvedValue({}); await expect(service.saveTemplate('token', 'a', { name: 'Report', config: {} })).rejects.toThrow('Invalid template'); await expect(service.createSchedule('token', 'a', { templateId: 't', frequency: 'DAILY', time: '09:00', emailRecipients: ['a@test'] })).rejects.toThrow('Invalid schedule');
    });
});

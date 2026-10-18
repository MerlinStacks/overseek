import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ add: vi.fn(), repeats: vi.fn(), remove: vi.fn() }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { createQueue: () => ({ add: mocks.add, getRepeatableJobs: mocks.repeats, removeRepeatableByKey: mocks.remove }) } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn() } }));
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../AutomationEngine', () => ({ automationEngine: {} }));
import { MarketingScheduler } from './MarketingScheduler';

describe('Advertising audience schedule upgrade', () => {
    it('replaces the old hourly repeat without removing unrelated jobs', async () => {
        mocks.repeats.mockResolvedValue([{ name: 'refresh-ad-audiences', key: 'old-hourly' }, { name: 'unrelated', key: 'leave-me' }]);
        await MarketingScheduler.register();
        expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('old-hourly');
        expect(mocks.add).toHaveBeenCalledWith('refresh-ad-audiences', {}, { repeat: { pattern: '*/5 * * * *' }, jobId: 'refresh-ad-audiences-5m' });
    });
});

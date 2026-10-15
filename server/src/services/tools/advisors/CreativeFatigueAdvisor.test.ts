import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processCreativeFatigue } from './CreativeFatigueAdvisor';
import { fetchAllMetaRows } from '../../ads/MetaAdsService';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { adAccount: { findMany } } }));
vi.mock('../../ads/MetaAdsService', async original => ({ ...await original<typeof import('../../ads/MetaAdsService')>(), fetchAllMetaRows: vi.fn() }));

describe('Global creative fatigue advisor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
        findMany.mockResolvedValue([{ id: 'connected', name: 'Meta account', externalId: '123', accessToken: 'secret' }]);
    });
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    it('uses current paginated insights, not obsolete ad fields or age-only fatigue', async () => {
        vi.mocked(fetchAllMetaRows).mockImplementation(async url => {
            const parsed = new URL(url);
            expect(parsed.pathname).toBe('/v24.0/act_123/insights');
            const period = JSON.parse(parsed.searchParams.get('time_range')!);
            return [{ ad_id: '1', ad_name: 'Product ad', spend: 100, impressions: 2000, clicks: period.until === '2026-10-14' ? 60 : 100, frequency: 4 }];
        });
        const suggestions: string[] = [];
        await processCreativeFatigue('tenant', suggestions);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toContain('Potential Creative Fatigue');
        expect(suggestions[0]).toContain('heuristic, not proof');
    });

    it('does not issue a fatigue alert for high frequency without deteriorating performance', async () => {
        vi.mocked(fetchAllMetaRows).mockResolvedValue([{ ad_id: '1', spend: 100, impressions: 2000, clicks: 100, frequency: 8 }]);
        const suggestions: string[] = [];
        await processCreativeFatigue('tenant', suggestions);
        expect(suggestions).toEqual([]);
    });
});

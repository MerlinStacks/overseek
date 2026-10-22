import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: vi.fn(), events: vi.fn(), event: vi.fn(), create: vi.fn(), orders: vi.fn(), lock: vi.fn(), save: vi.fn(), transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: m.account }, analyticsEvent: { findMany: m.events }, wooOrder: { findMany: m.orders }, $transaction: m.transaction } }));
import { ABTestingService } from './abtesting';
const id = '11111111-1111-4111-8111-111111111111';
const config = (patch = {}) => ({ id, accountId: 'tenant', name: 'Experiment', description: '', variantNames: ['Control', 'Treatment'], status: 'completed', conversionEvent: 'purchase', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-10'), startedAt: new Date('2026-01-02'), completedAt: new Date('2026-01-10'), ...patch });
const exposure = (variant = 'Control', at = '2026-01-03') => ({ id: `e-${variant}`, createdAt: new Date(at), session: { visitorId: 'visitor' }, payload: { experimentId: id, variant, visitorId: 'visitor' } });
const purchase = () => ({ id: 'purchase', createdAt: new Date('2026-01-05'), session: { visitorId: 'visitor' }, payload: { orderId: '1', total: '9999' } });
beforeEach(() => {
    vi.resetAllMocks(); m.account.mockResolvedValue({ appearance: { theme: 'dark', ab_experiments: { [id]: config() } } });
    m.events.mockImplementation(async ({ where }) => where.type === 'experiment_exposure' ? [exposure()] : [purchase(), purchase()]);
    m.orders.mockResolvedValue([{ wooId: 1, total: 10, currency: 'AUD', dateCreated: new Date('2026-01-05'), status: 'completed' }]);
    m.transaction.mockImplementation(task => task({ $queryRaw: m.lock, $executeRaw: m.save, account: { findUnique: m.account }, analyticsEvent: { findFirst: m.event, create: m.create }, analyticsSession: { findFirst: vi.fn().mockResolvedValue({ id: 'session' }) } }));
});
describe('stable, windowed experiment observations', () => {
    it('deduplicates by order ID and uses authoritative account-bound revenue instead of raw payload totals', async () => {
        const result = await new ABTestingService().getExperimentResults('tenant', id); expect(result).toMatchObject({ currency: 'AUD', totalImpressions: 1, totalConversions: 1 }); expect(result.variants[0].revenue).toBe(10);
        expect(m.orders.mock.calls[0][0].where).toEqual({ accountId: 'tenant', wooId: { in: [1] } });
    });
    it('does not attribute orders placed before exposure and excludes cross-variant contamination', async () => {
        m.orders.mockResolvedValue([{ wooId: 1, total: 10, currency: 'AUD', dateCreated: new Date('2026-01-01'), status: 'completed' }]); expect((await new ABTestingService().getExperimentResults('tenant', id)).totalConversions).toBe(0);
        m.events.mockImplementation(async ({ where }) => where.type === 'experiment_exposure' ? [exposure(), exposure('Treatment', '2026-01-04')] : [purchase()]);
        expect(await new ABTestingService().getExperimentResults('tenant', id)).toMatchObject({ totalImpressions: 0, excludedContaminatedVisitors: 1 });
    });
    it('exposes missing authoritative order coverage and unknown legacy windows', async () => {
        m.orders.mockResolvedValue([]); await expect(new ABTestingService().getExperimentResults('tenant', id)).rejects.toThrow('coverage');
        m.account.mockResolvedValue({ appearance: { ab_experiments: { [id]: config({ startedAt: undefined }) } } }); await expect(new ABTestingService().getExperimentResults('tenant', id)).rejects.toThrow('window');
    });
    it('serializes exposure assignment and rejects conflicting reassignment', async () => {
        m.account.mockResolvedValue({ appearance: { ab_experiments: { [id]: config({ status: 'running', completedAt: undefined }) } } }); m.event.mockResolvedValue(exposure());
        await new ABTestingService().trackExposure('tenant', id, 'Control', 'visitor'); expect(m.create).not.toHaveBeenCalled(); expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.event.mock.invocationCallOrder[0]);
        await expect(new ABTestingService().trackExposure('tenant', id, 'Treatment', 'visitor')).rejects.toThrow('already assigned');
    });
    it('validates variant configuration and atomically edits only its appearance namespace', async () => {
        const service = new ABTestingService(); await expect(service.createExperiment('tenant', 'Name', '', ['Same', 'Same'])).rejects.toThrow();
        await service.createExperiment('tenant', 'Name', '', ['A', 'B']); expect(m.save).toHaveBeenCalledOnce(); expect(m.save.mock.calls[0][0].join(' ')).toContain('jsonb_set'); expect(m.save.mock.calls[0][0].join(' ')).toContain('ab_experiments');
    });
});
describe('predefined experiment comparisons without invented certainty', () => {
    it('uses the first configured control with corrected comparisons, never selected best vs worst', async () => {
        const service = new ABTestingService(); vi.spyOn(service, 'getExperimentResults').mockResolvedValue({ experiment: config(), variants: [{ variant: 'Control', impressions: 1000, conversions: 100 }, { variant: 'Treatment', impressions: 1000, conversions: 200 }, { variant: 'Third', impressions: 1000, conversions: 50 }] } as any);
        const result = await service.getStatisticalSignificance('tenant', id); expect(result.comparisons.map(row => row.control)).toEqual(['Control', 'Control']); expect(result.confidenceLevel).toBeNull(); expect(result.mde).toBeNull();
    });
    it('reports insufficient observations with null estimates, not non-finite or manufactured confidence', async () => {
        const service = new ABTestingService(); vi.spyOn(service, 'getExperimentResults').mockResolvedValue({ experiment: config(), variants: ['Control', 'Treatment'].map(variant => ({ variant, impressions: 0, conversions: 0 })) } as any);
        expect(await service.getStatisticalSignificance('tenant', id)).toMatchObject({ pValue: null, confidenceLevel: null, mde: null, isSignificant: false, sampleSizeSufficient: false });
    });
});

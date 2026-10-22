import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accounts: vi.fn(), campaigns: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(), emit: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { adAccount: { findMany: m.accounts }, adAlert: { createMany: m.create, findMany: m.find, updateMany: m.update } } }));
vi.mock('../events', () => ({ EventBus: { emit: m.emit }, EVENTS: { AD: { ALERT: 'ad-alert' } } }));
vi.mock('../ads', () => ({ AdsService: { getGoogleCampaignInsights: m.campaigns, getMetaCampaignInsights: m.campaigns } }));
import { AdAlertService } from './AdAlertService';
const row = { campaignId: 'same', campaignName: 'Campaign', dateStart: '2026-10-19', dateStop: '2026-10-21', currency: 'AUD', spend: 10, conversions: 0, clicks: 2, impressions: 100 };
beforeEach(() => { vi.clearAllMocks(); m.accounts.mockResolvedValue([{ id: 'ad1', platform: 'GOOGLE' }, { id: 'ad2', platform: 'META' }]); m.campaigns.mockResolvedValue([row]); m.find.mockResolvedValue([]); m.update.mockResolvedValue({ count: 1 }); });
it('keeps account/platform/window occurrence identity and does not emit during detection', async () => {
    const first = await AdAlertService.checkForAlerts('a'), second = await AdAlertService.checkForAlerts('a'); expect(first.alerts).toHaveLength(2); expect(first.alerts[0].id).not.toBe(first.alerts[1].id); expect(first.alerts[0].id).toBe(second.alerts[0].id); expect(first.alerts[0].message).toContain('AUD'); expect(m.emit).not.toHaveBeenCalled(); expect(first.coverage.unavailableChecks).toHaveLength(3);
});
it('discloses provider failures and rejects malformed thresholds', async () => {
    m.campaigns.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([row]); expect((await AdAlertService.checkForAlerts('a')).coverage).toMatchObject({ expected: 2, observed: 1, complete: false }); await expect(AdAlertService.checkForAlerts('a', { conversionZeroDays: -1 })).rejects.toThrow(); await expect(AdAlertService.getRecentAlerts('a', 100000)).rejects.toThrow();
});
it('stores stable unique occurrences and claims dispatch only once without claiming delivery', async () => {
    const detection = await AdAlertService.checkForAlerts('a'); await AdAlertService.persistAndDispatch('a', detection.alerts); expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    m.find.mockResolvedValue([{ ...detection.alerts[0], severity: 'critical' }]); m.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }); await AdAlertService.sendCriticalAlerts('a'); expect(m.emit).toHaveBeenCalledOnce(); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { notificationStatus: 'dispatched-unconfirmed' } }));
    m.update.mockResolvedValue({ count: 0 }); await AdAlertService.sendCriticalAlerts('a'); expect(m.emit).toHaveBeenCalledOnce();
});

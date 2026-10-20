import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getRows: vi.fn(), sync: vi.fn(), get: vi.fn(), set: vi.fn(), aside: vi.fn() }));
vi.mock('./feedMapping', () => ({ FeedMappingService: { getFeedRows: mocks.getRows } }));
vi.mock('../utils/prisma', () => ({ prisma: { syncState: { findUnique: mocks.sync } } }));
vi.mock('../utils/cache', () => ({ cacheGet: mocks.get, cacheSet: mocks.set, cacheAside: mocks.aside }));
import { getFeedHealth, recordFeedExport } from './feedHealth';

describe('feed health persistence', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.aside.mockImplementation(async (_key, loader) => loader());
        mocks.get.mockResolvedValue(null);
        mocks.sync.mockResolvedValue({ lastSyncedAt: new Date('2026-10-20T00:00:00Z') });
        mocks.getRows.mockResolvedValue({ health: { included: 3, excluded: 2, errors: 1, warnings: 0 } });
    });
    it('scopes all health/cache/sync queries to account, channel and variation mode', async () => {
        const result = await getFeedHealth('account-2', 'google', 'first_variation');
        expect(mocks.getRows).toHaveBeenCalledWith('account-2', 'google', 1, 0, '', 'first_variation', undefined, true);
        expect(mocks.aside).toHaveBeenCalledWith('account-2:google:first_variation', expect.any(Function), { namespace: 'feed-health-v1', ttl: 60 });
        expect(mocks.sync).toHaveBeenCalledWith({ where: { accountId_entityType: { accountId: 'account-2', entityType: 'products' } }, select: { lastSyncedAt: true } });
        expect(result).toMatchObject({ included: 3, excluded: 2, platformAcceptance: 'not_verified', lastAttempt: null });
    });
    it('records success and failure separately without raw errors or tokens', async () => {
        await recordFeedExport('account-1', 'meta', 'all_variations', true);
        expect(mocks.set).toHaveBeenCalledWith('account-1:meta:all_variations:success', expect.objectContaining({ status: 'generated' }), expect.objectContaining({ ttl: 30 * 86400 }));
        mocks.set.mockClear();
        await recordFeedExport('account-1', 'meta', 'all_variations', false);
        expect(mocks.set).toHaveBeenCalledWith('account-1:meta:all_variations:failure', expect.objectContaining({ status: 'failed', message: 'Feed generation failed. Check API logs for details.' }), expect.any(Object));
        expect(mocks.set).not.toHaveBeenCalledWith(expect.stringContaining(':success'), expect.anything(), expect.anything());
    });
    it('coalesces concurrent scans and cleans up failed in-flight work', async () => {
        mocks.getRows.mockRejectedValueOnce(new Error('scan failed'));
        await expect(getFeedHealth('account-1', 'google', 'all_variations')).rejects.toThrow('scan failed');
        mocks.getRows.mockResolvedValue({ health: { included: 1 } });
        const results = await Promise.all([getFeedHealth('account-1', 'google', 'all_variations'), getFeedHealth('account-1', 'google', 'all_variations')]);
        expect(results.map((result) => result.included)).toEqual([1, 1]);
        expect(mocks.getRows).toHaveBeenCalledTimes(2);
    });
});

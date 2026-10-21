import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: vi.fn(), keyword: vi.fn(), analytics: vi.fn(), fetch: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: m.account }, trackedKeyword: { findFirst: m.keyword } } }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
vi.mock('./SearchConsoleService', () => ({ SearchConsoleService: { getSearchAnalytics: m.analytics } }));
import { ContentBriefService as service } from './ContentBriefService';
beforeEach(() => { vi.resetAllMocks(); m.analytics.mockResolvedValue([]); m.account.mockResolvedValue({ openRouterApiKey: 'private-key' }); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => vi.unstubAllGlobals());
describe('validated, labelled content briefs', () => {
    it('labels absent search metrics and malformed AI fallbacks honestly', async () => {
        m.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"suggestedTitle": true}' } }] }) });
        const result = await service.generateBrief('tenant', ' keyword '); expect(result).toMatchObject({ keyword: 'keyword', currentClicks: null, currentImpressions: null, provenance: 'template', fallbackReason: 'generation-failed' }); expect(m.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
    it('labels a missing key fallback and bounds template lengths', async () => {
        m.account.mockResolvedValue(null); const result = await service.generateBrief('tenant', 'x'.repeat(200)); expect(result.provenance).toBe('template'); expect(result.brief.suggestedTitle.length).toBeLessThanOrEqual(60); expect(result.brief.metaDescription.length).toBeLessThanOrEqual(155); expect(m.fetch).not.toHaveBeenCalled();
    });
    it('rejects foreign tracked keyword IDs and invalid input before provider use', async () => {
        m.keyword.mockResolvedValue(null); await expect(service.generateBrief('tenant', 'keyword', 'foreign')).rejects.toThrow('not found'); expect(m.analytics).not.toHaveBeenCalled();
        await expect(service.generateBrief('tenant', ' ')).rejects.toThrow(); expect(m.fetch).not.toHaveBeenCalled();
    });
});

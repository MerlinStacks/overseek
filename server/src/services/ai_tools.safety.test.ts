import { afterEach, expect, it, vi } from 'vitest';
const tool = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('./tools/OrderTools', () => ({ OrderTools: { getRecentOrders: tool } }));
vi.mock('./tools/WooCommerceTools', () => ({ WooCommerceTools: { getStoreOverview: tool } }));
vi.mock('./tools/InventoryTools', () => ({ InventoryTools: {} })); vi.mock('./tools/SalesTools', () => ({ SalesTools: {} })); vi.mock('./tools/ProductTools', () => ({ ProductTools: {} })); vi.mock('./tools/CustomerTools', () => ({ CustomerTools: {} })); vi.mock('./tools/AdsTools', () => ({ AdsTools: {} })); vi.mock('./tools/AnalyticsTools', () => ({ AnalyticsTools: {} })); vi.mock('./tools/SearchConsoleTools', () => ({ SearchConsoleTools: {} })); vi.mock('./tools/SearchToAdsTools', () => ({ SearchToAdsTools: {} }));
vi.mock('../utils/logger', () => ({ Logger: { debug: vi.fn() } }));
import { AIToolsService } from './ai_tools';
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
it.each(['constructor', '__proto__', 'not_registered'])('rejects unregistered or inherited tool %s', async name => { await expect(AIToolsService.executeTool(name, {}, 'a')).rejects.toThrow(/Unknown/); expect(tool).not.toHaveBeenCalled(); });
it.each([{ limit: '12junk' }, { limit: 1.5 }, { limit: 21 }, { limit: Infinity }, { accountId: 'victim' }, { status: [] }])('rejects malformed tool arguments %j', async args => { await expect(AIToolsService.executeTool('get_recent_orders', args, 'a')).rejects.toThrow(/Invalid/); expect(tool).not.toHaveBeenCalled(); });
it('passes only validated arguments and the trusted caller account to handlers', async () => { await AIToolsService.executeTool('get_recent_orders', { limit: 10, status: 'completed' }, 'a'); expect(tool).toHaveBeenCalledWith('a', 10, 'completed'); await expect(AIToolsService.executeTool('get_store_overview', {}, '')).rejects.toThrow(/scope/); });
it('bounds the caller wait for a stalled read-only tool', async () => {
    vi.useFakeTimers(); tool.mockImplementationOnce(() => new Promise(() => {}));
    const pending = AIToolsService.executeTool('get_store_overview', {}, 'a'); const assertion = expect(pending).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(30001); await assertion;
});

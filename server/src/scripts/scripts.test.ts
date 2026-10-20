import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    accounts: vi.fn(), reviews: vi.fn(), count: vi.fn(), credentials: vi.fn(), create: vi.fn(), disconnect: vi.fn(), client: vi.fn(),
    search: vi.fn(), close: vi.fn(), keys: vi.fn(),
}));
vi.mock('../utils/prisma', () => ({ createPrismaClient: mocks.client }));
vi.mock('../utils/elastic', () => ({ esClient: { search: mocks.search, close: mocks.close } }));
vi.mock('web-push', () => ({ default: { generateVAPIDKeys: mocks.keys } }));
import { main as find } from './find-account';
import { main as list } from './list-accounts';
import { main as check } from './simple-check';
import { main as vapid } from './generate-vapid-keys';
import { main as review } from './inspect-review-data';
import { main as order } from './inspect-data';
import { runScript, ScriptUsageError } from './scriptUtils';
beforeEach(() => {
    vi.resetAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.client.mockReturnValue({ account: { findMany: mocks.accounts }, wooReview: { findFirst: mocks.reviews }, user: { count: mocks.count }, platformCredentials: { findUnique: mocks.credentials, create: mocks.create }, $disconnect: mocks.disconnect });
    mocks.accounts.mockResolvedValue([]); mocks.count.mockResolvedValue(1); mocks.disconnect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined); mocks.search.mockResolvedValue({ hits: { hits: [] } });
});
const initialExitCode = process.exitCode;
afterEach(() => { process.exitCode = initialExitCode; vi.restoreAllMocks(); });
describe('operational scripts (mocked services only)', () => {
    it('has no connection, query or credential-generation side effects on import', () => {
        expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.keys).not.toHaveBeenCalled();
    });
    it.each([[find, { id: true, name: true }], [list, { id: true, name: true, wooUrl: true }]] as const)('selects only account listing fields', async (script, select) => {
        await script(); expect(mocks.accounts).toHaveBeenCalledWith({ select, orderBy: { id: 'asc' } }); expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it.each([find, list, vapid])('awaits disconnection when a database query fails', async script => {
        mocks.accounts.mockRejectedValue(new Error('Failed')); mocks.credentials.mockRejectedValue(new Error('Failed'));
        await expect(script()).rejects.toThrow('Failed'); expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it.each([[1, 0], [0, 1]])('returns the proper user-check exit code for count %s after cleanup', async (count, code) => {
        mocks.count.mockResolvedValue(count); let released = false;
        mocks.disconnect.mockImplementation(async () => { await Promise.resolve(); released = true; });
        expect(await check()).toBe(code); expect(released).toBe(true);
    });
    it('returns user-check error code 2 after query failure and cleanup', async () => {
        mocks.count.mockRejectedValue(new Error('Failure')); expect(await check()).toBe(2); expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it('does not regenerate or expose existing VAPID credentials', async () => {
        mocks.credentials.mockResolvedValue({ id: 'existing' }); await vapid();
        expect(mocks.keys).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.credentials).toHaveBeenCalledWith({ where: { platform: 'WEB_PUSH_VAPID' }, select: { id: true } });
        expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it('stores a generated key pair without logging either key', async () => {
        mocks.credentials.mockResolvedValue(null); mocks.keys.mockReturnValue({ publicKey: 'PUBLIC_KEY_SECRET_TEST', privateKey: 'PRIVATE_KEY_SECRET_TEST' });
        await vapid(); expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ credentials: { publicKey: 'PUBLIC_KEY_SECRET_TEST', privateKey: 'PRIVATE_KEY_SECRET_TEST' } }) });
        expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('KEY_SECRET_TEST');
    });
    it('fails safely on concurrent VAPID insertion without overwriting credentials', async () => {
        mocks.credentials.mockResolvedValue(null); mocks.keys.mockReturnValue({ publicKey: 'public', privateKey: 'private' }); mocks.create.mockRejectedValue(new Error('Unique constraint'));
        await expect(vapid()).rejects.toThrow('Unique constraint'); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it('requires an account for inspection before querying', async () => {
        await expect(review([])).rejects.toBeInstanceOf(ScriptUsageError); await expect(order([])).rejects.toBeInstanceOf(ScriptUsageError);
        expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledOnce();
    });
    it.each([null, [], 'raw', { reviewer_email: 'private@example.com', review: 'Customer content' }])('handles review raw data without printing values: %j', async rawData => {
        mocks.reviews.mockResolvedValue({ id: 'review', rawData }); await review(['--account-id', 'tenant']);
        expect(mocks.reviews).toHaveBeenCalledWith({ where: { accountId: 'tenant' }, orderBy: { id: 'asc' }, select: { id: true, rawData: true } });
        const output = JSON.stringify(vi.mocked(console.log).mock.calls); expect(output).not.toContain('private@example.com'); expect(output).not.toContain('Customer content'); expect(mocks.disconnect).toHaveBeenCalledOnce();
    });
    it('scopes the Elasticsearch query and excludes private line-item metadata', async () => {
        mocks.search.mockResolvedValue({ hits: { hits: [{ _source: { id: 1, total: 25, line_items: [{ productId: 2, quantity: 1, meta_data: [{ key: 'email', value: 'private@example.com' }] }] } }] } });
        await order(['--account-id', 'tenant']);
        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ query: { term: { accountId: 'tenant' } }, size: 1 }));
        expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private@example.com'); expect(mocks.close).toHaveBeenCalledOnce();
    });
    it('closes Elasticsearch on search failure and sets a nonzero code without logging query secrets', async () => {
        mocks.search.mockRejectedValue(new Error('Database secret private-value'));
        await runScript(() => order(['--account-id', 'tenant']));
        expect(mocks.close).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(1); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-value');
    });
    it('prints usage errors and preserves explicit exit codes', async () => {
        await runScript(() => review([])); expect(console.error).toHaveBeenCalledWith('Usage: --account-id <account-id>');
        await runScript(async () => 2); expect(process.exitCode).toBe(2);
    });
});

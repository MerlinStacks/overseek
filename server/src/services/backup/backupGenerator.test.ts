import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
    const models = ['accountUser', 'accountRole', 'accountFeature', 'wooProduct', 'wooOrder', 'wooCustomer', 'wooReview',
        'supplier', 'internalProduct', 'bOM', 'purchaseOrder', 'conversation', 'cannedResponse', 'emailAccount', 'emailTemplate',
        'marketingAutomation', 'marketingCampaign', 'customerSegment', 'invoiceTemplate', 'policy', 'dashboardLayout',
        'syncState', 'adAccount', 'socialAccount', 'auditLog', 'analyticsSession'];
    const tables = Object.fromEntries(models.map(name => [name, { findMany: vi.fn() }]));
    return { transaction: vi.fn(), account: vi.fn(), tables };
});
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('./constants', async original => {
    const actual = await original<typeof import('./constants')>();
    return { ...actual, BACKUP_LIMITS: { ...actual.BACKUP_LIMITS, batchSize: 2, maxSerializedBytes: 4096, maxStoredSerializedBytes: 16384 } };
});
import { generateBackup, generateBackupJson } from './backupGenerator';
import { SENSITIVE_ACCOUNT_FIELDS, SENSITIVE_EMAIL_FIELDS } from './constants';

beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue({ id: 'tenant-1', name: 'Store', wooConsumerKey: 'private' });
    for (const table of Object.values(mocks.tables)) table.findMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async callback => callback({ account: { findUnique: mocks.account }, ...mocks.tables }));
});
describe('account backup generation', () => {
    it('uses a repeatable-read transaction and preserves the versioned backup envelope', async () => {
        const result = await generateBackup('tenant-1');
        expect(result).toEqual({ exportedAt: expect.any(String), version: '1.0', account: { id: 'tenant-1', name: 'Store', wooConsumerKey: '********' }, data: expect.any(Object) });
        expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 120000 });
        expect(mocks.account).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
    });
    it('masks every declared account and email secret without mutating database results', async () => {
        const account: Record<string, unknown> = { id: 'tenant-1', ...Object.fromEntries(SENSITIVE_ACCOUNT_FIELDS.map(key => [key, `secret-${key}`])) };
        const email = { id: 'email-1', email: 'support@example.com', ...Object.fromEntries(SENSITIVE_EMAIL_FIELDS.map(key => [key, `secret-${key}`])) };
        mocks.account.mockResolvedValue(account);
        mocks.tables.emailAccount.findMany.mockResolvedValue([email]);
        const result = await generateBackup('tenant-1');
        for (const key of SENSITIVE_ACCOUNT_FIELDS) expect(result!.account[key]).toBe('********');
        const exportedEmail = result!.data.emailAccounts[0] as Record<string, unknown>;
        for (const key of SENSITIVE_EMAIL_FIELDS) {
            expect(exportedEmail[key]).toBe('********');
            expect(email[key]).toBe(`secret-${key}`);
        }
        expect(exportedEmail.email).toBe('support@example.com');
        expect(JSON.stringify(result)).not.toContain('secret-');
        expect(account.wooConsumerKey).toBe('secret-wooConsumerKey');
    });
    it('pages by a unique cursor with a stable date/ID ordering for tied order dates', async () => {
        const rows = [{ id: 'a', dateCreated: '2026-01-01' }, { id: 'b', dateCreated: '2026-01-01' }];
        mocks.tables.wooOrder.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ id: 'c', dateCreated: '2026-01-01' }]);
        const result = await generateBackup('tenant-1');
        expect(result!.data.orders).toEqual([...rows, { id: 'c', dateCreated: '2026-01-01' }]);
        expect(mocks.tables.wooOrder.findMany.mock.calls).toEqual([
            [{ where: { accountId: 'tenant-1' }, take: 2, orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }] }],
            [{ where: { accountId: 'tenant-1' }, take: 2, orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }], cursor: { id: 'b' }, skip: 1 }],
        ]);
    });
    it('keeps all collections tenant-scoped and bounds each parent-table read', async () => {
        await generateBackup('tenant-1', { includeAuditLogs: true, includeAnalytics: true });
        for (const [name, table] of Object.entries(mocks.tables)) {
            expect(table.findMany).toHaveBeenCalledOnce();
            const query = table.findMany.mock.calls[0][0];
            expect(query.take).toBe(2);
            expect(query.where).toEqual(name === 'bOM' ? { product: { accountId: 'tenant-1' } } : { accountId: 'tenant-1' });
        }
        expect(mocks.tables.accountUser.findMany.mock.calls[0][0].include.user.select.passwordHash).toBeUndefined();
    });
    it('omits optional collections by default and preserves nested relations', async () => {
        mocks.tables.conversation.findMany.mockResolvedValue([{ id: 'chat-1', messages: [{ id: 'message-1', content: 'Hello' }] }]);
        const result = await generateBackup('tenant-1');
        expect(result!.data.conversations).toEqual([{ id: 'chat-1', messages: [{ id: 'message-1', content: 'Hello' }] }]);
        expect(result!.data).not.toHaveProperty('auditLogs');
        expect(result!.data).not.toHaveProperty('analyticsSessions');
        expect(mocks.tables.auditLog.findMany).not.toHaveBeenCalled();
        expect(mocks.tables.analyticsSession.findMany).not.toHaveBeenCalled();
    });
    it('fails rather than returning a truncated backup when the serialized budget is exceeded', async () => {
        mocks.tables.wooProduct.findMany.mockResolvedValue([{ id: 'p', rawData: { description: 'x'.repeat(5000) } }]);
        await expect(generateBackup('tenant-1')).rejects.toThrow('size limit');
        expect(mocks.tables.wooOrder.findMany).not.toHaveBeenCalled();
    });
    it('returns null without reading collections for an absent account', async () => {
        mocks.account.mockResolvedValue(null);
        expect(await generateBackup('tenant-1')).toBeNull();
        for (const table of Object.values(mocks.tables)) expect(table.findMany).not.toHaveBeenCalled();
    });
    it('rejects missing tenant context before opening a transaction', async () => {
        await expect(generateBackup('')).rejects.toThrow('Account ID required');
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it('propagates transaction failures instead of returning a partial backup', async () => {
        mocks.tables.wooOrder.findMany.mockRejectedValue(new Error('Snapshot read failed'));
        await expect(generateBackup('tenant-1')).rejects.toThrow('Snapshot read failed');
    });
    it('streams the identical sanitized envelope above the materialized size limit', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-11-05'));
            mocks.tables.wooProduct.findMany.mockResolvedValue([{ id: 'p', rawData: { description: 'x'.repeat(5000) } }]);
            const chunks: string[] = [];
            const count = await generateBackupJson('tenant-1', async chunk => { chunks.push(chunk); });
            const streamed = JSON.parse(chunks.join(''));
            expect(count).toBe(1);
            expect(streamed).toMatchObject({ exportedAt: new Date().toISOString(), version: '1.0', account: { wooConsumerKey: '********' } });
            expect(streamed.data.products).toEqual([{ id: 'p', rawData: { description: 'x'.repeat(5000) } }]);
            await expect(generateBackup('tenant-1')).rejects.toThrow('size limit');
            mocks.tables.wooProduct.findMany.mockResolvedValue([{ id: 'small' }]);
            chunks.length = 0;
            await generateBackupJson('tenant-1', async chunk => { chunks.push(chunk); });
            expect(JSON.parse(chunks.join(''))).toEqual(await generateBackup('tenant-1'));
        } finally { vi.useRealTimers(); }
    });
    it('honors sink backpressure and does not fetch the next collection after a write fails', async () => {
        mocks.tables.wooProduct.findMany.mockResolvedValue([{ id: 'p' }]);
        await expect(generateBackupJson('tenant-1', async chunk => {
            if (chunk.includes('"id":"p"')) throw new Error('disk full');
        })).rejects.toThrow('disk full');
        expect(mocks.tables.wooOrder.findMany).not.toHaveBeenCalled();
    });
    it('writes nothing for a missing account', async () => {
        mocks.account.mockResolvedValue(null);
        const write = vi.fn();
        expect(await generateBackupJson('tenant-1', write)).toBeNull();
        expect(write).not.toHaveBeenCalled();
    });
    it('retains a finite disk/work budget for streaming exports without silently truncating them', async () => {
        mocks.tables.wooProduct.findMany.mockResolvedValue([{ id: 'p', description: 'x'.repeat(17000) }]);
        await expect(generateBackupJson('tenant-1', async () => {})).rejects.toThrow('streaming export size limit');
        expect(mocks.tables.wooOrder.findMany).not.toHaveBeenCalled();
    });
});

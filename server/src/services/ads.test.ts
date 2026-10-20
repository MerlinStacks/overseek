import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { adAccount: db } }));
vi.mock('./ads/MetaAdsService', () => ({ MetaAdsService: {} }));
vi.mock('./ads/GoogleAdsService', () => ({ GoogleAdsService: {} }));
import { AdsService } from './ads';
beforeEach(() => { vi.resetAllMocks(); });
const connection = { platform: 'GOOGLE', externalId: '123-456-7890', accessToken: 'token', currency: 'usd' };
describe('ad account facade validation and tenant scope', () => {
    it('requires tenant context even on reads', async () => {
        await expect(AdsService.getAdAccounts(' ')).rejects.toMatchObject({ statusCode: 400 });
        expect(db.findMany).not.toHaveBeenCalled();
        await AdsService.getAdAccounts('tenant'); expect(db.findMany).toHaveBeenCalledWith({ where: { accountId: 'tenant' } });
    });
    it('normalizes a valid Google connection while preserving pending OAuth setup', async () => {
        await AdsService.connectAccount('tenant', connection);
        expect(db.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: 'tenant', externalId: '1234567890', currency: 'USD', platform: 'GOOGLE' }) });
        await AdsService.connectAccount('tenant', { ...connection, externalId: 'PENDING_SETUP', refreshToken: '' });
        expect(db.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ externalId: 'PENDING_SETUP', refreshToken: '' }) });
    });
    it.each([{ platform: 'OTHER' }, { accessToken: ' ' }, { externalId: '' }, { externalId: '---' }, { currency: 'US' }, { accountId: 'foreign' }])('rejects invalid connection data %j', async patch => {
        await expect(AdsService.connectAccount('tenant', { ...connection, ...patch })).rejects.toMatchObject({ statusCode: 400 });
        expect(db.create).not.toHaveBeenCalled();
    });
    it('scopes updates and token reconnections in the mutation itself', async () => {
        await AdsService.updateAccount('tenant', 'ad', { name: 'Name', externalId: '123' });
        expect(db.update).toHaveBeenCalledWith({ where: { id: 'ad', accountId: 'tenant' }, data: { name: 'Name', externalId: '123' } });
        await AdsService.updateAccountTokens('tenant', 'ad', { accessToken: 'new', refreshToken: '' });
        expect(db.update).toHaveBeenLastCalledWith({ where: { id: 'ad', accountId: 'tenant' }, data: { accessToken: 'new', refreshToken: '' } });
    });
    it('propagates a tenant mismatch instead of retrying an unscoped update', async () => {
        db.update.mockRejectedValue(Object.assign(new Error('Not found'), { code: 'P2025' }));
        await expect(AdsService.updateAccount('wrong', 'ad', { name: 'Name' })).rejects.toMatchObject({ code: 'P2025' });
        expect(db.update).toHaveBeenCalledOnce();
        expect(db.update.mock.calls[0][0].where).toEqual({ id: 'ad', accountId: 'wrong' });
    });
    it('rejects unknown mutation fields, blank tokens and absent tenant IDs', async () => {
        await expect(AdsService.updateAccount('tenant', 'ad', { accessToken: '' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(AdsService.updateAccount('tenant', 'ad', { accountId: 'foreign' } as never)).rejects.toMatchObject({ statusCode: 400 });
        await expect(AdsService.disconnectAccount('', 'ad')).rejects.toMatchObject({ statusCode: 400 });
        expect(db.update).not.toHaveBeenCalled(); expect(db.delete).not.toHaveBeenCalled();
    });
    it('scopes deletes by account and ad ID', async () => {
        await AdsService.disconnectAccount('tenant', 'ad'); expect(db.delete).toHaveBeenCalledWith({ where: { id: 'ad', accountId: 'tenant' } });
    });
});

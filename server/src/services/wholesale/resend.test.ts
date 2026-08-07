import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shareFind: vi.fn(), transaction: vi.fn(), defaultEmail: vi.fn(), sendEmail: vi.fn(), sessionUpdate: vi.fn(), shareUpdate: vi.fn(), shareUpdateMany: vi.fn(), log: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: { wholesaleCatalogShare: { findFirst: mocks.shareFind, updateMany: mocks.shareUpdateMany }, $transaction: mocks.transaction } }));
vi.mock('../../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: mocks.defaultEmail }));
vi.mock('../EmailService', () => ({ EmailService: class { sendEmail = mocks.sendEmail; } }));
vi.mock('../AuditService', () => ({ AuditActions: { WHOLESALE_SHARE_ACTIVATED: 'ACTIVATED' }, AuditService: { log: mocks.log } }));
vi.mock('./shareSecurity', () => ({
    deriveShareStatus: vi.fn(), generatedPassword: () => 'alpha-bravo-charlie-delta', hashPassword: async () => 'password-hash',
    randomToken: () => 'new-raw-token', sha256: (value: string) => `hash:${value}`, validateCustomPassword: (value: string) => value,
    validateShareExpiry: vi.fn(),
}));

import { WholesaleShareService } from './shares';

describe('wholesale standalone resend', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses activation rotation semantics and revokes every existing live session', async () => {
        const updatedAt = new Date('2026-08-07T00:00:00Z');
        const observed = { id: 'share-1', updatedAt };
        const locked = {
            ...observed, accountId: 'account-1', artifactStatus: 'READY', revokedAt: null, expiresAt: new Date('2026-09-01'), activatedAt: new Date('2026-08-01'),
            generation: { status: 'APPROVED', staleAt: null, validUntil: new Date('2026-08-30'), validityArtifactStatus: 'CURRENT' },
            catalog: { publicTitle: 'Trade List', status: 'ACTIVE' }, customerSnapshot: { company: 'Buyer Co', email: 'buyer@example.test' },
        };
        mocks.shareFind.mockResolvedValue(observed);
        mocks.defaultEmail.mockResolvedValue({ id: 'email-account-1' });
        mocks.sendEmail.mockResolvedValue({ success: true });
        const tx = {
            $queryRawUnsafe: vi.fn(), wholesaleCatalogShare: { findFirst: vi.fn().mockResolvedValue(locked), update: mocks.shareUpdate },
            wholesaleCatalogViewerSession: { updateMany: mocks.sessionUpdate },
        };
        mocks.transaction.mockImplementation((callback: any) => callback(tx));
        const result = await WholesaleShareService.resend('account-1', 'user-1', 'share-1', {});
        expect(tx.$queryRawUnsafe).toHaveBeenCalled();
        expect(mocks.sessionUpdate).toHaveBeenCalledWith({ where: { shareId: 'share-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
        expect(mocks.shareUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: 'hash:new-raw-token', passwordHash: 'password-hash', failedAttempts: 0, lockedUntil: expect.any(Date), emailedAt: expect.any(Date) }) }));
        expect(result).toEqual({ url: expect.stringContaining('/catalog-view/new-raw-token'), password: 'alpha-bravo-charlie-delta' });
        expect(mocks.log).toHaveBeenCalledWith('account-1', 'user-1', 'ACTIVATED', 'WHOLESALE_CATALOG_SHARE', 'share-1', { resend: true });
    });

    it('commits the credential claim before sending and conditionally clears that exact claim on failure', async () => {
        const updatedAt = new Date('2026-08-07T00:00:00Z');
        mocks.shareFind.mockResolvedValue({ id: 'share-1', updatedAt });
        mocks.defaultEmail.mockResolvedValue({ id: 'email-account-1' });
        mocks.sendEmail.mockRejectedValue(new Error('provider timeout'));
        let transactionCommitted = false;
        const tx = {
            $queryRawUnsafe: vi.fn(),
            wholesaleCatalogShare: { findFirst: vi.fn().mockResolvedValue({
                id: 'share-1', updatedAt, artifactStatus: 'READY', revokedAt: null, expiresAt: new Date('2026-09-01'), activatedAt: null,
                generation: { status: 'APPROVED', staleAt: null, validUntil: new Date('2026-08-30'), validityArtifactStatus: 'CURRENT' },
                catalog: { publicTitle: 'Trade List', status: 'ACTIVE' }, customerSnapshot: { company: 'Buyer Co', email: 'buyer@example.test' },
            }), update: mocks.shareUpdate },
            wholesaleCatalogViewerSession: { updateMany: mocks.sessionUpdate },
        };
        mocks.transaction.mockImplementation(async (callback: any) => { const value = await callback(tx); transactionCommitted = true; return value; });
        mocks.sendEmail.mockImplementation(async () => { expect(transactionCommitted).toBe(true); throw new Error('provider timeout'); });

        await expect(WholesaleShareService.activate('account-1', 'user-1', 'share-1', {})).rejects.toThrow('provider timeout');
        expect(mocks.shareUpdateMany).toHaveBeenCalledWith({
            where: { id: 'share-1', accountId: 'account-1', tokenHash: 'hash:new-raw-token', passwordHash: 'password-hash', activatedAt: expect.any(Date) },
            data: { tokenHash: null, passwordHash: null, activatedAt: null, emailedAt: null, lockedUntil: null },
        });
        expect(mocks.log).not.toHaveBeenCalled();
    });

    it('rotates active share credentials and sessions without sending email', async () => {
        const tx = {
            $queryRawUnsafe: vi.fn(),
            wholesaleCatalogShare: {
                findFirst: vi.fn().mockResolvedValue({ artifactStatus: 'READY', activatedAt: new Date(), revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }),
                update: mocks.shareUpdate,
            },
            wholesaleCatalogViewerSession: { updateMany: mocks.sessionUpdate },
        };
        mocks.transaction.mockImplementation((callback: any) => callback(tx));

        const result = await WholesaleShareService.rotatePassword('account-1', 'user-1', 'share-1', {});

        expect(tx.wholesaleCatalogShare.findFirst).toHaveBeenCalledWith({ where: { id: 'share-1', accountId: 'account-1' } });
        expect(mocks.sessionUpdate).toHaveBeenCalledWith({ where: { shareId: 'share-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
        expect(mocks.shareUpdate).toHaveBeenCalledWith({ where: { id: 'share-1' }, data: { tokenHash: 'hash:new-raw-token', passwordHash: 'password-hash', failedAttempts: 0, lockedUntil: null } });
        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(result).toEqual({ url: expect.stringContaining('/catalog-view/new-raw-token'), password: 'alpha-bravo-charlie-delta' });
    });
});

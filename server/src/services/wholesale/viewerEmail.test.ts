import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn(), defaultEmail: vi.fn(), sendEmail: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { emailLog: { count: mocks.count } } }));
vi.mock('../../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: mocks.defaultEmail }));
vi.mock('../EmailService', () => ({ EmailService: class { sendEmail = mocks.sendEmail; } }));
vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: vi.fn() }));
vi.mock('../AuditService', () => ({ AuditActions: {}, AuditService: { log: vi.fn() } }));

import { WholesaleViewerService } from './viewer';

describe('wholesale creator viewer emails', () => {
    const share = { id: 'share-1', accountId: 'account-1', createdBy: { email: 'creator@example.test' } };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.defaultEmail.mockResolvedValue({ id: 'email-account-1' });
        mocks.sendEmail.mockResolvedValue({ messageId: 'message-1' });
    });

    it('uses EmailLog source/sourceId dedup and the connected transactional account', async () => {
        mocks.count.mockResolvedValue(0);
        await WholesaleViewerService.emailCreator(share, 'wholesale-viewer-new:viewer-1', 'New viewer', '<p>Viewer</p>');
        expect(mocks.count).toHaveBeenCalledWith({ where: { accountId: 'account-1', source: 'WHOLESALE_CATALOG_VIEWER', sourceId: 'wholesale-viewer-new:viewer-1' } });
        expect(mocks.sendEmail).toHaveBeenCalledWith('account-1', 'email-account-1', 'creator@example.test', 'New viewer', '<p>Viewer</p>', undefined, {
            source: 'WHOLESALE_CATALOG_VIEWER', sourceId: 'wholesale-viewer-new:viewer-1', category: 'TRANSACTIONAL',
        });
        mocks.count.mockResolvedValue(1);
        await WholesaleViewerService.emailCreator(share, 'wholesale-viewer-new:viewer-1', 'New viewer', '<p>Viewer</p>');
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('swallows provider failures so viewing is never blocked', async () => {
        mocks.count.mockResolvedValue(0);
        mocks.sendEmail.mockRejectedValue(new Error('SMTP unavailable'));
        await expect(WholesaleViewerService.emailCreator(share, 'wholesale-viewer-first:viewer-1', 'Opened', '<p>Opened</p>')).resolves.toBeUndefined();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    generations: vi.fn(), notificationFind: vi.fn(), notificationCreate: vi.fn(), emailFind: vi.fn(),
    defaultEmail: vi.fn(), sendEmail: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: {
    wholesaleCatalogGeneration: { findMany: mocks.generations },
    notification: { findFirst: mocks.notificationFind, create: mocks.notificationCreate },
    emailLog: { findFirst: mocks.emailFind },
} }));
vi.mock('../../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: mocks.defaultEmail }));
vi.mock('../EmailService', () => ({ EmailService: class { sendEmail = mocks.sendEmail; } }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));

import { isValidityReminderDue, sendWholesaleValidityReminders } from './reminders';

describe('wholesale validity reminders', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses account-local calendar days across timezone boundaries', () => {
        expect(isValidityReminderDue(new Date('2026-08-10T13:59:59.999Z'), new Date('2026-08-08T01:00:00Z'), 'Australia/Sydney')).toBe(true);
        expect(isValidityReminderDue(new Date('2026-08-10T13:59:59.999Z'), new Date('2026-08-09T01:00:00Z'), 'Australia/Sydney')).toBe(false);
    });

    it('creates one in-app and email reminder and deduplicates by revision', async () => {
        const generation = {
            id: 'generation-1', accountId: 'account-1', catalogId: 'catalog-1', validityRevision: 3,
            validUntil: new Date('2026-08-10T23:59:59.999Z'), account: { timezone: 'UTC' },
            requestedBy: { email: 'owner@example.test', fullName: 'Owner' },
        };
        mocks.generations.mockResolvedValue([generation]);
        mocks.notificationFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'notification-1' });
        mocks.emailFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'email-1' });
        mocks.notificationCreate.mockResolvedValue({ id: 'notification-1' });
        mocks.defaultEmail.mockResolvedValue({ id: 'email-account-1' });
        mocks.sendEmail.mockResolvedValue({ success: true });
        const now = new Date('2026-08-08T10:00:00Z');
        await sendWholesaleValidityReminders(now);
        await sendWholesaleValidityReminders(now);
        expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        expect(mocks.sendEmail).toHaveBeenCalledWith('account-1', 'email-account-1', 'owner@example.test', expect.any(String), expect.any(String), undefined, expect.objectContaining({ sourceId: 'generation-1:r3' }));
    });
});

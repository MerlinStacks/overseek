import type { EmailAccount } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultEmailAccount } from './getDefaultEmailAccount';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { emailAccount: { findMany: mocks.findMany } } }));

function sender(overrides: Partial<EmailAccount> = {}): EmailAccount {
    return {
        id: 'sender-1', accountId: 'tenant-1', name: 'Support', email: 'support@example.com',
        smtpEnabled: false, relayEndpoint: null, relayApiKey: null, isDefault: false,
        createdAt: new Date('2026-01-01'),
        ...overrides,
    } as EmailAccount;
}

beforeEach(() => {
    mocks.findMany.mockReset();
});

describe('getDefaultEmailAccount', () => {
    it('scopes the query to the tenant and requires both relay fields or SMTP', async () => {
        mocks.findMany.mockResolvedValue([]);
        expect(await getDefaultEmailAccount('tenant-1')).toBeNull();
        expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
            where: {
                accountId: 'tenant-1',
                OR: [
                    { smtpEnabled: true },
                    { relayEndpoint: { not: null }, relayApiKey: { not: null } },
                ],
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
    });

    it.each(['', ' ', '\t\n', undefined, null])('does not query without a tenant ID: %j', accountId => {
        return getDefaultEmailAccount(accountId as string).then(result => {
            expect(result).toBeNull();
            expect(mocks.findMany).not.toHaveBeenCalled();
        });
    });

    it.each([
        { smtpEnabled: true },
        { relayEndpoint: 'https://relay.example.com/send', relayApiKey: 'encrypted-key' },
    ])('returns a complete sending-capable account unchanged: %j', transport => {
        const account = sender({ ...transport, isDefault: true });
        mocks.findMany.mockResolvedValue([account]);
        return expect(getDefaultEmailAccount('tenant-1')).resolves.toBe(account);
    });

    it('prefers the default over an older fallback without preferring SMTP over relay', async () => {
        const defaultRelay = sender({
            id: 'default', isDefault: true, createdAt: new Date('2026-02-01'),
            relayEndpoint: 'https://relay.example.com/send', relayApiKey: 'encrypted-key',
        });
        const fallbackSmtp = sender({ id: 'fallback', smtpEnabled: true });
        // Rows are returned in the query's explicitly asserted default/creation/ID order.
        mocks.findMany.mockResolvedValue([defaultRelay, fallbackSmtp]);
        expect(await getDefaultEmailAccount('tenant-1')).toBe(defaultRelay);
    });

    it.each([
        [null, 'key'], ['', 'key'], ['  \t', 'key'],
        ['https://relay.example.com', null], ['https://relay.example.com', ''],
        ['https://relay.example.com', ' \n'], [null, null],
    ])('skips an unusable default relay (%j, %j) and falls back to SMTP', async (relayEndpoint, relayApiKey) => {
        const invalidDefault = sender({ isDefault: true, relayEndpoint, relayApiKey });
        const fallback = sender({ id: 'fallback', smtpEnabled: true });
        mocks.findMany.mockResolvedValue([invalidDefault, fallback]);
        expect(await getDefaultEmailAccount('tenant-1')).toBe(fallback);
    });

    it('returns null when all candidates have unusable relay settings', async () => {
        mocks.findMany.mockResolvedValue([
            sender({ relayEndpoint: ' ', relayApiKey: 'key' }),
            sender({ id: 'sender-2', relayEndpoint: 'https://relay.example.com', relayApiKey: ' ' }),
        ]);
        expect(await getDefaultEmailAccount('tenant-1')).toBeNull();
    });

    it('preserves SMTP eligibility even when relay settings are incomplete', async () => {
        const account = sender({ smtpEnabled: true, relayEndpoint: '', relayApiKey: null });
        mocks.findMany.mockResolvedValue([account]);
        expect(await getDefaultEmailAccount('tenant-1')).toBe(account);
    });

    it('returns the first eligible fallback in the database ordering', async () => {
        const oldest = sender({ id: 'a', smtpEnabled: true });
        const sameCreationTime = sender({ id: 'b', smtpEnabled: true });
        const newer = sender({ id: 'c', smtpEnabled: true, createdAt: new Date('2026-02-01') });
        mocks.findMany.mockResolvedValue([oldest, sameCreationTime, newer]);
        expect(await getDefaultEmailAccount('tenant-1')).toBe(oldest);
    });

    it('propagates database failures rather than treating them as no configured sender', async () => {
        const error = new Error('Database unavailable');
        mocks.findMany.mockRejectedValue(error);
        await expect(getDefaultEmailAccount('tenant-1')).rejects.toBe(error);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $transaction: vi.fn(), accountFeature: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }, scopedOperation: { findUnique: vi.fn(), create: vi.fn() }, adAccount: { findFirst: vi.fn(), create: vi.fn() } }));
vi.mock('../utils/prisma', () => ({ prisma: db }));
import { chatConfigSchema, defaultChatConfig, readChatSettings, saveChatSettings } from './ChatSettingsStore';
import { saveOnboardingMetaConnection } from './OnboardingAdConnection';
const operationId = 'a9ab0598-49b4-48cd-9649-60421e77aad4', version = '2026-10-01T00:00:00.000Z';
beforeEach(() => { vi.resetAllMocks(); db.$transaction.mockImplementation(fn => fn(db)); db.accountFeature.findUnique.mockResolvedValue(null); db.scopedOperation.findUnique.mockResolvedValue(null); db.adAccount.findFirst.mockResolvedValue(null); });
describe('validated versioned chat settings', () => {
    it('reads complete legacy settings without a timezone without rewriting or guessing operational values', async () => {
        const { businessTimezone: _timezone, ...legacy } = defaultChatConfig();
        legacy.enabled = true;
        legacy.businessHours.enabled = true;
        legacy.businessHours.offlineMessage = '<p>Existing offline message</p>';
        db.accountFeature.findUnique.mockResolvedValue({ config: legacy, updatedAt: new Date(version) });
        expect(await readChatSettings('a')).toEqual({ config: { ...legacy, businessTimezone: '' }, version });
        expect(db.accountFeature.findUnique).toHaveBeenCalledWith({ where: { accountId_featureKey: { accountId: 'a', featureKey: 'CHAT_SETTINGS' } } });
        expect(db.accountFeature.updateMany).not.toHaveBeenCalled();
        expect(db.accountFeature.create).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        await expect(saveChatSettings('a', 'u', { operationId, version, config: legacy })).rejects.toThrow();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(chatConfigSchema.safeParse({ ...legacy, businessTimezone: 'Australia/Sydney' }).success).toBe(true);
    });
    it.each([null, {}, { ...defaultChatConfig(), enabled: 'false' }, { ...defaultChatConfig(), extra: true }, { ...defaultChatConfig(), businessTimezone: 'Invalid/Zone' }])('does not replace malformed stored config with defaults: %j', async config => {
        db.accountFeature.findUnique.mockResolvedValue({ config, updatedAt: new Date(version) });
        await expect(readChatSettings('a')).rejects.toThrow();
        expect(db.accountFeature.updateMany).not.toHaveBeenCalled();
        expect(db.accountFeature.create).not.toHaveBeenCalled();
    });
    it('does not invent an enabled storefront for missing config', async () => { expect(await readChatSettings('a')).toMatchObject({ version: null, config: { enabled: false, businessTimezone: '' } }); });
    it('rejects malformed Boolean/day/timezone/color and overnight shapes', () => { const base = defaultChatConfig(); expect(chatConfigSchema.safeParse({ ...base, enabled: 'false' }).success).toBe(false); expect(chatConfigSchema.safeParse({ ...base, primaryColor: 'url(x)' }).success).toBe(false); expect(chatConfigSchema.safeParse({ ...base, businessHours: { ...base.businessHours, enabled: true } }).success).toBe(false); expect(chatConfigSchema.safeParse({ ...base, businessHours: { ...base.businessHours, days: { ...base.businessHours.days, mon: { isOpen: true, open: '23:00', close: '02:00' } } } }).success).toBe(false); });
    it('rejects stale writes rather than overwriting a newer draft', async () => { db.accountFeature.findUnique.mockResolvedValue({ id: 'f', updatedAt: new Date(version) }); await expect(saveChatSettings('a', 'u', { operationId, version: null, config: defaultChatConfig() })).rejects.toMatchObject({ statusCode: 409 }); expect(db.accountFeature.updateMany).not.toHaveBeenCalled(); });
    it('reserves a new version and receipt without claiming storefront delivery', async () => { const saved = await saveChatSettings('a', 'u', { operationId, version: null, config: defaultChatConfig() }); expect(saved).toMatchObject({ newlySaved: true, storefrontSync: 'requested-unconfirmed' }); expect(db.scopedOperation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accountId: 'a', kind: 'chat-settings-save' }) })); });
    it('replays identical acknowledged saves and rejects changed identities', async () => { const input = { operationId, version: null, config: defaultChatConfig() }; await saveChatSettings('a', 'u', input); const receipt = db.scopedOperation.create.mock.calls[0][0].data; db.scopedOperation.findUnique.mockResolvedValue(receipt); expect(await saveChatSettings('a', 'u', input)).toMatchObject({ newlySaved: false }); await expect(saveChatSettings('a', 'u', { ...input, config: { ...input.config, headerText: 'Changed' } })).rejects.toMatchObject({ statusCode: 409 }); expect(db.accountFeature.create).toHaveBeenCalledTimes(1); });
});
describe('onboarding connection receipts', () => {
    const input = { operationId, externalId: 'act_123', accessToken: 'a-private-test-token' };
    it('creates an unverified identity and keeps credentials out of receipts/results', async () => { db.adAccount.create.mockResolvedValue({ id: 'ad', platform: 'META', externalId: 'act_123' }); const result = await saveOnboardingMetaConnection('a', 'u', input); expect(result.credentialState).toBe('saved-unverified'); expect(JSON.stringify(db.scopedOperation.create.mock.calls)).not.toContain(input.accessToken); expect(JSON.stringify(result)).not.toContain(input.accessToken); });
    it('refuses to replace an existing account connection', async () => { db.adAccount.findFirst.mockResolvedValue({ id: 'old' }); await expect(saveOnboardingMetaConnection('a', 'u', input)).rejects.toMatchObject({ statusCode: 409 }); expect(db.adAccount.create).not.toHaveBeenCalled(); });
    it('rejects malformed/bounded identities before database access', async () => { await expect(saveOnboardingMetaConnection('a', 'u', { ...input, externalId: '../foreign' })).rejects.toThrow(); expect(db.$transaction).not.toHaveBeenCalled(); });
});

import { afterEach, describe, expect, it } from 'vitest';
import { clearDraftFromStorage, createInitialDraft, loadDraftFromStorage, ONBOARDING_STORAGE_KEY, saveDraftToStorage, validateStep } from './types';
const scope = { userId: 'user-a', mode: 'setup' as const, accountId: 'account-a' };
const key = `${ONBOARDING_STORAGE_KEY}:user-a:setup`;
function verifiedDraft() {
    const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Store', wooUrl: 'https://store.example', accountId: 'account-a', connectionVerified: true, wooConsumerKey: 'WOO-KEY-SECRET', wooConsumerSecret: 'WOO-SECRET' };
    draft.email.smtpPassword = 'SMTP-SECRET'; draft.ads.metaAccessToken = 'META-SECRET'; draft.completedSteps = [1, 2]; return draft;
}
afterEach(() => localStorage.clear());
describe('onboarding draft persistence', () => {
    it('never persists credentials, including Meta tokens and unexpected fields', () => {
        const draft = verifiedDraft(); (draft.ads as unknown as Record<string, unknown>).extraSecret = 'UNKNOWN-SECRET';
        saveDraftToStorage(draft, 3, scope); const stored = localStorage.getItem(key)!;
        expect(stored).not.toMatch(/WOO-KEY-SECRET|WOO-SECRET|SMTP-SECRET|META-SECRET|UNKNOWN-SECRET/);
        const restored = loadDraftFromStorage(scope)!; expect(restored.currentStep).toBe(3); expect(restored.draft.store.connectionVerified).toBe(true); expect(restored.draft.ads.metaAccessToken).toBeUndefined();
    });
    it('discards legacy unowned drafts and isolates users and wizard intents', () => {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ draft: verifiedDraft() })); expect(loadDraftFromStorage(scope)).toBeNull(); expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
        saveDraftToStorage(verifiedDraft(), 3, scope); expect(loadDraftFromStorage({ ...scope, userId: 'other' })).toBeNull(); expect(loadDraftFromStorage({ ...scope, mode: 'add' })).toBeNull();
        clearDraftFromStorage({ ...scope, userId: 'other' }); expect(loadDraftFromStorage(scope)).not.toBeNull();
    });
    it('does not reuse verified account state for another account', () => {
        saveDraftToStorage(verifiedDraft(), 3, scope); const restored = loadDraftFromStorage({ ...scope, accountId: 'other-account' })!;
        expect(restored.currentStep).toBe(1); expect(restored.draft.store.connectionVerified).toBe(false); expect(restored.draft.completedSteps).toEqual([]); expect(restored.wizardSessionActive).toBe(false);
        saveDraftToStorage(verifiedDraft(), 3, { ...scope, accountId: 'other-account' }); expect(loadDraftFromStorage({ ...scope, accountId: 'other-account' })?.wizardSessionActive).toBe(false);
    });
    it.each([
        { version: 1, currentStep: 99, draft: verifiedDraft() },
        { version: 1, currentStep: 2, draft: { ...verifiedDraft(), store: null } },
        { version: 1, currentStep: 2, draft: { ...verifiedDraft(), completedSteps: ['1'] } },
        { version: 1, currentStep: 2, draft: { ...verifiedDraft(), skippedSteps: [1] } },
        { version: 1, currentStep: 2, draft: { ...verifiedDraft(), email: { ...verifiedDraft().email, smtpPort: 0 } } },
    ])('rejects malformed restored state %#', value => { localStorage.setItem(key, JSON.stringify(value)); expect(loadDraftFromStorage(scope)).toBeNull(); });
    it('requires verified store setup and valid URLs, ports and wizard steps', () => {
        const draft = verifiedDraft(); expect(validateStep(5, draft).isValid).toBe(true); expect(validateStep(0, draft).isValid).toBe(false);
        draft.store.connectionVerified = false; expect(validateStep(1, draft).isValid).toBe(false);
        draft.store.wooUrl = 'javascript:alert(1)'; expect(validateStep(1, draft).isValid).toBe(false);
        draft.email.enabled = true; draft.email.name = 'Email'; draft.email.email = 'email@example.test'; draft.email.smtpPort = -1; expect(validateStep(3, draft).isValid).toBe(false);
    });
});

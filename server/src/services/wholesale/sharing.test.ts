import path from 'path';
import { describe, expect, it } from 'vitest';
import { WholesaleShareService, withNotificationPreference } from './shares';
import { areViewerNotificationsMuted, isKnownScanner } from './viewer';
import { assertPrivateSharePath, shareArtifactPaths } from './storage';
import { deriveShareStatus, generatedPassword, lockoutAfterFailure, randomToken, sha256, validateCustomPassword, validateShareExpiry, watermarkSvg, xmlEscape } from './shareSecurity';

describe('wholesale share credentials', () => {
    it('creates high-entropy tokens, hashes deterministically and generates four lowercase words', () => {
        const token = randomToken();
        expect(token.length).toBeGreaterThanOrEqual(43);
        expect(sha256(token)).toMatch(/^[a-f0-9]{64}$/);
        expect(generatedPassword()).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/);
    });

    it('rejects short and obvious custom passwords', () => {
        expect(() => validateCustomPassword('password123')).toThrow();
        expect(() => validateCustomPassword('123456789012')).toThrow();
        expect(validateCustomPassword('Correct-Horse-94!')).toBe('Correct-Horse-94!');
    });
});

describe('wholesale share expiry, lockout and status', () => {
    const now = new Date('2026-08-07T00:00:00.000Z');
    it('requires a future expiry no more than 90 days after creation', () => {
        expect(validateShareExpiry('2026-09-01T00:00:00.000Z', now, now)).toEqual(new Date('2026-09-01T00:00:00.000Z'));
        expect(() => validateShareExpiry('2026-08-06T00:00:00.000Z', now, now)).toThrow(/future/);
        expect(() => validateShareExpiry('2026-11-06T00:00:00.000Z', now, now)).toThrow(/90 days/);
    });

    it('derives terminal and lock statuses before active/readiness states', () => {
        const base = { expiresAt: new Date('2026-09-01'), artifactStatus: 'READY', tokenHash: 't', passwordHash: 'p', activatedAt: now };
        expect(deriveShareStatus(base, now)).toBe('ACTIVE');
        expect(deriveShareStatus({ ...base, lockedUntil: new Date('2026-08-07T00:15:00Z') }, now)).toBe('LOCKED');
        expect(deriveShareStatus({ ...base, expiresAt: new Date('2026-08-06') }, now)).toBe('EXPIRED');
        expect(deriveShareStatus({ ...base, revokedAt: now }, now)).toBe('REVOKED');
        expect(deriveShareStatus({ ...base, artifactStatus: 'FAILED', tokenHash: null }, now)).toBe('FAILED');
    });

    it('locks on the fifth failure for exactly 15 minutes', () => {
        expect(lockoutAfterFailure(4, now)).toEqual({ failedAttempts: 4, lockedUntil: null });
        expect(lockoutAfterFailure(5, now)).toEqual({ failedAttempts: 0, lockedUntil: new Date('2026-08-07T00:15:00.000Z') });
    });
});

describe('wholesale viewer images and private paths', () => {
    it('detects known email security scanners without classifying normal browsers', () => {
        expect(isKnownScanner('Mozilla/5.0 Proofpoint URL Defense')).toBe(true);
        expect(isKnownScanner('Microsoft Office Existence Discovery')).toBe(true);
        expect(isKnownScanner('Mozilla/5.0 Chrome/126 Safari/537.36')).toBe(false);
    });
    it('XML escapes dynamic watermark data on full pages and thumbnails', () => {
        expect(xmlEscape(`A&B <C> "D" 'E'`)).toBe('A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
        const svg = watermarkSvg(Buffer.from('png'), 'Viewer <bad>', 'A&B Co', 'Confidential', false);
        expect(svg).toContain('data:image/png;base64,cG5n');
        expect(svg).toContain('A&amp;B Co');
        expect(svg).not.toContain('Viewer <bad>');
        expect(watermarkSvg(Buffer.from('png'), 'Viewer', 'Company', 'Private', true)).toContain('<svg');
        expect(watermarkSvg(Buffer.from('png'), 'Viewer', 'Company', 'Private', false, true)).toContain('PRICING EXPIRED - CONTACT US FOR CURRENT PRICING');
    });

    it('contains all share artifacts beneath the share-specific private directory', () => {
        const root = '/tmp/overseek-share-test';
        const id = '123e4567-e89b-42d3-a456-426614174000';
        const artifact = shareArtifactPaths(id, false, root);
        expect(artifact.pdf.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
        expect(assertPrivateSharePath(path.join(artifact.pages, 'page-1.png'), id, root)).toContain(id);
        expect(assertPrivateSharePath(path.join(artifact.thumbnails, 'page-1.png'), id, root)).toContain(`${id}${path.sep}thumbnails`);
        expect(() => assertPrivateSharePath('/tmp/overseek-share-test/other/page.png', id, root)).toThrow(/escapes/);
    });
});

describe('wholesale customer snapshot', () => {
    it('captures company, contact, email and phone from account-owned Woo data', () => {
        expect(WholesaleShareService.customerSnapshot({ firstName: 'Fallback', lastName: 'Name', email: 'fallback@test', rawData: { billing: { company: 'Trade Co', first_name: 'Ava', last_name: 'Buyer', email: 'ava@test', phone: '0400' } } })).toEqual({ company: 'Trade Co', contact: 'Ava Buyer', email: 'ava@test', phone: '0400' });
    });

    it('preserves safe snapshot fields and defaults notifications to enabled', () => {
        const snapshot = withNotificationPreference({ company: 'Trade Co', pageCount: 4 }, true);
        expect(snapshot).toEqual({ company: 'Trade Co', pageCount: 4, notificationsMuted: true });
        expect(areViewerNotificationsMuted({ customerSnapshot: snapshot })).toBe(true);
        expect(areViewerNotificationsMuted({ customerSnapshot: { company: 'Trade Co' } })).toBe(false);
        expect(withNotificationPreference(null, false)).toEqual({ notificationsMuted: false });
    });
});

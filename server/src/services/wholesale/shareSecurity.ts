import crypto from 'crypto';
import argon2 from 'argon2';

const WORDS = ['amber', 'apple', 'atlas', 'birch', 'bloom', 'cedar', 'cobalt', 'coral', 'delta', 'ember', 'falcon', 'fern', 'forest', 'harbor', 'hazel', 'indigo', 'ivory', 'juniper', 'lagoon', 'linden', 'maple', 'meadow', 'mercury', 'mist', 'nova', 'ocean', 'olive', 'onyx', 'opal', 'orbit', 'pearl', 'pine', 'quartz', 'raven', 'river', 'ruby', 'sage', 'silver', 'solar', 'spruce', 'stone', 'tiger', 'timber', 'violet', 'willow', 'winter', 'zenith'];
const COMMON = /^(password|password1|password123|123456789012|qwertyuiop12|letmein12345|administrator|wholesale123|companyname)$/i;

export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
}

export function generatedPassword(): string {
    return Array.from({ length: 4 }, () => WORDS[crypto.randomInt(WORDS.length)]).join('-');
}

export function validateCustomPassword(password: string): string {
    const value = String(password || '').trim();
    if (value.length < 12 || COMMON.test(value) || /^(.+)\1+$/.test(value) || /^[a-z]+$/i.test(value) && value.length < 16) {
        throw new Error('Password must be at least 12 characters and not obvious or common');
    }
    return value;
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

export function validateShareExpiry(value: string | Date, createdAt = new Date(), now = new Date()): Date {
    const expiresAt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) throw new Error('Expiry must be in the future');
    if (expiresAt.getTime() > createdAt.getTime() + 90 * 24 * 60 * 60 * 1000) throw new Error('Expiry cannot exceed 90 days from share creation');
    return expiresAt;
}

export function deriveShareStatus(share: any, now = new Date()): 'PREPARING' | 'READY' | 'ACTIVE' | 'LOCKED' | 'EXPIRED' | 'REVOKED' | 'FAILED' {
    if (share.revokedAt) return 'REVOKED';
    if (share.expiresAt <= now || share.artifactStatus === 'EXPIRED') return 'EXPIRED';
    if (share.artifactStatus === 'FAILED') return 'FAILED';
    if (share.lockedUntil && share.failedAttempts !== 0 && share.lockedUntil > now) return 'LOCKED';
    if (share.activatedAt && share.tokenHash && share.passwordHash) return 'ACTIVE';
    if (share.artifactStatus === 'READY') return 'READY';
    return 'PREPARING';
}

export function lockoutAfterFailure(failedAttempts: number, now = new Date()) {
    return failedAttempts >= 5
        ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + 15 * 60 * 1000) }
        : { failedAttempts, lockedUntil: null };
}

export function xmlEscape(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

export function watermarkSvg(png: Buffer, viewer: string, company: string, confidentiality: string, thumbnail = false, pricingExpired = false): string {
    const image = png.toString('base64');
    const label = xmlEscape(`${confidentiality} | ${company} | ${viewer}`);
    const size = thumbnail ? 25 : 34;
    const expired = pricingExpired ? '<rect x="0" y="0" width="1754" height="72" fill="#b91c1c"/><text x="877" y="47" text-anchor="middle" font-family="Arial,sans-serif" font-size="31" font-weight="700" fill="#ffffff">PRICING EXPIRED - CONTACT US FOR CURRENT PRICING</text>' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1754 1240"><image href="data:image/png;base64,${image}" width="1754" height="1240"/>${expired}<g transform="translate(877 620) rotate(-32)" opacity="0.17"><text text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" font-weight="700" fill="#18202a">${label}</text></g><text x="1720" y="1210" text-anchor="end" font-family="Arial,sans-serif" font-size="18" fill="#18202a">${label}</text></svg>`;
}

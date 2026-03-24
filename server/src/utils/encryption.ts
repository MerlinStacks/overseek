import crypto from 'crypto';
import { Logger } from './logger';

const ALGORITHM = 'aes-256-gcm';

/**
 * Why throw: using a hardcoded fallback silently encrypts data with a
 * well-known key—a DB leak would expose all encrypted secrets.
 */
const KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!KEY && process.env.NODE_ENV === 'production') {
    throw new Error('[encryption] ENCRYPTION_KEY or JWT_SECRET must be set in production');
}
const EFFECTIVE_KEY = KEY || 'temporary_dev_key_change_me';

export const encrypt = (text: string): string => {
    const iv = crypto.randomBytes(16);
    // hash to get exactly 32 bytes for AES-256
    const keyBuf = crypto.createHash('sha256').update(String(EFFECTIVE_KEY)).digest();

    const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
};

/** decrypt, or return original if the value looks like legacy plaintext */
export const decrypt = (text: string): string => {
    const parts = text.split(':');

    // not iv:tag:encrypted format — probably legacy plaintext
    if (parts.length !== 3) {
        Logger.warn('[encryption] Detected legacy unencrypted value, consider re-saving');
        return text;
    }

    const [ivHex, tagHex, encryptedHex] = parts;

    const isValidHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);
    if (!isValidHex(ivHex) || !isValidHex(tagHex) || !isValidHex(encryptedHex)) {
        Logger.warn('[encryption] Value contains colons but is not encrypted, treating as plain-text');
        return text;
    }

    try {
        const keyBuf = crypto.createHash('sha256').update(String(EFFECTIVE_KEY)).digest();
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e: any) {
        // key probably changed since this was encrypted
        Logger.error('[encryption] Decryption failed - ENCRYPTION_KEY may have changed. Value will be unusable.', { error: e?.message });
        throw new Error('Decryption failed - encryption key mismatch or corrupted data');
    }
};


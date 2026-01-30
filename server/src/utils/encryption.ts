import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// In production, ENCRYPTION_KEY should be set in .env
const KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'temporary_dev_key_change_me';

export const encrypt = (text: string): string => {
    const iv = crypto.randomBytes(16);
    // Hash key to ensure 32 bytes for AES-256
    const keyBuf = crypto.createHash('sha256').update(String(KEY)).digest();

    const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt AES-256-GCM encrypted text.
 * 
 * Gracefully handles legacy plain-text values:
 * - If format doesn't match `iv:tag:encrypted`, returns original (assuming plaintext)
 * - If decryption fails (wrong key), returns original with warning
 * 
 * @param text - The encrypted string or legacy plain-text
 * @returns Decrypted value, or original if not encrypted/decryptable
 */
export const decrypt = (text: string): string => {
    const parts = text.split(':');

    // Check for encrypted format: `iv:tag:encrypted` (all hex)
    if (parts.length !== 3) {
        // Doesn't match encrypted format - treat as legacy plain-text
        // Log for audit/migration tracking
        console.warn('[encryption] Detected legacy unencrypted value, consider re-saving');
        return text;
    }

    const [ivHex, tagHex, encryptedHex] = parts;

    // Validate hex format (each part should be valid hex)
    const isValidHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);
    if (!isValidHex(ivHex) || !isValidHex(tagHex) || !isValidHex(encryptedHex)) {
        // Contains colons but isn't valid encrypted format - likely plain text with colons
        console.warn('[encryption] Value contains colons but is not encrypted, treating as plain-text');
        return text;
    }

    try {
        const keyBuf = crypto.createHash('sha256').update(String(KEY)).digest();
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e: any) {
        // Decryption failed (wrong key, corrupted data, etc.)
        // This could happen if ENCRYPTION_KEY changed after data was stored
        console.error('[encryption] Decryption failed - ENCRYPTION_KEY may have changed. Value will be unusable.', e?.message);
        throw new Error('Decryption failed - encryption key mismatch or corrupted data');
    }
};


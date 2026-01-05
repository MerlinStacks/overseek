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

export const decrypt = (text: string): string => {
    const parts = text.split(':');
    if (parts.length !== 3) {
        // Fallback for legacy plain text? Or throw
        // If it doesn't look like our format (hex:hex:hex), maybe it's legacy plain text.
        // We can try to return it as is or throw. 
        // For migration safety, let's return it (assuming it's plain text).
        // But this is risky if plain text contains colons.
        // Better to throw or handle strictly.
        // Given this is a new feature, we'll try to decrypt, if fail, check if it's plain text?
        // Let's stick to strict format. If existing data is plain text, user needs to re-save.
        // Or we catch error.
        throw new Error('Invalid encrypted text format');
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const keyBuf = crypto.createHash('sha256').update(String(KEY)).digest();

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

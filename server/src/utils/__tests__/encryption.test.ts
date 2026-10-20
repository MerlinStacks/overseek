/**
 * Encryption Utility Tests
 * 
 * Tests the encrypt/decrypt roundtrip and error handling.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { encrypt, decrypt } from '../encryption';

describe('Encryption Utilities', () => {
    it('roundtrips an authenticated empty string', () => {
        expect(decrypt(encrypt(''))).toBe('');
    });
    it.each([0, 1, 2])('rejects tampering in encrypted segment %s', part => {
        const parts = encrypt('Sensitive value').split(':');
        parts[part] = (parts[part][0] === 'a' ? 'b' : 'a') + parts[part].slice(1);
        expect(() => decrypt(parts.join(':'))).toThrow('Decryption failed');
    });
    describe('encrypt/decrypt roundtrip', () => {
        it('should encrypt and decrypt a simple string', () => {
            const plaintext = 'Hello, World!';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it('should encrypt and decrypt special characters', () => {
            const plaintext = 'Passw0rd!@#$%^&*()_+-=[]{}|;:,.<>?';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it('should encrypt and decrypt unicode characters', () => {
            const plaintext = '你好世界 🌍 مرحبا';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it('should produce different ciphertext for same plaintext (random IV)', () => {
            const plaintext = 'Test string';
            const encrypted1 = encrypt(plaintext);
            const encrypted2 = encrypt(plaintext);

            expect(encrypted1).not.toBe(encrypted2);
            expect(decrypt(encrypted1)).toBe(plaintext);
            expect(decrypt(encrypted2)).toBe(plaintext);
        });
    });

    describe('decrypt legacy handling', () => {
        it('should return original text on invalid format (no colons)', () => {
            // decrypt gracefully handles legacy unencrypted values
            expect(decrypt('invalidciphertext')).toBe('invalidciphertext');
        });

        it('should return original text on invalid format (wrong number of parts)', () => {
            // decrypt gracefully handles legacy values with colons
            expect(decrypt('part1:part2')).toBe('part1:part2');
        });
    });
});

describe('encryption key configuration', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
    it('fails to load in production without an encryption or JWT key', async () => {
        vi.resetModules(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('ENCRYPTION_KEY', ''); vi.stubEnv('JWT_SECRET', '');
        await expect(import('../encryption')).rejects.toThrow('must be set in production');
    });
    it('accepts the JWT key fallback in production', async () => {
        vi.resetModules(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('ENCRYPTION_KEY', ''); vi.stubEnv('JWT_SECRET', 'test-jwt-key');
        const module = await import('../encryption'); expect(module.decrypt(module.encrypt('value'))).toBe('value');
    });
    it('rejects ciphertext encrypted under another key', async () => {
        vi.resetModules(); vi.stubEnv('ENCRYPTION_KEY', 'test-key-a');
        const first = await import('../encryption'); const ciphertext = first.encrypt('value');
        vi.resetModules(); vi.stubEnv('ENCRYPTION_KEY', 'test-key-b');
        const second = await import('../encryption'); expect(() => second.decrypt(ciphertext)).toThrow('Decryption failed');
    });
});

/**
 * Encryption Utility Tests
 * 
 * Tests the encrypt/decrypt roundtrip and error handling.
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../encryption';

describe('Encryption Utilities', () => {
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

    describe('decrypt error handling', () => {
        it('should return original string on invalid format (no colons)', () => {
            const input = 'invalidciphertext';
            expect(decrypt(input)).toBe(input);
        });

        it('should return original string on invalid format (wrong number of parts)', () => {
            const input = 'part1:part2';
            expect(decrypt(input)).toBe(input);
        });
    });
});

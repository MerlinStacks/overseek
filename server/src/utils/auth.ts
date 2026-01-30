import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required');
}

// Argon2id with OWASP recommended settings for 2025+
const ARGON2_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB (OWASP minimum for Argon2id)
    timeCost: 2,
    parallelism: 1
};

// Password Handling
export const hashPassword = async (password: string): Promise<string> => {
    return argon2.hash(password, ARGON2_OPTIONS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
    // Argon2 hashes start with $argon2
    if (hash.startsWith('$argon2')) {
        return argon2.verify(hash, password);
    }
    // Legacy bcrypt hash support (starts with $2a$, $2b$, or $2y$)
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, hash);
};

/**
 * Check if a password hash needs rehashing (is using legacy bcrypt).
 * Use this after successful login to migrate users to Argon2.
 */
export const needsRehash = (hash: string): boolean => {
    return !hash.startsWith('$argon2');
};

// JWT Handling
export const generateToken = (payload: object): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token: string): any => {
    return jwt.verify(token, JWT_SECRET);
};

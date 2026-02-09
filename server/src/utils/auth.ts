import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required');
}

// EDGE CASE FIX: Separate secrets for access and refresh tokens
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || JWT_SECRET + '_refresh';

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

// JWT Handling - Access tokens are short-lived (15 minutes)
export const generateToken = (payload: object): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
};

export const verifyToken = (token: string): any => {
    return jwt.verify(token, JWT_SECRET);
};

/**
 * EDGE CASE FIX: Refresh token mechanism.
 * 
 * Refresh tokens are long-lived (30 days) and used to obtain new access tokens.
 * They are stored as opaque strings and hashed in the database for security.
 */
export const generateRefreshToken = (): string => {
    // Generate a cryptographically secure random token
    return crypto.randomBytes(64).toString('base64url');
};

/**
 * Hash a refresh token for secure storage.
 * Using SHA-256 since we're comparing opaque tokens, not passwords.
 */
export const hashRefreshToken = (token: string): string => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate an access token with explicit expiry timestamp for client convenience.
 * Returns both the token and the expiry timestamp.
 */
export const generateAccessTokenWithExpiry = (payload: object): { token: string; expiresAt: number } => {
    const expiresIn = 15 * 60; // 15 minutes in seconds
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn });
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    return { token, expiresAt };
};

/** Refresh token expiry in milliseconds (30 days) */
export const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

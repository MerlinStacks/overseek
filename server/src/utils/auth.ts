import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required');
}

// argon2id - OWASP recommended
const ARGON2_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1
};


export const hashPassword = async (password: string): Promise<string> => {
    return argon2.hash(password, ARGON2_OPTIONS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {

    if (hash.startsWith('$argon2')) {
        return argon2.verify(hash, password);
    }
    // legacy bcrypt fallback
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, hash);
};

/** true if using legacy bcrypt — rehash on next login */
export const needsRehash = (hash: string): boolean => {
    return !hash.startsWith('$argon2');
};


export const generateToken = (payload: object): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token: string): any => {
    return jwt.verify(token, JWT_SECRET);
};

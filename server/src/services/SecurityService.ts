import { PrismaClient, User } from '@prisma/client';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { generateToken } from '../utils/auth';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export class SecurityService {

    // -------------------
    // Helper: Hash Token
    // -------------------

    /**
     * Hashes a token using SHA-256 for secure storage.
     * Client receives plaintext token; DB stores only the hash.
     */
    private static hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    // -------------------
    // Two-Factor Auth
    // -------------------

    static async generateTwoFactorSecret(user: User) {
        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(user.email, process.env.APP_NAME || 'Commerce Platform', secret);
        const qrCodeUrl = await qrcode.toDataURL(otpauth);

        return {
            secret,
            qrCodeUrl
        };
    }

    static verifyTwoFactorToken(token: string, secret: string): boolean {
        return authenticator.check(token, secret);
    }

    static async enableTwoFactor(userId: string, secret: string) {
        // Generate backup codes
        const backupCodes = Array.from({ length: 10 }, () => crypto.randomBytes(4).toString('hex'));

        await prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret,
                isTwoFactorEnabled: true,
                twoFactorBackupCodes: backupCodes as any
            }
        });

        return backupCodes;
    }

    // -------------------
    // Session Management
    // -------------------

    static async createSession(userId: string, ipAddress?: string, userAgent?: string) {
        // Create Refresh Token first to get the session ID
        const refreshTokenPlain = crypto.randomBytes(40).toString('hex');
        const refreshTokenHash = this.hashToken(refreshTokenPlain);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const refreshTokenRecord = await prisma.refreshToken.create({
            data: {
                token: refreshTokenHash, // Store hash, not plaintext
                userId,
                expiresAt,
                ipAddress,
                userAgent
            }
        });

        // Create Access Token with sessionId for current session identification
        const accessToken = generateToken({ userId, sessionId: refreshTokenRecord.id });

        // Log JWT fingerprint for debugging multi-container secret mismatches
        const secret = process.env.JWT_SECRET || '';
        const fingerprint = crypto.createHash('sha256').update(secret.substring(0, 8)).digest('hex').substring(0, 12);
        Logger.warn('[SecurityService] Token generated', { userId, sessionId: refreshTokenRecord.id, jwtFingerprint: fingerprint });

        return { accessToken, refreshToken: refreshTokenPlain }; // Return plaintext to client
    }

    static async refreshSession(token: string, ipAddress?: string, userAgent?: string) {
        // Hash the incoming token to compare against stored hash
        const tokenHash = this.hashToken(token);

        const refreshToken = await prisma.refreshToken.findUnique({
            where: { token: tokenHash },
            include: { user: true }
        });

        if (!refreshToken || refreshToken.revokedAt || new Date() > refreshToken.expiresAt) {
            // Token Reuse Detection: if token not found, could be reuse attempt
            Logger.warn('Refresh token validation failed', {
                reason: !refreshToken ? 'not_found' : refreshToken.revokedAt ? 'revoked' : 'expired'
            });
            throw new Error('Invalid refresh token');
        }

        // Rotate Token - generate new plaintext, store new hash
        const newRefreshTokenPlain = crypto.randomBytes(40).toString('hex');
        const newRefreshTokenHash = this.hashToken(newRefreshTokenPlain);
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Revoke old, create new
        // Transaction to ensure atomicity - using separate operations to get new ID
        await prisma.refreshToken.update({
            where: { id: refreshToken.id },
            data: { revokedAt: new Date() }
        });

        const newRefreshTokenRecord = await prisma.refreshToken.create({
            data: {
                token: newRefreshTokenHash, // Store hash
                userId: refreshToken.userId,
                expiresAt: newExpiresAt,
                ipAddress,
                userAgent
            }
        });

        // Include new sessionId in access token
        const newAccessToken = generateToken({ userId: refreshToken.userId, sessionId: newRefreshTokenRecord.id });

        return { accessToken: newAccessToken, refreshToken: newRefreshTokenPlain }; // Return plaintext
    }

    static async revokeUserSessions(userId: string) {
        await prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() }
        });
    }

    /**
     * Revokes ALL existing refresh tokens across all users.
     * Use when migrating from plaintext to hashed token storage.
     */
    static async revokeAllSessions() {
        const result = await prisma.refreshToken.updateMany({
            where: { revokedAt: null },
            data: { revokedAt: new Date() }
        });
        Logger.info('Revoked all existing refresh tokens', { count: result.count });
        return result.count;
    }
}


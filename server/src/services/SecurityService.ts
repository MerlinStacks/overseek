import { PrismaClient, User } from '@prisma/client';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { generateToken } from '../utils/auth';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';

export class SecurityService {

    // -------------------
    // Two-Factor Auth
    // -------------------

    static async generateTwoFactorSecret(user: User) {
        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(user.email, 'Overseek', secret);
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
        // Create Access Token
        const accessToken = generateToken({ userId });

        // Create Refresh Token
        const refreshTokenStr = crypto.randomBytes(40).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await prisma.refreshToken.create({
            data: {
                token: refreshTokenStr,
                userId,
                expiresAt,
                ipAddress,
                userAgent
            }
        });

        return { accessToken, refreshToken: refreshTokenStr };
    }

    static async refreshSession(token: string, ipAddress?: string, userAgent?: string) {
        const refreshToken = await prisma.refreshToken.findUnique({
            where: { token },
            include: { user: true }
        });

        if (!refreshToken || refreshToken.revokedAt || new Date() > refreshToken.expiresAt) {
            // Token Reuse Detection could go here (revoke all if reused)
            throw new Error('Invalid refresh token');
        }

        // Rotate Token
        const newRefreshTokenStr = crypto.randomBytes(40).toString('hex');
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Revoke old, create new
        // Transaction to ensure atomicity
        await prisma.$transaction([
            prisma.refreshToken.update({
                where: { id: refreshToken.id },
                data: { revokedAt: new Date() }
            }),
            prisma.refreshToken.create({
                data: {
                    token: newRefreshTokenStr,
                    userId: refreshToken.userId,
                    expiresAt: newExpiresAt,
                    ipAddress,
                    userAgent
                }
            })
        ]);

        const newAccessToken = generateToken({ userId: refreshToken.userId });

        return { accessToken: newAccessToken, refreshToken: newRefreshTokenStr };
    }

    static async revokeUserSessions(userId: string) {
        await prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() }
        });
    }
}

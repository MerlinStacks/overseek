/**
 * Auth Route - Fastify Plugin
 * Authentication endpoints with 2FA, sessions, and password reset
 */

import { FastifyPluginAsync } from 'fastify';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { requireAuthFastify } from '../middleware/auth';
import { SecurityService } from '../services/SecurityService';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { PermissionService } from '../services/PermissionService';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { redisClient } from '../utils/redis';

// Schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    fullName: z.string().min(2, 'Full name is required')
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
    token: z.string().optional() // Optional 2FA token
});

const resetPasswordSchema = z.object({
    email: z.string().email(),
    token: z.string(),
    newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

// Simple in-memory rate limiter (per IP) as fallback if Redis is unavailable.
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_FAILED_ATTEMPTS = 10; // Increased limit - only counts FAILED attempts now

/**
 * Check if IP is currently rate limited (without incrementing).
 * Returns true if allowed to attempt login, false if blocked.
 */
function isRateLimitedFallback(ip: string): boolean {
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (!record) return true; // No record = allowed

    // Window expired, reset
    if (now - record.firstAttempt > WINDOW_MS) {
        loginAttempts.delete(ip);
        return true;
    }

    // Check if at limit
    return record.count < MAX_FAILED_ATTEMPTS;
}

/**
 * Increment failed login counter for IP.
 */
function incrementFailedLoginFallback(ip: string): void {
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (!record) {
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
        return;
    }

    // Window expired, reset
    if (now - record.firstAttempt > WINDOW_MS) {
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
        return;
    }

    record.count++;
}

/**
 * Check if IP is currently rate limited using Redis.
 * Returns true if allowed to attempt login, false if blocked.
 */
async function isRateLimited(ip: string): Promise<boolean> {
    const key = `login:failed:${ip}`;

    try {
        const count = await redisClient.get(key);
        if (!count) return true; // No record = allowed
        return parseInt(count) < MAX_FAILED_ATTEMPTS;
    } catch (error) {
        Logger.warn('Rate limit check fallback to memory', { error });
        return isRateLimitedFallback(ip);
    }
}

/**
 * Increment failed login counter for IP in Redis.
 */
async function incrementFailedLogin(ip: string): Promise<void> {
    const windowSeconds = 60 * 60; // 1 hour
    const key = `login:failed:${ip}`;

    try {
        const count = await redisClient.incr(key);
        if (count === 1) {
            await redisClient.expire(key, windowSeconds);
        }
    } catch (error) {
        Logger.warn('Failed login increment fallback to memory', { error });
        incrementFailedLoginFallback(ip);
    }
}

function detectImageType(buffer: Buffer): { ext: string; mime: string } | null {
    if (buffer.length < 12) return null;

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { ext: '.jpg', mime: 'image/jpeg' };
    }
    // PNG
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
    ) {
        return { ext: '.png', mime: 'image/png' };
    }
    // GIF
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38
    ) {
        return { ext: '.gif', mime: 'image/gif' };
    }
    // WEBP (RIFF....WEBP)
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return { ext: '.webp', mime: 'image/webp' };
    }

    return null;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
    // Ensure upload directory exists
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    // REGISTER
    fastify.post('/register', async (request, reply) => {
        try {
            const parsed = registerSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0].message });
            }
            const { email, password, fullName } = parsed.data;

            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) return reply.code(400).send({ error: 'User already exists' });

            const passwordHash = await hashPassword(password);
            const userCount = await prisma.user.count();
            const isSuperAdmin = userCount === 0;

            const user = await prisma.user.create({
                data: { email, passwordHash, fullName, isSuperAdmin }
            });

            const token = generateToken({ userId: user.id });
            return { token, user: { id: user.id, email: user.email, fullName: user.fullName, avatarUrl: user.avatarUrl, isSuperAdmin: user.isSuperAdmin } };
        } catch (error) {
            Logger.error('Register error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // LOGIN
    fastify.post('/login', async (request, reply) => {
        try {
            const ip = request.ip;

            // Check if IP is currently rate limited (don't increment yet - only count failures)
            if (!(await isRateLimited(ip))) {
                return reply.code(429).send({ error: 'Too many login attempts, please try again later.' });
            }

            const parsed = loginSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0].message });
            }
            const { email, password, token: twoFactorToken } = parsed.data;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                // Increment failed attempt counter - only on actual failed login
                await incrementFailedLogin(ip);
                return reply.code(401).send({ error: 'Invalid credentials' });
            }

            const isValid = await comparePassword(password, user.passwordHash);
            if (!isValid) {
                // Increment failed attempt counter - only on actual failed login
                await incrementFailedLogin(ip);
                return reply.code(401).send({ error: 'Invalid credentials' });
            }

            // 2FA Check (successful password, check 2FA if enabled)
            if (user.isTwoFactorEnabled) {
                if (!twoFactorToken) {
                    return { requireTwoFactor: true };
                }
                const isTokenValid = SecurityService.verifyTwoFactorToken(twoFactorToken, user.twoFactorSecret!);
                if (!isTokenValid) {
                    // Increment failed attempt counter for bad 2FA
                    await incrementFailedLogin(ip);
                    return reply.code(401).send({ error: 'Invalid 2FA code' });
                }
            }

            // Successful login - no rate limit increment!
            const { accessToken, refreshToken } = await SecurityService.createSession(user.id, ip, request.headers['user-agent'] as string);

            return {
                token: accessToken,
                refreshToken,
                user: { id: user.id, email: user.email, fullName: user.fullName, avatarUrl: user.avatarUrl, isSuperAdmin: user.isSuperAdmin }
            };
        } catch (error) {
            Logger.error('Login error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // ME (Protected)
    fastify.get('/me', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const userId = request.user!.id;
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: { accounts: true }
            });
            if (!user) return reply.code(404).send({ error: 'User not found' });
            const { passwordHash, ...safeUser } = user;

            // If valid account context, resolve permissions
            const accountId = request.accountId;
            let permissions = {};
            if (accountId) {
                permissions = await PermissionService.resolvePermissions(userId, accountId);
            }

            return { ...safeUser, permissions };
        } catch (error) {
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // UPDATE PROFILE
    fastify.put('/me', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const userId = request.user!.id;
            const { fullName, shiftStart, shiftEnd, emailSignature } = request.body as any;
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: { fullName, shiftStart, shiftEnd, emailSignature }
            });
            const { passwordHash, ...safeUser } = updatedUser;
            return safeUser;
        } catch (error) {
            Logger.error('Update profile error', { error });
            return reply.code(500).send({ error: 'Failed to update profile' });
        }
    });

    // UPLOAD AVATAR
    fastify.post('/upload-avatar', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const userId = request.user!.id;
            const data = await request.file();
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });

            const fileBuffer = await data.toBuffer();
            const detected = detectImageType(fileBuffer);
            if (!detected) {
                return reply.code(400).send({ error: 'Only image files are allowed!' });
            }

            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const filename = 'avatar-' + uniqueSuffix + detected.ext;
            const filePath = path.join(uploadDir, filename);

            await fs.promises.writeFile(filePath, fileBuffer);

            const avatarUrl = `/uploads/${filename}`;
            await prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
            return { avatarUrl };
        } catch (error) {
            Logger.error('Upload error', { error });
            return reply.code(500).send({ error: 'Failed to upload avatar' });
        }
    });

    // FORGOT PASSWORD
    fastify.post('/forgot-password', async (request, reply) => {
        try {
            const { email } = request.body as { email?: string };
            if (!email) return reply.code(400).send({ error: 'Email is required' });

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return { message: 'If an account exists, a reset link has been sent.' };
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000);

            await prisma.user.update({
                where: { id: user.id },
                data: { resetToken, resetTokenExpiry }
            });

            const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&email=${email}`;

            if (process.env.SMTP_HOST) {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                });

                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"Overseek Security" <no-reply@overseek.com>',
                    to: email,
                    subject: 'Password Reset Request',
                    html: `<p>You requested a password reset. Click <a href="${resetLink}">here</a> to reset your password.</p>`
                });
            } else {
                Logger.debug(`Password Reset Link generated`, { email, resetLink });
            }

            return { message: 'If an account exists, a reset link has been sent.' };
        } catch (error) {
            Logger.error('Forgot password error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // RESET PASSWORD
    fastify.post('/reset-password', async (request, reply) => {
        try {
            const parsed = resetPasswordSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0].message });
            }
            const { email, token, newPassword } = parsed.data;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user || !user.resetToken || user.resetToken !== token || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
                return reply.code(400).send({ error: 'Invalid or expired token' });
            }

            const passwordHash = await hashPassword(newPassword);
            await prisma.user.update({
                where: { id: user.id },
                data: { passwordHash, resetToken: null, resetTokenExpiry: null }
            });

            return { message: 'Password has been reset successfully' };
        } catch (error) {
            Logger.error('Reset password error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // 2FA SETUP
    fastify.post('/2fa/setup', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
            if (!user) return reply.code(404).send({ error: 'User not found' });
            const { secret, qrCodeUrl } = await SecurityService.generateTwoFactorSecret(user);
            return { secret, qrCodeUrl };
        } catch (error) {
            Logger.error('2FA setup error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // 2FA VERIFY & ENABLE
    fastify.post('/2fa/verify', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { token, secret } = request.body as { token: string; secret: string };
            const isValid = SecurityService.verifyTwoFactorToken(token, secret);
            if (!isValid) return reply.code(400).send({ error: 'Invalid token' });
            const backupCodes = await SecurityService.enableTwoFactor(request.user!.id, secret);
            return { message: '2FA enabled successfully', backupCodes };
        } catch (error) {
            Logger.error('2FA verify error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // REFRESH TOKEN
    fastify.post('/refresh', async (request, reply) => {
        try {
            const { refreshToken } = request.body as { refreshToken?: string };
            if (!refreshToken) return reply.code(400).send({ error: 'Refresh token required' });
            const tokens = await SecurityService.refreshSession(refreshToken, request.ip, request.headers['user-agent'] as string);
            return tokens;
        } catch (error) {
            return reply.code(401).send({ error: 'Invalid or expired refresh token' });
        }
    });

    // REVOKE SESSION (LOGOUT)
    fastify.post('/revoke', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { refreshToken } = request.body as { refreshToken?: string };
            if (refreshToken) {
                await prisma.refreshToken.update({
                    where: { token: refreshToken },
                    data: { revokedAt: new Date() }
                });
            }
            return { message: 'Logged out successfully' };
        } catch (error) {
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // REVOKE ALL SESSIONS
    fastify.post('/revoke-all', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            await SecurityService.revokeUserSessions(request.user!.id);
            return { message: 'All sessions revoked' };
        } catch (error) {
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
};

export default authRoutes;

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { z } from 'zod';
import { validate } from '../middleware/validate';
import { SecurityService } from '../services/SecurityService';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const router = Router();

// Schemas
const registerSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        fullName: z.string().min(2, 'Full name is required')
    })
});

const loginSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string()
    })
});

// Configure Multer
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// REGISTER
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
    try {
        const { email, password, fullName } = req.body;

        // Validation handled by middleware

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const passwordHash = await hashPassword(password);
        const userCount = await prisma.user.count();
        const isSuperAdmin = userCount === 0;

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                fullName,
                isSuperAdmin
            }
        });

        const token = generateToken({ userId: user.id });

        res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin } });
    } catch (error) {
        Logger.error('Register error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// LOGIN
// Strict Rate Limit for Login: 5 attempts per hour
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 login requests per hour
    message: { error: 'Too many login attempts, please try again after an hour.' }
});

router.post('/login', loginLimiter, validate(loginSchema), async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValid = await comparePassword(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 2FA Check
        if (user.isTwoFactorEnabled) {
            const { token } = req.body; // User must send 2FA token if enabled
            if (!token) {
                return res.json({ requireTwoFactor: true }); // Client should prompt for code
            }

            const isTokenValid = SecurityService.verifyTwoFactorToken(token, user.twoFactorSecret!);
            if (!isTokenValid) {
                return res.status(401).json({ error: 'Invalid 2FA code' });
            }
        }

        // Create Session (Access + Refresh)
        const { accessToken, refreshToken } = await SecurityService.createSession(user.id, req.ip, req.get('user-agent'));

        res.json({
            token: accessToken,
            refreshToken,
            user: { id: user.id, email: user.email, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ME (Protected)
router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { accounts: true }
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        // safe return excluding password
        const { passwordHash, ...safeUser } = user;
        res.json(safeUser);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UPDATE PROFILE
router.put('/me', requireAuth, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const { fullName, shiftStart, shiftEnd } = req.body;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                fullName,
                shiftStart,
                shiftEnd
            }
        });

        const { passwordHash, ...safeUser } = updatedUser;
        res.json(safeUser);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// UPLOAD AVATAR
router.post('/upload-avatar', requireAuth, upload.single('avatar'), async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const avatarUrl = `/uploads/${req.file.filename}`;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { avatarUrl }
        });

        res.json({ avatarUrl });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Use generic message to prevent enumeration
            return res.json({ message: 'If an account exists, a reset link has been sent.' });
        }

        // Generate Token
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

        // Hashing access token
        const resetTokenHash = await generateToken({ token: resetToken }); // Re-using jwt or generic hash?
        // Actually, schema has resetToken string. Let's just store the token or a hash.
        // Simple hash for security:
        // const hash = crypto.createHash('sha256').update(resetToken).digest('hex');

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken: resetToken, // Storing plain for MVP, ideally hash
                resetTokenExpiry
            }
        });

        // Send Email
        const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&email=${email}`;

        // Use system SMTP or log for dev
        if (process.env.SMTP_HOST) {
            const transporter = require('nodemailer').createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
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

        res.json({ message: 'If an account exists, a reset link has been sent.' });

    } catch (error) {
        Logger.error('Forgot password error', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// RESET PASSWORD
const resetPasswordSchema = z.object({
    body: z.object({
        email: z.string().email(),
        token: z.string(),
        newPassword: z.string().min(8, 'Password must be at least 8 characters')
    })
});

router.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response) => {
    try {
        const { email, token, newPassword } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user ||
            !user.resetToken ||
            user.resetToken !== token ||
            !user.resetTokenExpiry ||
            user.resetTokenExpiry < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        const passwordHash = await hashPassword(newPassword);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null
            }
        });

        res.json({ message: 'Password has been reset successfully' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2FA SETUP
router.post('/2fa/setup', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { secret, qrCodeUrl } = await SecurityService.generateTwoFactorSecret(user);

        // Verify endpoint needed to confirm and save
        res.json({ secret, qrCodeUrl });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2FA VERIFY & ENABLE
router.post('/2fa/verify', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { token, secret } = req.body;

        const isValid = SecurityService.verifyTwoFactorToken(token, secret);
        if (!isValid) return res.status(400).json({ error: 'Invalid token' });

        const backupCodes = await SecurityService.enableTwoFactor(req.user!.id, secret);

        res.json({ message: '2FA enabled successfully', backupCodes });
    } catch (error) {
        console.error('2FA verify error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// REFRESH TOKEN
router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

        const tokens = await SecurityService.refreshSession(refreshToken, req.ip, req.get('user-agent'));

        res.json(tokens);
    } catch (error) {
        // console.error('Refresh error:', error); // Don't log expected auth failures as system errors
        res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

// REVOKE SESSION (LOGOUT)
router.post('/revoke', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        // Ideally pass specific token to revoke just that one, or revoke all for user
        // For now, let's just revoke all for security or add specific logic later
        // But typically logout = revoke current refresh token.
        // We'd need to send the refresh token in the body to revoke IT specifically.
        const { refreshToken } = req.body;
        if (refreshToken) {
            await prisma.refreshToken.update({
                where: { token: refreshToken },
                data: { revokedAt: new Date() }
            });
        }
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// REVOKE ALL SESSIONS
router.post('/revoke-all', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        await SecurityService.revokeUserSessions(req.user!.id);
        res.json({ message: 'All sessions revoked' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

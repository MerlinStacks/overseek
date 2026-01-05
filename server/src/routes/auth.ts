import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

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

const upload = multer({ storage: storage });

// REGISTER
router.post('/register', async (req: Request, res: Response) => {
    try {
        const { email, password, fullName } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

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
        console.error('Register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// LOGIN
// Strict Rate Limit for Login: 5 attempts per hour
import rateLimit from 'express-rate-limit';
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 login requests per hour
    message: { error: 'Too many login attempts, please try again after an hour.' }
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
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

        const token = generateToken({ userId: user.id });
        res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin } });
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

export default router;

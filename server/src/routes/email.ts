import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { EmailService } from '../services/EmailService';
import { requireAuth } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/encryption';

const router = Router();
const emailService = new EmailService();

router.use(requireAuth);

// List Accounts
router.get('/accounts', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).user?.accountId || (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const accounts = await prisma.emailAccount.findMany({
            where: { accountId }
        });

        // Return masked passwords
        const masked = accounts.map(a => ({
            ...a,
            password: '••••••••'
        }));

        res.json(masked);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list email accounts' });
    }
});

// Create Account
router.post('/accounts', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).user?.accountId || (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const { name, email, host, port, username, password, type, isSecure } = req.body;

        // Basic validation
        if (!host || !port || !username || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const account = await prisma.emailAccount.create({
            data: {
                accountId,
                name,
                email,
                host,
                port: parseInt(port),
                username,
                password: encrypt(password),
                type,
                isSecure: Boolean(isSecure)
            }
        });

        res.json({ ...account, password: '••••••••' });
    } catch (error) {
        Logger.error('Error', { error });
        res.status(500).json({ error: 'Failed to create email account' });
    }
});

// Update Account
router.put('/accounts/:id', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).user?.accountId || (req as any).accountId;
        const { id } = req.params;
        const data = req.body;

        const existing = await prisma.emailAccount.findFirst({
            where: { id, accountId }
        });

        if (!existing) return res.status(404).json({ error: 'Account not found' });

        const updateData: any = {
            name: data.name,
            email: data.email,
            host: data.host,
            port: data.port ? parseInt(data.port) : undefined,
            username: data.username,
            type: data.type,
            isSecure: Boolean(data.isSecure),
            updatedAt: new Date()
        };

        if (data.password && data.password !== '••••••••') {
            updateData.password = encrypt(data.password);
        }

        const updated = await prisma.emailAccount.update({
            where: { id },
            data: updateData
        });

        res.json({ ...updated, password: '••••••••' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update email account' });
    }
});

// Delete Account
router.delete('/accounts/:id', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).user?.accountId || (req as any).accountId;
        const { id } = req.params;
        const result = await prisma.emailAccount.deleteMany({
            where: { id, accountId }
        });

        if (result.count === 0) return res.status(404).json({ error: 'Account not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// Test Connection
router.post('/test', async (req: Request, res: Response) => {
    try {
        const { id, host, port, username, password, type, isSecure } = req.body;
        const accountId = (req as any).user?.accountId || (req as any).accountId;

        let passwordToTest = password;

        // If password is masked and we have an ID (verifying existing account), fetch real password
        if (password === '••••••••' && id && accountId) {
            const existing = await prisma.emailAccount.findFirst({
                where: { id, accountId }
            });
            if (existing && existing.password) {
                // Decrypt stored password
                try {
                    passwordToTest = decrypt(existing.password);
                } catch (e) {
                    Logger.error('Decryption failed for test', { error: e });
                    // Fallback to existing logic (will fail auth likely)
                }
            }
        }

        const mockAccount: any = {
            host,
            port: parseInt(port),
            username,
            password: passwordToTest,
            type,
            isSecure: Boolean(isSecure)
        };

        const success = await emailService.verifyConnection(mockAccount);
        res.json({ success });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export default router;

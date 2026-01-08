import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';


export class AccountUserController {
    static async listUsers(req: Request, res: Response) {
        try {
            const { accountId } = req.params;
            const userId = (req as any).user.id;

            // Verify membership
            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } }
            });
            if (!membership) return res.status(403).json({ error: 'Forbidden' });

            const users = await prisma.accountUser.findMany({
                where: { accountId },
                include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true } } }
            });

            res.json(users);
        } catch (e) {
            res.status(500).json({ error: 'Failed' });
        }
    }

    static async addUser(req: Request, res: Response) {
        try {
            const { accountId } = req.params;
            const { email, role } = req.body;
            const userId = (req as any).user.id;

            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } }
            });
            if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const targetUser = await prisma.user.findUnique({ where: { email } });
            if (!targetUser) return res.status(404).json({ error: 'User not found. They must register first.' });

            const exists = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId: targetUser.id, accountId } }
            });
            if (exists) return res.status(400).json({ error: 'User already in account' });

            const newUser = await prisma.accountUser.create({
                data: {
                    accountId,
                    userId: targetUser.id,
                    role: role || 'STAFF'
                },
                include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true } } }
            });

            res.json(newUser);
        } catch (e) {
            Logger.error('Failed to add user to account', { error: e });
            res.status(500).json({ error: 'Failed' });
        }
    }

    static async removeUser(req: Request, res: Response) {
        try {
            const { accountId, targetUserId } = req.params;
            const userId = (req as any).user.id;

            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } }
            });

            if (!membership || membership.role !== 'OWNER') {
                if (userId !== targetUserId && membership?.role !== 'OWNER') {
                    return res.status(403).json({ error: 'Forbidden' });
                }
            }

            await prisma.accountUser.delete({
                where: { userId_accountId: { userId: targetUserId, accountId } }
            });

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Failed' });
        }
    }
}

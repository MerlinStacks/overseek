import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { IndexingService } from '../services/search/IndexingService';
import { GoldPriceService } from '../services/GoldPriceService';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// CREATE Account (Wizard)
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    console.log('[CreateAccount] Request received for User:', userId);
    console.log('[CreateAccount] Body:', JSON.stringify(req.body, null, 2));

    const { name, domain, wooUrl, wooConsumerKey, wooConsumerSecret } = req.body;

    if (!name || !wooUrl || !wooConsumerKey || !wooConsumerSecret) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify user exists (Zombie token check)
    const validUser = await prisma.user.findUnique({ where: { id: userId } });


    if (!validUser) {

      return res.status(401).json({ error: 'User invalid. Please login again.' });
    }



    try {

      // Create Account and link to User as OWNER
      const account = await prisma.account.create({
        data: {
          name,
          domain,
          wooUrl,
          wooConsumerKey,
          wooConsumerSecret, // In production, ENCRYPT THIS!
          users: {
            create: {
              userId,
              role: 'OWNER'
            }
          }
        }
      });



      res.json(account);
    } catch (e: any) {
      if (e.code === 'P2003') {
        console.warn(`[CreateAccount] Race condition detected: User ${userId} not found during link.`);
        return res.status(401).json({ error: 'User invalid. Please login again.' });
      }
      throw e;
    }
  } catch (error) {
    console.error('Create Account error:', JSON.stringify(error, Object.getOwnPropertyNames(error as any), 2));
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  }
});

// GET User's Accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID missing' });
    }

    const accounts = await prisma.account.findMany({
      where: {
        users: {
          some: { userId }
        }
      },
      include: { features: true } // Include feature flags
    });
    res.json(accounts);
  } catch (error) {
    console.error('Get Accounts Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET Account Users
router.get('/:accountId/users', async (req: Request, res: Response) => {
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
});

// ADD User to Account
router.post('/:accountId/users', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const { email, role } = req.body;
    const userId = (req as any).user.id;

    // Verify permission (Owner or Admin)
    const membership = await prisma.accountUser.findUnique({
      where: { userId_accountId: { userId, accountId } }
    });
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Find Target User
    const targetUser = await prisma.user.findUnique({ where: { email } });
    if (!targetUser) return res.status(404).json({ error: 'User not found. They must register first.' });

    // Check if already member
    const exists = await prisma.accountUser.findUnique({
      where: { userId_accountId: { userId: targetUser.id, accountId } }
    });
    if (exists) return res.status(400).json({ error: 'User already in account' });

    // Add User
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
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

// REMOVE User from Account
router.delete('/:accountId/users/:targetUserId', async (req: Request, res: Response) => {
  try {
    const { accountId, targetUserId } = req.params;
    const userId = (req as any).user.id;

    // Verify permission
    const membership = await prisma.accountUser.findUnique({
      where: { userId_accountId: { userId, accountId } }
    });

    if (!membership || membership.role !== 'OWNER') {
      // Admin can remove staff but not Owner? Let's keep simpler: Only Owner or Self can remove.
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
});

// UPDATE Account (Settings)
router.put('/:accountId', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const { name, domain, wooUrl, wooConsumerKey, wooConsumerSecret, openRouterApiKey, aiModel, appearance, goldPrice, refreshGoldPrice } = req.body;
    const userId = (req as any).user.id;

    // Check permission
    const membership = await prisma.accountUser.findUnique({
      where: { userId_accountId: { userId, accountId } }
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data: any = {
      name,
      domain,
      wooUrl,
      wooConsumerKey,
      openRouterApiKey,
      aiModel,
      appearance
    };

    // Only update secret if provided (to allow leaving it blank in UI to keep existing)
    // The UI sends "" when the user hasn't typed a new secret.
    if (wooConsumerSecret && wooConsumerSecret.trim() !== '') {
      data.wooConsumerSecret = wooConsumerSecret;
    } else {
      // Explicitly remove it from data object so Prisma doesn't update it with undefined/null if it got in there
      delete data.wooConsumerSecret;
    }

    const updated = await prisma.account.update({
      where: { id: accountId },
      data
    });

    // Handle Gold Price Refresh or Set
    if (refreshGoldPrice) {
      await GoldPriceService.updateAccountPrice(accountId);
      // Fetch updated to return
      const fresh = await prisma.account.findUnique({ where: { id: accountId } });
      return res.json(fresh);
    } else if (goldPrice !== undefined) {
      // If goldPrice is passed explicitly (manual override)
      await GoldPriceService.updateAccountPrice(accountId, parseFloat(goldPrice));
      // Fetch updated
      const fresh = await prisma.account.findUnique({ where: { id: accountId } });
      return res.json(fresh);
    }


    res.json(updated);
  } catch (error) {
    console.error("Update account error", error);
    res.status(500).json({ error: "Failed to update account" });
  }
});

// DELETE Account (Owner or Super Admin)
router.delete('/:accountId', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user.id;

    // Check if Super Admin
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isSuperAdmin = user?.isSuperAdmin === true;

    if (!isSuperAdmin) {
      // Check if Owner
      const membership = await prisma.accountUser.findUnique({
        where: { userId_accountId: { userId, accountId } }
      });

      if (!membership || membership.role !== 'OWNER') {
        return res.status(403).json({ error: 'Forbidden. Only Owners or Super Admins can delete accounts.' });
      }
    }

    // Delete from Elasticsearch
    await IndexingService.deleteAccountData(accountId);

    // Delete from Database
    await prisma.account.delete({
      where: { id: accountId }
    });

    res.json({ success: true, message: 'Account deleted successfully' });

  } catch (error) {
    console.error('Delete Account Error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;

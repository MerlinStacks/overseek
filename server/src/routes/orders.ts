import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Protect all order routes
router.use(requireAuth);

// Get Order by ID (Internal ID or WooID)
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    // Safe cast because requireAuth middleware guarantees req.user exists, 
    // and strict enforcement checks for accountId in this route path if configured, 
    // but explicit check is better for type safety.
    const authReq = req as AuthRequest;
    const accountId = authReq.user?.accountId;

    if (!accountId) {
        return res.status(400).json({ error: 'accountId header is required' });
    }

    // console.log(`[API] Fetching order ${id} for account ${accountId}`);

    try {
        let order;

        // Try finding by internal UUID first
        order = await prisma.wooOrder.findUnique({
            where: { id: id }
        });

        // If not found and ID is numeric, try finding by WooID
        if (!order && !isNaN(Number(id))) {
            // console.log(`[API] ID is numeric, trying lookup by wooId: ${id}`);
            order = await prisma.wooOrder.findUnique({
                where: {
                    accountId_wooId: {
                        accountId,
                        wooId: Number(id)
                    }
                }
            });
        }

        if (!order) {
            // console.warn(`[API] Order ${id} not found in DB`);
            return res.status(404).json({ error: 'Order not found' });
        }

        // Ensure the order belongs to the requesting account (security check)
        if (order.accountId !== accountId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Return the raw data which contains all the nice Woo fields
        // We also merge the internal status/id for convenience
        res.json({
            ...order.rawData as object,
            internal_id: order.id,
            internal_status: order.status,
            internal_updated_at: order.updatedAt
        });

    } catch (error) {
        Logger.error('Failed to fetch order', { error });
        res.status(500).json({ error: 'Failed to fetch order details' });
    }
});

export default router;

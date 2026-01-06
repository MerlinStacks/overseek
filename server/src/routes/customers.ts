import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { CustomersService } from '../services/customers';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        // Middleware guarantees accountId or returns 400

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const query = (req.query.q as string) || '';

        const result = await CustomersService.searchCustomers(accountId, query, page, limit);
        res.json(result);
    } catch (error: any) {
        Logger.error('Failed to fetch customers', { error });
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        Logger.debug(`GET /customers/${req.params.id}`, { accountId: (req as any).accountId });
        const accountId = (req as any).accountId;
        const customerId = req.params.id;

        const result = await CustomersService.getCustomerDetails(accountId, customerId);

        if (!result) {
            Logger.debug(`Customer not found`, { customerId: req.params.id });
            res.status(404).json({ error: 'Customer not found' });
            return;
        }

        res.json(result);
    } catch (error: any) {
        Logger.error('Get Customer Details Error', { error });
        res.status(500).json({ error: 'Failed to fetch customer details' });
    }
});

export default router;

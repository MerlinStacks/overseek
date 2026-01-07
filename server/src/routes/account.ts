import { Router, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { AccountController } from '../controllers/AccountController';
import { AccountUserController } from '../controllers/AccountUserController';
import { OrderTaggingService } from '../services/OrderTaggingService';
import { AuthenticatedRequest } from '../types/express';

const router = Router();

router.use(requireAuth);

// Account Management
router.post('/', AccountController.create);
router.get('/', AccountController.getAll);
router.put('/:accountId', AccountController.update);
router.delete('/:accountId', AccountController.delete);

// User Management
router.get('/:accountId/users', AccountUserController.listUsers);
router.post('/:accountId/users', AccountUserController.addUser);
router.delete('/:accountId/users/:targetUserId', AccountUserController.removeUser);

// Tag Mappings
router.get('/:accountId/tag-mappings', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const mappings = await OrderTaggingService.getTagMappings(req.params.accountId);
        res.json({ mappings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get tag mappings' });
    }
});

router.put('/:accountId/tag-mappings', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { mappings } = req.body;
        if (!Array.isArray(mappings)) {
            return res.status(400).json({ error: 'mappings must be an array' });
        }
        await OrderTaggingService.saveTagMappings(req.params.accountId, mappings);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save tag mappings' });
    }
});

// Get available product tags for mapping
router.get('/:accountId/product-tags', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const tags = await OrderTaggingService.getAllProductTags(req.params.accountId);
        res.json({ tags });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get product tags' });
    }
});

// Sync WooCommerce store settings (weight/dimension units, currency)
router.post('/:accountId/sync-settings', async (req: AuthenticatedRequest, res: Response) => {
    const { WooService } = await import('../services/woo');
    const { prisma } = await import('../utils/prisma');
    const { Logger } = await import('../utils/logger');

    try {
        const { accountId } = req.params;

        const wooService = await WooService.forAccount(accountId);
        const storeSettings = await wooService.getStoreSettings();

        const updatedAccount = await prisma.account.update({
            where: { id: accountId },
            data: {
                weightUnit: storeSettings.weightUnit,
                dimensionUnit: storeSettings.dimensionUnit,
                currency: storeSettings.currency
            }
        });

        Logger.info('Synced WooCommerce store settings', { accountId, settings: storeSettings });

        res.json({
            success: true,
            weightUnit: updatedAccount.weightUnit,
            dimensionUnit: updatedAccount.dimensionUnit,
            currency: updatedAccount.currency
        });
    } catch (error) {
        Logger.error('Failed to sync WooCommerce settings', { accountId: req.params.accountId, error });
        res.status(500).json({ error: 'Failed to sync WooCommerce settings' });
    }
});

export default router;

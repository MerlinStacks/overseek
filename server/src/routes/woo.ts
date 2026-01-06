import { Router, Request, Response } from 'express';
import { WooService } from '../services/woo';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/orders', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const woo = await WooService.forAccount(accountId);
        const orders = await woo.getOrders({ per_page: 20 });

        res.json(orders);
    } catch (error: any) {
        console.error('Woo API Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

router.get('/products', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const woo = await WooService.forAccount(accountId);
        // Pass standard Woo query params (search, page, per_page, etc.)
        const products = await woo.getProducts({
            ...req.query,
            per_page: Number(req.query.per_page) || 20
        });

        res.json(products);
    } catch (error: any) {
        console.error('Woo API Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

router.post('/configure', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { origin, wooUrl, wooConsumerKey, wooConsumerSecret } = req.body; // Client sends its current origin + credentials

        if (!accountId) return res.status(400).json({ error: 'No account selected' });
        // Clean origin to remove trailing slash
        const cleanOrigin = origin ? origin.replace(/\/$/, '') : '';
        if (!cleanOrigin) return res.status(400).json({ error: 'Origin URL is required' });

        let woo;
        if (wooUrl && wooConsumerKey && wooConsumerSecret) {
            // Use provided credentials (fresh from form)
            woo = new WooService({
                url: wooUrl,
                consumerKey: wooConsumerKey,
                consumerSecret: wooConsumerSecret,
                accountId: accountId
            });
        } else {
            // Fallback to saved credentials
            woo = await WooService.forAccount(accountId);
        }

        // Push configuration to the plugin
        // We send the origin as the API URL, and the account ID
        const result = await woo.updatePluginSettings({
            account_id: accountId,
            api_url: cleanOrigin
        });

        res.json({ success: true, plugin_response: result });
    } catch (error: any) {
        const errorDetails = {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            headers: error.response?.headers,
            url: error.config?.url
        };
        console.error('Woo Configuration Error:', JSON.stringify(errorDetails, null, 2));

        // Write to a temporary debug file for deeper inspection if needed
        require('fs').writeFileSync('debug_woo_error.json', JSON.stringify(errorDetails, null, 2));

        // Determine a friendlier error message
        let userMessage = 'Failed to configure plugin';
        if (error.response?.status === 404) {
            userMessage = 'Plugin endpoint not found on your store. Please ensure the OverSeek Helper Plugin is installed and active.';
        } else if (error.code === 'ENOTFOUND') {
            userMessage = 'Could not DNS resolve your store URL. Please check your domain settings.';
        } else if (error.message.includes('ECONNREFUSED')) {
            userMessage = 'Connection refused. Is your store server reachable?';
        }

        res.status(500).json({
            error: `${userMessage} (${error.message}) - ${JSON.stringify(error.response?.data || {})}`,
            technical_details: error.message,
            woo_response: error.response?.data
        });
    }
});

export default router;

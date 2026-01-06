import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { SyncService } from '../services/sync';
import { IndexingService } from '../services/search/IndexingService';
import { io } from '../app';

const router = Router();

// Helper to verify WooCommerce Signature
const verifySignature = (payload: any, signature: string, secret: string) => {
    // Woo sends signature as base64 encoded HMAC-SHA256
    const hash = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload)) // Note: Raw body is better, but Express default JSON parser modifies it. 
        // In a perfect world, we'd use raw-body. For now, we assume standard JSON behavior matches Woo's encoding.
        // If this fails often, we need to switch to capturing raw buffer.
        .digest('base64');
    return hash === signature;
};

// Webhook Endpoint
// WooCommerce sends topic in header: "x-wc-webhook-topic": "order.created"
// And signature: "x-wc-webhook-signature": "..."
router.post('/:accountId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { accountId } = req.params;
        const signature = req.headers['x-wc-webhook-signature'] as string;
        const topic = req.headers['x-wc-webhook-topic'] as string;

        if (!signature || !topic) {
            return res.status(400).send('Missing headers');
        }

        Logger.info(`Received Webhook`, { accountId, topic });

        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) return res.status(404).send('Account not found');

        // SECURITY: Verify Signature
        // account.webhookSecret is preferred, falling back to wooConsumerSecret for legacy compatibility.
        const secret = account.webhookSecret || account.wooConsumerSecret;

        if (secret) {
            // Verify signature using best-effort standard JSON stringify.
            const isValid = verifySignature(req.body, signature, secret);

            if (!isValid) {
                Logger.warn(`Invalid Webhook Signature`, { accountId });
                // Enforcing security check:
                return res.status(401).send('Invalid Signature');
            }
        } else {
            Logger.warn(`No credentials to verify webhook`, { accountId });
            // Reject unverified webhooks if no secret exists
            return res.status(401).send('No Webhook Secret Configured');
        }

        // Handle Order Events
        if (topic === 'order.created' || topic === 'order.updated') {
            // Upsert Logic ... (Assuming Webhook logic exists here)
            // Just replace the index call
            await IndexingService.indexOrder(accountId, req.body);

            // Create Notification for new orders
            if (topic === 'order.created') {
                await prisma.notification.create({
                    data: {
                        accountId,
                        title: 'New Order Received',
                        message: `Order #${req.body.number || req.body.id} has been placed.`,
                        type: 'SUCCESS',
                        link: '/orders'
                    }
                });

                // Emit socket event for real-time browser notifications
                io.to(`account:${accountId}`).emit('order:new', {
                    orderId: req.body.id,
                    orderNumber: req.body.number || req.body.id,
                    total: req.body.total,
                    customerName: req.body.billing?.first_name
                        ? `${req.body.billing.first_name} ${req.body.billing.last_name || ''}`.trim()
                        : 'Guest'
                });
            }
            Logger.info(`Indexed Order`, { orderId: req.body.id, accountId });
        }

        // Handle Product Events
        if (topic === 'product.created' || topic === 'product.updated') {
            await IndexingService.indexProduct(accountId, req.body);
            Logger.info(`Indexed Product`, { productId: req.body.id, accountId });
        }

        // Handle Customer Events
        if (topic === 'customer.created' || topic === 'customer.updated') {
            await IndexingService.indexCustomer(accountId, req.body);
            Logger.info(`Indexed Customer`, { customerId: req.body.id, accountId });
        }

        res.status(200).send('Webhook received');
    } catch (error) {
        Logger.error('Webhook Error', { error });
        res.status(500).send('Server Error');
    }
});

export default router;

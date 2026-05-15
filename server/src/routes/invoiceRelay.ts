import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { authenticateRelayEmailAccount } from './email/helpers';
import { canonicalInvoiceService } from '../services/CanonicalInvoiceService';

const InvoiceRelayBodySchema = z.object({
    account_id: z.string().min(1),
    order_id: z.string().min(1),
    order_number: z.string().optional(),
    store_url: z.string().optional(),
});

const invoiceRelayRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/woocommerce-processing', async (request, reply) => {
        const relayKey = request.headers['x-relay-key'];
        const relayKeyValue = typeof relayKey === 'string' ? relayKey : undefined;
        if (!relayKeyValue) {
            return reply.code(401).send({ success: false, error: 'Missing relay key' });
        }

        const parsed = InvoiceRelayBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ success: false, error: 'Invalid payload' });
        }

        const { account_id: accountId, order_id: orderId } = parsed.data;

        const relayAccount = await authenticateRelayEmailAccount(relayKeyValue);
        if (!relayAccount || relayAccount.accountId !== accountId) {
            return reply.code(403).send({ success: false, error: 'Invalid relay authentication' });
        }

        try {
            const artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId);
            const settled: any = await canonicalInvoiceService.waitForReady(artifact.id, 2200, 250);

            if (canonicalInvoiceService.isReadableReady(settled)) {
                const fileBuffer = fs.readFileSync(settled.storagePath);
                return {
                    success: true,
                    invoice_ref: settled.id,
                    pdf_base64: fileBuffer.toString('base64'),
                    filename: settled.storagePath.split('/').pop() || 'invoice.pdf',
                    renderer_used: settled.renderer,
                };
            }

            if (settled?.status === 'failed') {
                return reply.code(409).send({
                    success: false,
                    status: 'failed',
                    invoice_ref: settled.id,
                    error: settled.errorMessage || 'Invoice generation failed',
                    renderer_used: settled.renderer,
                });
            }

            return reply.code(202).send({
                success: false,
                status: 'pending',
                invoice_ref: settled?.id ?? artifact.id,
                error: 'Invoice generation is pending',
            });
        } catch (error) {
            Logger.error('Failed to generate relay invoice PDF', { error, accountId, orderId });
            return reply.code(500).send({ success: false, error: 'Failed to generate invoice' });
        }
    });
};

export default invoiceRelayRoutes;

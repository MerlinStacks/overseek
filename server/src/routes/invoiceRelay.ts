import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { authenticateRelayEmailAccount } from './email/helpers';
import { prisma } from '../utils/prisma';
import { InvoiceService } from '../services/InvoiceService';
import path from 'path';

const invoiceService = new InvoiceService();
const invoiceDir = path.join(__dirname, '../../uploads/invoices');

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
            const cachedInvoice = await prisma.wooOrder.findFirst({
                where: {
                    accountId,
                    OR: [
                        { id: orderId },
                        ...(Number.isFinite(Number(orderId)) ? [{ wooId: Number(orderId) }] : []),
                    ],
                },
                select: { number: true },
            });

            const orderNumber = cachedInvoice?.number || orderId;
            const cachePrefix = `invoice-${orderNumber}-`;
            const cachePath = findMostRecentInvoicePath(cachePrefix, 24 * 60 * 60 * 1000);

            if (cachePath) {
                const cachedFileBuffer = fs.readFileSync(cachePath);
                return {
                    success: true,
                    invoice_ref: `${accountId}:${orderId}:cached`,
                    pdf_base64: cachedFileBuffer.toString('base64'),
                    filename: path.basename(cachePath),
                };
            }

            const template = await prisma.invoiceTemplate.findFirst({
                where: { accountId },
                orderBy: { updatedAt: 'desc' },
                select: { id: true },
            });

            if (!template) {
                return reply.code(404).send({ success: false, error: 'No invoice template found for account' });
            }

            const generated = await invoiceService.generateInvoicePdf(accountId, orderId, template.id);
            const fileBuffer = fs.readFileSync(generated.absolutePath);

            return {
                success: true,
                invoice_ref: `${accountId}:${orderId}:${Date.now()}`,
                pdf_base64: fileBuffer.toString('base64'),
                filename: generated.absolutePath.split('/').pop() || 'invoice.pdf',
            };
        } catch (error) {
            Logger.error('Failed to generate relay invoice PDF', { error, accountId, orderId });
            return reply.code(500).send({ success: false, error: 'Failed to generate invoice' });
        }
    });
};

function findMostRecentInvoicePath(prefix: string, maxAgeMs: number): string | null {
    if (!fs.existsSync(invoiceDir)) {
        return null;
    }

    const files = fs.readdirSync(invoiceDir)
        .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.pdf'))
        .map((fileName) => path.join(invoiceDir, fileName));

    if (files.length === 0) {
        return null;
    }

    const now = Date.now();
    const recent = files
        .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
        .filter(({ stat }) => now - stat.mtimeMs <= maxAgeMs)
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    return recent[0]?.filePath ?? null;
}

export default invoiceRelayRoutes;

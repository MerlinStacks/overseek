import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { mergeInvoiceSettings } from '@overseek/core';
import { Logger } from '../utils/logger';
import { authenticateRelayEmailAccount } from './email/helpers';
import { canonicalInvoiceService } from '../services/CanonicalInvoiceService';
import { prisma } from '../utils/prisma';

function isCanonicalRenderer(renderer: string | null | undefined): boolean {
    return renderer === 'designer-capture' || renderer === 'designer-capture-browser';
}

function getCanonicalSigningSecret(): string {
    return String(
        process.env.INVOICE_CANONICAL_SIGNING_SECRET
        || process.env.RELAY_WEBHOOK_SECRET
        || process.env.JWT_SECRET
        || 'overseek-canonical-invoice-secret'
    );
}

function signCanonicalPayload(artifactId: string, expires: number): string {
    return createHmac('sha256', getCanonicalSigningSecret())
        .update(`${artifactId}:${expires}`)
        .digest('hex');
}

function verifyCanonicalSignature(artifactId: string, expires: number, signature: string): boolean {
    const expected = signCanonicalPayload(artifactId, expires);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
}

async function buildCanonicalPayload(accountId: string, orderId: string, templateId: string) {
    const orderNum = Number(orderId);
    const order = await prisma.wooOrder.findFirst({
        where: {
            accountId,
            OR: [
                { id: orderId },
                ...(Number.isFinite(orderNum) ? [{ wooId: orderNum }] : [])
            ]
        }
    });
    if (!order) throw new Error('Order not found for canonical rendering');

    const template = await prisma.invoiceTemplate.findFirst({
        where: { id: templateId, accountId }
    });
    if (!template) throw new Error('Invoice template not found for canonical rendering');

    const rawLayout = typeof template.layout === 'string' ? JSON.parse(template.layout) : (template.layout || {});
    const settings = mergeInvoiceSettings(rawLayout.settings || {});
    const layout = Array.isArray(rawLayout.grid) ? rawLayout.grid : [];
    const items = Array.isArray(rawLayout.items) ? rawLayout.items : [];
    const rawOrder = (order.rawData as any) || {};

    return {
        layout,
        items,
        settings,
        order: {
            ...rawOrder,
            id: order.id,
            number: order.number,
            order_number: order.number,
            total: order.total,
            shipping_total: rawOrder.shipping_total ?? 0,
            tax_total: rawOrder.total_tax ?? 0,
            date_created: rawOrder.date_created || order.createdAt,
        }
    };
}

function computeRelayDiagnostic(artifact: any, forceRegenerate: boolean): string | null {
    if (forceRegenerate) return 'forced_refresh';
    if (!artifact) return 'missing_artifact';
    if (artifact.status !== 'ready') return 'not_ready';
    if (!artifact.storagePath || !fs.existsSync(artifact.storagePath)) return 'missing_file';
    if (!isCanonicalRenderer(artifact.renderer)) return 'non_canonical_renderer';

    const cutoffRaw = String(process.env.INVOICE_CANONICAL_INVALIDATE_BEFORE || '').trim();
    if (cutoffRaw && artifact.generatedAt) {
        const cutoff = new Date(cutoffRaw);
        const generatedAt = new Date(artifact.generatedAt);
        if (!Number.isNaN(cutoff.getTime()) && !Number.isNaN(generatedAt.getTime()) && generatedAt < cutoff) {
            return 'generated_before_cutoff';
        }
    }

    return null;
}

const InvoiceRelayBodySchema = z.object({
    account_id: z.string().min(1),
    order_id: z.string().min(1),
    order_number: z.string().optional(),
    store_url: z.string().optional(),
    force_regenerate: z.boolean().optional(),
});

const CanonicalPayloadParamsSchema = z.object({
    artifactId: z.string().min(1),
});

const CanonicalPayloadQuerySchema = z.object({
    expires: z.coerce.number().int().positive(),
    sig: z.string().min(1),
});

const invoiceRelayRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/canonical-print-payload/:artifactId', async (request, reply) => {
        const parsedParams = CanonicalPayloadParamsSchema.safeParse(request.params);
        const parsedQuery = CanonicalPayloadQuerySchema.safeParse(request.query);
        if (!parsedParams.success || !parsedQuery.success) {
            return reply.code(400).send({ success: false, error: 'Invalid canonical payload request' });
        }

        const { artifactId } = parsedParams.data;
        const { expires, sig } = parsedQuery.data;

        if (Date.now() > expires) {
            return reply.code(401).send({ success: false, error: 'Canonical payload request expired' });
        }

        if (!verifyCanonicalSignature(artifactId, expires, sig)) {
            return reply.code(401).send({ success: false, error: 'Invalid canonical payload signature' });
        }

        const artifact = await canonicalInvoiceService.getArtifactById(artifactId);
        if (!artifact) {
            return reply.code(404).send({ success: false, error: 'Invoice artifact not found' });
        }

        try {
            const payload = await buildCanonicalPayload(artifact.accountId, artifact.orderId, artifact.templateId);
            return { success: true, payload };
        } catch (error) {
            Logger.error('Failed to build canonical print payload', {
                artifactId,
                error: error instanceof Error ? error.message : String(error),
            });
            return reply.code(500).send({ success: false, error: 'Failed to build canonical payload' });
        }
    });

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

        const {
            account_id: accountId,
            order_id: orderId,
            force_regenerate: forceRegenerate,
        } = parsed.data;

        const relayAccount = await authenticateRelayEmailAccount(relayKeyValue);
        if (!relayAccount || relayAccount.accountId !== accountId) {
            return reply.code(403).send({ success: false, error: 'Invalid relay authentication' });
        }

        try {
            const artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId, {
                forceRegenerate: forceRegenerate === true,
            });
            const settled: any = await canonicalInvoiceService.waitForReady(artifact.id, 15000, 300);
            const diagnosticReason = computeRelayDiagnostic(settled, forceRegenerate === true);

            if (canonicalInvoiceService.isReadableReady(settled)) {
                const fileBuffer = fs.readFileSync(settled.storagePath);
                return {
                    success: true,
                    invoice_ref: settled.id,
                    pdf_base64: fileBuffer.toString('base64'),
                    filename: settled.storagePath.split('/').pop() || 'invoice.pdf',
                    renderer_used: settled.renderer,
                    diagnostic_reason: diagnosticReason,
                    generated_at: settled.generatedAt,
                };
            }

            if (settled?.status === 'failed') {
                return reply.code(409).send({
                    success: false,
                    status: 'failed',
                    invoice_ref: settled.id,
                    error: settled.errorMessage || 'Invoice generation failed',
                    renderer_used: settled.renderer,
                    diagnostic_reason: diagnosticReason,
                    generated_at: settled.generatedAt,
                });
            }

            if ((settled?.status === 'pending' || !settled) && settled?.id) {
                try {
                    await canonicalInvoiceService.processGenerationJob({
                        artifactId: settled.id,
                        accountId,
                        orderId,
                        templateId: artifact.templateId,
                    });

                    const refreshed: any = await canonicalInvoiceService.getArtifactById(settled.id);
                    const refreshedReason = computeRelayDiagnostic(refreshed, forceRegenerate === true);

                    if (canonicalInvoiceService.isReadableReady(refreshed)) {
                        const fileBuffer = fs.readFileSync(refreshed.storagePath);
                        return {
                            success: true,
                            invoice_ref: refreshed.id,
                            pdf_base64: fileBuffer.toString('base64'),
                            filename: refreshed.storagePath.split('/').pop() || 'invoice.pdf',
                            renderer_used: refreshed.renderer,
                            diagnostic_reason: refreshedReason,
                            generated_at: refreshed.generatedAt,
                        };
                    }
                } catch (syncError) {
                    Logger.warn('Synchronous invoice generation fallback failed', {
                        accountId,
                        orderId,
                        artifactId: settled.id,
                        error: syncError instanceof Error ? syncError.message : String(syncError),
                    });
                }
            }

            return reply.code(202).send({
                success: false,
                status: 'pending',
                invoice_ref: settled?.id ?? artifact.id,
                error: 'Invoice generation is pending',
                diagnostic_reason: diagnosticReason,
                generated_at: settled?.generatedAt ?? null,
            });
        } catch (error) {
            Logger.error('Failed to generate relay invoice PDF', { error, accountId, orderId });
            return reply.code(500).send({ success: false, error: 'Failed to generate invoice' });
        }
    });
};

export default invoiceRelayRoutes;

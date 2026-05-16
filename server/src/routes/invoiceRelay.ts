import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { authenticateRelayEmailAccount } from './email/helpers';
import { canonicalInvoiceService } from '../services/CanonicalInvoiceService';

function computeRelayDiagnostic(artifact: any, forceRegenerate: boolean): string | null {
    if (forceRegenerate) return 'forced_refresh';
    if (!artifact) return 'missing_artifact';
    if (artifact.status !== 'ready') return 'not_ready';
    if (!artifact.storagePath || !fs.existsSync(artifact.storagePath)) return 'missing_file';
    if (artifact.renderer !== 'designer-capture') return 'non_canonical_renderer';

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

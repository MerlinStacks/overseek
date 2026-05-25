import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fs from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { authenticateRelayEmailAccount } from './email/helpers';
import { MissingInvoiceTemplateError, canonicalInvoiceService } from '../services/CanonicalInvoiceService';

function isCanonicalRenderer(renderer: string | null | undefined): boolean {
    return renderer === 'pdfkit-primary'
        || renderer === 'pdfkit-fallback';
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

function buildArtifactDownloadUrl(request: FastifyRequest, artifactId: string): string {
    const expires = Date.now() + (5 * 60 * 1000);
    const sig = signCanonicalPayload(artifactId, expires);
    const forwardedProtoHeader = request.headers['x-forwarded-proto'];
    const forwardedProto = Array.isArray(forwardedProtoHeader)
        ? forwardedProtoHeader[0]
        : forwardedProtoHeader;
    const proto = (forwardedProto || request.protocol || 'https').split(',')[0].trim();

    const forwardedHostHeader = request.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwardedHostHeader)
        ? forwardedHostHeader[0]
        : forwardedHostHeader;
    const hostHeader = request.headers.host;
    const host = (forwardedHost || hostHeader || request.hostname).split(',')[0].trim();

    const base = `${proto}://${host}`;
    return `${base}/api/invoices/relay/artifact/${encodeURIComponent(artifactId)}?expires=${encodeURIComponent(String(expires))}&sig=${encodeURIComponent(sig)}`;
}

function verifyCanonicalSignature(artifactId: string, expires: number, signature: string): boolean {
    const expected = signCanonicalPayload(artifactId, expires);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
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

const ArtifactParamsSchema = z.object({
    artifactId: z.string().min(1),
});

const ArtifactQuerySchema = z.object({
    expires: z.coerce.number().int().positive(),
    sig: z.string().min(1),
});

const invoiceRelayRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/artifact/:artifactId', async (request, reply) => {
        const parsedParams = ArtifactParamsSchema.safeParse(request.params);
        const parsedQuery = ArtifactQuerySchema.safeParse(request.query);
        if (!parsedParams.success || !parsedQuery.success) {
            return reply.code(400).send({ success: false, error: 'Invalid artifact request' });
        }

        const { artifactId } = parsedParams.data;
        const { expires, sig } = parsedQuery.data;

        if (Date.now() > expires) {
            return reply.code(401).send({ success: false, error: 'Artifact request expired' });
        }

        if (!verifyCanonicalSignature(artifactId, expires, sig)) {
            return reply.code(401).send({ success: false, error: 'Invalid artifact signature' });
        }

        const artifact = await canonicalInvoiceService.getArtifactById(artifactId);
        if (!canonicalInvoiceService.isReadableReady(artifact)) {
            return reply.code(404).send({ success: false, error: 'Invoice artifact not ready' });
        }

        const filename = artifact.storagePath.split('/').pop() || 'invoice.pdf';
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename="${filename}"`);
        return reply.send(fs.createReadStream(artifact.storagePath));
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
                const artifactDownloadUrl = buildArtifactDownloadUrl(request, settled.id);
                return {
                    success: true,
                    invoice_ref: settled.id,
                    artifact_download_url: artifactDownloadUrl,
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
                        const artifactDownloadUrl = buildArtifactDownloadUrl(request, refreshed.id);
                        return {
                            success: true,
                            invoice_ref: refreshed.id,
                            artifact_download_url: artifactDownloadUrl,
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
            if (error instanceof MissingInvoiceTemplateError) {
                Logger.warn('Relay invoice generation skipped: missing invoice template', { accountId, orderId });
                return reply.code(409).send({
                    success: false,
                    status: 'missing_template',
                    error: 'No invoice template configured for this account',
                    diagnostic_reason: 'missing_template',
                });
            }

            Logger.error('Failed to generate relay invoice PDF', { error, accountId, orderId });
            return reply.code(500).send({ success: false, error: 'Failed to generate invoice' });
        }
    });
};

export default invoiceRelayRoutes;

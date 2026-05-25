/**
 * Invoices Route - Fastify Plugin
 * Handles invoice templates and image uploads for the invoice designer.
 */

import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { InvoiceService } from '../services/InvoiceService';
import { MissingInvoiceTemplateError, canonicalInvoiceService } from '../services/CanonicalInvoiceService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { createHmac, randomUUID } from 'crypto';

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

const invoiceService = new InvoiceService();

// Ensure invoice images directory exists
const invoiceImagesDir = path.join(__dirname, '../../uploads/invoices');
if (!fs.existsSync(invoiceImagesDir)) {
    fs.mkdirSync(invoiceImagesDir, { recursive: true });
}


const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Get all templates for account
    fastify.get('/templates', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const templates = await invoiceService.getTemplates(accountId);
            return templates;
        } catch (error) {
            Logger.error('Failed to fetch templates', { error });
            return reply.code(500).send({ error: 'Failed to fetch templates' });
        }
    });

    // Get specific template
    fastify.get<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const template = await invoiceService.getTemplate(request.params.id, accountId);
            if (!template) return reply.code(404).send({ error: 'Template not found' });
            return template;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch template' });
        }
    });

    // Create template
    fastify.post('/templates', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const template = await invoiceService.createTemplate(accountId, request.body as any);
            return template;
        } catch (error: any) {
            Logger.error('Failed to create invoice template', { error, accountId, body: request.body });
            if (error?.code === 'P2002') {
                return reply.code(409).send({ error: 'A template with this name already exists' });
            }
            return reply.code(500).send({ error: 'Failed to create template' });
        }
    });

    // Update template
    fastify.put<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const template = await invoiceService.updateTemplate(request.params.id, accountId, request.body as any);
            return template;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update template' });
        }
    });

    // Get template version history
    fastify.get<{ Params: { id: string } }>('/templates/:id/versions', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const versions = await invoiceService.getTemplateVersions(request.params.id, accountId);
            return { versions };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch template versions' });
        }
    });

    // Rollback template to a previous version
    fastify.post<{ Params: { id: string }; Body: { versionId: string } }>('/templates/:id/rollback', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
        if (!request.body?.versionId) return reply.code(400).send({ error: 'versionId is required' });

        try {
            const template = await invoiceService.rollbackTemplateVersion(
                request.params.id,
                accountId,
                request.body.versionId
            );
            return template;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to rollback template version' });
        }
    });

    // Upload image for invoice template (using @fastify/multipart)
    fastify.post('/templates/upload-image', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        let writeStream: fs.WriteStream | undefined;
        try {
            const data = await (request as any).file({ limits: { fileSize: 5 * 1024 * 1024 } });
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });

            // Validate image types
            const allowedTypes = /jpeg|jpg|png|gif|svg|webp/i;
            const ext = path.extname(data.filename).toLowerCase();
            if (!allowedTypes.test(ext.slice(1))) {
                return reply.code(400).send({ error: 'Invalid file type. Allowed: PNG, JPG, GIF, SVG, WebP' });
            }

            // Generate unique filename with account prefix for isolation
            const safeFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filename = `${accountId}-${randomUUID()}-${safeFilename}`;
            const filePath = path.join(invoiceImagesDir, filename);

            // Write file to disk
            writeStream = fs.createWriteStream(filePath);
            for await (const chunk of data.file) {
                writeStream.write(chunk);
            }
            writeStream.end();
            await new Promise<void>((resolve, reject) => {
                writeStream!.on('finish', resolve);
                writeStream!.on('error', reject);
            });

            const imageUrl = `/uploads/invoices/${filename}`;
            Logger.info('Invoice image uploaded', { accountId, filename, url: imageUrl });

            return {
                success: true,
                url: imageUrl,
                filename: data.filename,
                type: data.mimetype
            };
        } catch (error) {
            if (writeStream) writeStream.destroy();
            Logger.error('Failed to upload invoice image', { error, accountId });
            return reply.code(500).send({ error: 'Failed to upload image' });
        }
    });

    fastify.post<{ Params: { orderId: string }; Body: { forceRegenerate?: boolean } }>('/orders/:orderId/generate', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const orderId = String(request.params.orderId || '').trim();
        if (!orderId) return reply.code(400).send({ error: 'Order ID required' });

        try {
            const artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId, {
                forceRegenerate: request.body?.forceRegenerate === true,
            });
            const settled: any = await canonicalInvoiceService.waitForReady(artifact.id, 15000, 300);

            if (canonicalInvoiceService.isReadableReady(settled)) {
                const downloadUrl = buildArtifactDownloadUrl(request, settled.id);
                return {
                    success: true,
                    status: 'ready',
                    invoice_ref: settled.id,
                    artifact_download_url: downloadUrl,
                    renderer_used: settled.renderer,
                    generated_at: settled.generatedAt,
                };
            }

            if (settled?.status === 'failed') {
                return reply.code(409).send({
                    success: false,
                    status: 'failed',
                    invoice_ref: settled.id,
                    error: settled.errorMessage || 'Invoice generation failed',
                });
            }

            return reply.code(202).send({
                success: false,
                status: 'pending',
                invoice_ref: settled?.id ?? artifact.id,
                error: 'Invoice generation is pending',
            });
        } catch (error) {
            if (error instanceof MissingInvoiceTemplateError) {
                Logger.warn('Canonical invoice generation skipped: missing invoice template', { accountId, orderId });
                return reply.code(409).send({
                    success: false,
                    status: 'missing_template',
                    error: 'No invoice template configured for this account',
                });
            }

            Logger.error('Failed to generate canonical invoice from authenticated route', {
                accountId,
                orderId,
                error,
            });
            return reply.code(500).send({ error: 'Failed to generate invoice' });
        }
    });
};


export default invoicesRoutes;

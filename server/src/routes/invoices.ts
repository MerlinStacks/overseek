/**
 * Invoices Route - Fastify Plugin
 * Handles invoice templates and image uploads for the invoice designer.
 */

import { FastifyPluginAsync } from 'fastify';
import { InvoiceService } from '../services/InvoiceService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

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
        const accountId = request.user?.accountId;
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
        const accountId = request.user?.accountId;
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
        const accountId = request.user?.accountId;
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
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const template = await invoiceService.updateTemplate(request.params.id, accountId, request.body as any);
            return template;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update template' });
        }
    });

    // Upload image for invoice template (using @fastify/multipart)
    fastify.post('/templates/upload-image', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const data = await (request as any).file();
            if (!data) return reply.code(400).send({ error: 'No file uploaded' });

            // Validate image types
            const allowedTypes = /jpeg|jpg|png|gif|svg|webp/i;
            const ext = path.extname(data.filename).toLowerCase();
            if (!allowedTypes.test(ext.slice(1))) {
                return reply.code(400).send({ error: 'Invalid file type. Allowed: PNG, JPG, GIF, SVG, WebP' });
            }

            // Generate unique filename with account prefix for isolation
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const safeFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filename = `${accountId}-${uniqueSuffix}-${safeFilename}`;
            const filePath = path.join(invoiceImagesDir, filename);

            // Write file to disk
            const writeStream = fs.createWriteStream(filePath);
            for await (const chunk of data.file) {
                writeStream.write(chunk);
            }
            writeStream.end();

            const imageUrl = `/uploads/invoices/${filename}`;
            Logger.info('Invoice image uploaded', { accountId, filename, url: imageUrl });

            return {
                success: true,
                url: imageUrl,
                filename: data.filename,
                type: data.mimetype
            };
        } catch (error) {
            Logger.error('Failed to upload invoice image', { error, accountId });
            return reply.code(500).send({ error: 'Failed to upload image' });
        }
    });
};


export default invoicesRoutes;

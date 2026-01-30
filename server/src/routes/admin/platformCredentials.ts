/**
 * Platform Credentials Admin Routes
 * 
 * Handles platform credential management (credentials, SMTP, VAPID, AI prompts).
 * Extracted from admin.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { platformEmailService } from '../../services/PlatformEmailService';
import { Logger } from '../../utils/logger';
import webpush from 'web-push';

/**
 * Masks sensitive credential values for display
 */
function maskCredentials(creds: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(creds)) {
        if (typeof value === 'string' && value.length > 4) {
            masked[key] = value.substring(0, 4) + '********';
        } else {
            masked[key] = '********';
        }
    }
    return masked;
}

export const platformCredentialsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);

    // Platform Credentials - List
    fastify.get('/platform-credentials', async (request, reply) => {
        try {
            const credentials = await prisma.platformCredentials.findMany({ orderBy: { platform: 'asc' } });
            return credentials;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch platform credentials' });
        }
    });

    // Platform Credentials - Get One
    fastify.get<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            const cred = await prisma.platformCredentials.findUnique({ where: { platform } });
            if (!cred) return reply.code(404).send({ error: 'Platform credentials not found' });
            return { ...cred, credentials: maskCredentials(cred.credentials as Record<string, string>) };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch platform credentials' });
        }
    });

    // Platform Credentials - Upsert
    fastify.put<{ Params: { platform: string }; Body: { credentials: Record<string, any>; notes?: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            const { credentials, notes } = request.body;
            if (!credentials || typeof credentials !== 'object') return reply.code(400).send({ error: 'Invalid credentials format' });
            const cred = await prisma.platformCredentials.upsert({
                where: { platform },
                update: { credentials, notes },
                create: { platform, credentials, notes }
            });

            // Invalidate credentials cache to ensure new values take effect immediately
            if (platform === 'GOOGLE_ADS' || platform === 'META_ADS') {
                const { clearCredentialsCache } = await import('../../services/ads/types');
                clearCredentialsCache(platform as 'GOOGLE_ADS' | 'META_ADS');
            }

            return { ...cred, credentials: maskCredentials(cred.credentials as Record<string, string>) };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to save platform credentials' });
        }
    });

    // Platform Credentials - Delete
    fastify.delete<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        try {
            const { platform } = request.params;
            await prisma.platformCredentials.delete({ where: { platform } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete platform credentials' });
        }
    });

    // Platform SMTP Test
    fastify.post<{ Body: { host: string; port: string | number; username: string; password: string; secure?: boolean } }>('/platform-smtp/test', async (request, reply) => {
        try {
            const { host, port, username, password, secure } = request.body;
            if (!host || !port || !username || !password) {
                return reply.code(400).send({ success: false, error: 'Missing required fields' });
            }
            const result = await platformEmailService.testConnection({ host, port: parseInt(String(port)), username, password, secure: Boolean(secure) });
            if (result.success) return { success: true };
            return reply.code(400).send({ success: false, error: result.error });
        } catch (e: any) {
            return reply.code(500).send({ success: false, error: e.message || 'SMTP test failed' });
        }
    });

    // Generate VAPID Keys and save to database
    fastify.post('/generate-vapid-keys', async (request, reply) => {
        try {
            const existing = await prisma.platformCredentials.findUnique({
                where: { platform: 'WEB_PUSH_VAPID' }
            });

            if (existing) {
                const existingKeys = existing.credentials as { publicKey: string; privateKey: string };
                Logger.warn('[Admin] VAPID keys already exist, returning existing public key');
                return {
                    publicKey: existingKeys.publicKey,
                    alreadyExists: true,
                    message: 'VAPID keys already configured. Delete existing keys first to regenerate.'
                };
            }

            const keys = webpush.generateVAPIDKeys();
            await prisma.platformCredentials.create({
                data: {
                    platform: 'WEB_PUSH_VAPID',
                    credentials: {
                        publicKey: keys.publicKey,
                        privateKey: keys.privateKey
                    },
                    notes: `Generated via Admin UI on ${new Date().toISOString()}`
                }
            });

            Logger.warn('[Admin] Generated and saved new VAPID keys');
            return {
                publicKey: keys.publicKey,
                alreadyExists: false,
                message: 'VAPID keys generated and saved successfully!'
            };
        } catch (e: any) {
            Logger.error('[Admin] Failed to generate VAPID keys', { error: e });
            return reply.code(500).send({ error: e.message || 'Failed to generate VAPID keys' });
        }
    });

    // AI Prompts - List
    fastify.get('/ai-prompts', async (request, reply) => {
        try {
            const prompts = await prisma.aIPrompt.findMany({ orderBy: { promptId: 'asc' } });
            return prompts.map(p => ({ id: p.promptId, name: p.name, content: p.content, updatedAt: p.updatedAt }));
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch AI prompts' });
        }
    });

    // AI Prompts - Get One
    fastify.get<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            const prompt = await prisma.aIPrompt.findUnique({ where: { promptId } });
            if (!prompt) return reply.code(404).send({ error: 'Prompt not found' });
            return { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to fetch AI prompt' });
        }
    });

    // AI Prompts - Upsert
    fastify.put<{ Params: { promptId: string }; Body: { content: string; name?: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            const { content, name } = request.body;
            if (!content) return reply.code(400).send({ error: 'Content is required' });
            const prompt = await prisma.aIPrompt.upsert({
                where: { promptId },
                update: { content, name },
                create: { promptId, content, name }
            });
            return { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to save AI prompt' });
        }
    });

    // AI Prompts - Delete
    fastify.delete<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        try {
            const { promptId } = request.params;
            await prisma.aIPrompt.delete({ where: { promptId } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete AI prompt' });
        }
    });
};

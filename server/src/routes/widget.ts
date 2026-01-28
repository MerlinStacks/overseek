/**
 * Widget Route - Fastify Plugin
 * 
 * Serves the embedded chat widget script with 2026 modern design.
 * Widget script generation delegated to WidgetScriptBuilder service.
 * 
 * Features: Pre-chat form, Agent avatars, Emoji picker, File attachments
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { buildWidgetScript } from '../services/WidgetScriptBuilder';

const widgetRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * Serve Widget Script
     * GET /api/chat/widget.js
     */
    fastify.get('/widget.js', async (request, reply) => {
        const api_url = process.env.API_URL || "http://localhost:3000";
        const query = request.query as { id?: string };
        const accountId = query.id;

        if (!accountId) {
            reply.header('Content-Type', 'application/javascript; charset=utf-8');
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            return '';
        }

        try {
            // Fetch Settings
            const feature = await prisma.accountFeature.findUnique({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } }
            });
            const config = feature?.config as any || {};

            // Defaults - appearance and positioning
            const enabled = config.enabled !== false;
            const position = config.position || 'bottom-right';
            const showOnMobile = config.showOnMobile !== false;
            const primaryColor = config.primaryColor || '#2563eb';
            const headerText = config.headerText || 'Live Chat';
            const welcomeMessage = config.welcomeMessage || 'Hello! How can we help you today?';
            const businessHours = config.businessHours || { enabled: false };
            const businessTimezone = config.businessTimezone || 'Australia/Sydney';

            if (!enabled) {
                reply.header('Content-Type', 'application/javascript; charset=utf-8');
                reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                return '';
            }

            // Build the widget script using the WidgetScriptBuilder service
            const script = buildWidgetScript({
                apiUrl: api_url,
                accountId,
                primaryColor,
                headerText,
                welcomeMessage,
                businessHours,
                businessTimezone,
                position: position as 'bottom-right' | 'bottom-left',
                showOnMobile
            });

            reply.header('Content-Type', 'application/javascript; charset=utf-8');
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            return script;
        } catch (e) {
            Logger.error('Widget script error', { error: e });
            reply.header('Content-Type', 'application/javascript; charset=utf-8');
            return '';
        }
    });

    /**
     * Chat Configuration Endpoint
     * GET /api/chat/config/:accountId
     * Used by WooCommerce plugin for server-side business hours checking
     */
    fastify.get('/config/:accountId', async (request, reply) => {
        const { accountId } = request.params as { accountId: string };

        if (!accountId) {
            return reply.status(400).send({ error: 'Missing accountId' });
        }

        try {
            const feature = await prisma.accountFeature.findUnique({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } }
            });

            const config = feature?.config as Record<string, unknown> || {};

            return {
                businessHours: config.businessHours || { enabled: false },
                businessTimezone: config.businessTimezone || 'Australia/Sydney',
                position: config.position || 'bottom-right',
                showOnMobile: config.showOnMobile !== false,
            };
        } catch (e) {
            Logger.error('Chat config error', { error: e, accountId });
            return reply.status(500).send({ error: 'Failed to fetch config' });
        }
    });
};

export default widgetRoutes;

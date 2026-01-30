/**
 * Platform Settings Admin Route
 * Manages global platform configuration (Super Admin only)
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { z } from 'zod';

const updateSettingsSchema = z.object({
    registrationEnabled: z.boolean().optional()
});

/**
 * Retrieves or creates the singleton platform settings record.
 */
async function getOrCreateSettings() {
    let settings = await prisma.platformSettings.findUnique({
        where: { key: 'default' }
    });

    if (!settings) {
        settings = await prisma.platformSettings.create({
            data: { key: 'default', registrationEnabled: true }
        });
    }

    return settings;
}

export const platformSettingsRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /admin/platform-settings
     * Returns current platform settings
     */
    fastify.get('/platform-settings', async (_request, reply) => {
        try {
            const settings = await getOrCreateSettings();
            return {
                registrationEnabled: settings.registrationEnabled,
                updatedAt: settings.updatedAt
            };
        } catch (e: any) {
            Logger.error('Failed to fetch platform settings', { error: e });
            return reply.code(500).send({ error: 'Failed to fetch settings' });
        }
    });

    /**
     * PUT /admin/platform-settings
     * Updates platform settings
     */
    fastify.put('/platform-settings', async (request, reply) => {
        try {
            const parsed = updateSettingsSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: parsed.error.issues[0].message });
            }

            const settings = await prisma.platformSettings.upsert({
                where: { key: 'default' },
                update: parsed.data,
                create: {
                    key: 'default',
                    registrationEnabled: parsed.data.registrationEnabled ?? true
                }
            });

            Logger.info('[Admin] Platform settings updated', {
                registrationEnabled: settings.registrationEnabled,
                userId: request.user?.id
            });

            return {
                registrationEnabled: settings.registrationEnabled,
                updatedAt: settings.updatedAt
            };
        } catch (e: any) {
            Logger.error('Failed to update platform settings', { error: e });
            return reply.code(500).send({ error: 'Failed to update settings' });
        }
    });
};

export default platformSettingsRoutes;

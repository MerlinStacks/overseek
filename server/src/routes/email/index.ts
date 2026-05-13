import { FastifyPluginAsync } from 'fastify';
import emailAccountRoutes from './accounts';
import emailLogRoutes from './logs';
import emailWebhookRoutes from './webhooks';
import emailListRoutes, { emailListPublicRoutes } from './lists';
import emailSettingsRoutes from './settings';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';

async function isEmailFeatureEnabled(accountId: string): Promise<boolean> {
    // Backward compatibility: legacy accounts without an explicit row keep access.
    return isAccountFeatureEnabled(accountId, 'EMAIL', true);
}

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    // Webhooks are unauthenticated (they use x-relay-key header)
    await fastify.register(emailWebhookRoutes, { prefix: '' });
    await fastify.register(emailListPublicRoutes, { prefix: '' });

    // All other routes require auth + feature gate
    await fastify.register(async (authScope) => {
        authScope.addHook('preHandler', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) {
                return reply.code(400).send({ error: 'Account context required' });
            }

            const enabled = await isEmailFeatureEnabled(accountId);
            if (!enabled) {
                return reply.code(403).send({ error: 'Email feature is disabled for this account' });
            }
        });

        await authScope.register(emailAccountRoutes, { prefix: '' });
        await authScope.register(emailSettingsRoutes, { prefix: '' });
        await authScope.register(emailLogRoutes, { prefix: '' });
        await authScope.register(emailListRoutes, { prefix: '' });
    });
};

export default emailRoutes;

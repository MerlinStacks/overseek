import { FastifyPluginAsync } from 'fastify';
import emailAccountRoutes from './accounts';
import emailLogRoutes from './logs';
import emailWebhookRoutes from './webhooks';
import emailListRoutes, { emailListPublicRoutes } from './lists';
import emailSettingsRoutes from './settings';

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    // Webhooks are unauthenticated (they use x-relay-key header)
    await fastify.register(emailWebhookRoutes, { prefix: '' });
    await fastify.register(emailListPublicRoutes, { prefix: '' });

    // All other routes require auth
    await fastify.register(emailAccountRoutes, { prefix: '' });
    await fastify.register(emailSettingsRoutes, { prefix: '' });
    await fastify.register(emailLogRoutes, { prefix: '' });
    await fastify.register(emailListRoutes, { prefix: '' });
};

export default emailRoutes;

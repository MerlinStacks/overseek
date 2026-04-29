import { FastifyPluginAsync } from 'fastify';
import emailAccountRoutes from './accounts';
import emailSuppressionRoutes from './suppressions';
import emailLogRoutes from './logs';
import emailWebhookRoutes from './webhooks';

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    // Webhooks are unauthenticated (they use x-relay-key header)
    await fastify.register(emailWebhookRoutes, { prefix: '' });

    // All other routes require auth
    await fastify.register(emailAccountRoutes, { prefix: '' });
    await fastify.register(emailSuppressionRoutes, { prefix: '' });
    await fastify.register(emailLogRoutes, { prefix: '' });
};

export default emailRoutes;

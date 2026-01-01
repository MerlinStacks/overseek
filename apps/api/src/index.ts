import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({
    logger: true
});

fastify.register(cors, {
    origin: '*' // Configure safely later
});

import cookie from '@fastify/cookie';


// Register Plugins
fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'super-secret-key-change-me-in-prod-please',
    parseOptions: {}
});

// Routes
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { settingsRoutes } from './routes/settings.js';
import { analyticsRoutes } from './routes/analytics.js';
import { adminRoutes } from './routes/admin.js'; // Legacy/General Admin
import { proxyRoutes } from './routes/proxy.js';

// Register Routes
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(syncRoutes, { prefix: '/api/sync' });
fastify.register(settingsRoutes, { prefix: '/api/settings' });
fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
import { complianceRoutes } from './routes/compliance.js';
fastify.register(complianceRoutes, { prefix: '/api/compliance' });
import { marketingRoutes } from './routes/marketing.js';
fastify.register(marketingRoutes, { prefix: '/api/marketing' });
fastify.register(adminRoutes, { prefix: '/api/admin' });
fastify.register(proxyRoutes, { prefix: '/api/proxy' });


fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date() }
});

import { initSocket } from './socket.js';

import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

const start = async () => {
    try {
        // Run database migrations on startup
        console.log('Starting migration check...');
        try {
            const { stdout, stderr } = await execAsync('npm run db:push');
            console.log('Migration output:', stdout);
            if (stderr) console.log('Migration info:', stderr);
        } catch (error: any) {
            console.error('Migration failed:', error.message);
            // We continue regardless, as it might just be up to date or a connection blip
        }

        const port = parseInt(process.env.PORT || '4000');

        // socket.io attachment
        await fastify.ready();
        initSocket(fastify.server);

        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}
start();

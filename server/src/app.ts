require('dotenv').config();

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import http from 'http';
import { prisma } from './utils/prisma';
import { esClient } from './utils/elastic';
import { QueueFactory } from './services/queue/QueueFactory';
import { AutomationEngine } from './services/AutomationEngine';
import { RATE_LIMITS, UPLOAD_LIMITS } from './config/limits';
import { registerRoutes } from './config/routes';
import { Logger, fastifyLoggerConfig } from './utils/logger';
import { registerCAPIPlatforms } from './config/capi';
import { initializeSocketIO } from './config/socket';
import { subscribeEventBus } from './config/events';
import { setupSocketHandlers } from './config/socketHandlers';

QueueFactory.init();

const automationEngine = new AutomationEngine();

const fastify = Fastify({
    logger: fastifyLoggerConfig,
    disableRequestLogging: true,
    trustProxy: true,
});

async function build() {
    // CORS
    await fastify.register(cors, {
        origin: (origin, cb) => {
            const envOrigins = process.env.CORS_ORIGINS
                ? process.env.CORS_ORIGINS.split(',').map(v => v.trim()).filter(Boolean)
                : [];
            const allowed = envOrigins.length > 0
                ? envOrigins
                : (process.env.CLIENT_URL ? [process.env.CLIENT_URL, 'http://localhost:5173'] : ['http://localhost:5173']);
            const enforce = envOrigins.length > 0;
            if (!origin || allowed.includes(origin) || origin === '*') cb(null, true);
            else cb(null, !enforce);
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-account-id', 'x-wc-webhook-signature', 'x-wc-webhook-topic'],
    });

    // Rate limiting
    await fastify.register(rateLimit, {
        max: RATE_LIMITS.MAX_REQUESTS,
        timeWindow: RATE_LIMITS.WINDOW_MS,
        allowList: (req) => [
            '/api/auth/login', '/api/auth/refresh', '/api/auth/me',
            '/api/sync', '/api/webhooks', '/api/webhook/',
            '/health', '/api/t/', '/api/tracking', '/api/analytics',
            '/api/notifications', '/api/chat', '/api/fp/', '/api/dashboard',
            '/api/status-center'
        ].some(p => req.url.startsWith(p)),
        errorResponseBuilder: () => ({ error: 'Too many requests, please try again later.' })
    });

    // Security headers
    await fastify.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            }
        },
        dnsPrefetchControl: { allow: false },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        hsts: { maxAge: 31536000, includeSubDomains: true },
    });

    // Static uploads
    const uploadDir = path.join(__dirname, '../uploads');
    if (!require('fs').existsSync(uploadDir)) {
        require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    await fastify.register(fastifyStatic, { root: path.join(__dirname, '../uploads'), prefix: '/uploads/', maxAge: '1h' });
    await fastify.register(fastifyCompress, { encodings: ['br', 'gzip', 'deflate'], threshold: 1024 });
    await fastify.register(fastifyMultipart, { limits: { fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE } });

    // Request ID
    fastify.addHook('onRequest', async (request, reply) => {
        const existingId = request.headers['x-request-id'] as string;
        const requestId = existingId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        (request as any).requestId = requestId;
        reply.header('x-request-id', requestId);
    });

    // Logging
    fastify.addHook('onRequest', async (request) => { (request as any).startTime = Date.now(); });
    fastify.addHook('onResponse', async (request, reply) => {
        const duration = Date.now() - ((request as any).startTime || Date.now());
        if (!request.url.includes('/health')) {
            Logger.http(`${request.method} ${request.url}`, { status: reply.statusCode, duration: `${duration}ms`, requestId: (request as any).requestId });
        }
    });

    // Cache headers
    fastify.addHook('onSend', async (_request, reply, payload) => {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return payload;
    });

    // Routes
    await registerRoutes(fastify);
    await registerCAPIPlatforms();

    // Bull Board
    const bullBoardAdapter = QueueFactory.createBoard();
    await fastify.register(bullBoardAdapter.registerPlugin(), { prefix: '/admin/queues' });

    // Health check
    fastify.get('/health-fastify', async () => {
        let esStatus = 'disconnected';
        try {
            const health = await esClient.cluster.health();
            esStatus = health.status;
            if (esStatus !== 'red') {
                const { IndexingService } = await import('./services/search/IndexingService');
                await IndexingService.initializeIndices();
            }
        } catch { esStatus = 'unreachable'; }
        return { status: 'ok', framework: 'fastify', timestamp: new Date().toISOString(), services: { elasticsearch: esStatus, socket: 'active' } };
    });

    // Error handler
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
        const isMissingUpload = request.url.startsWith('/uploads/') &&
            (((error as NodeJS.ErrnoException).code === 'ENOENT') || /no such file/i.test(error.message));
        if (isMissingUpload) {
            Logger.warn('Missing upload asset', { path: request.url, method: request.method, requestId: (request as any).requestId });
            return reply.status(404).send({ error: 'File not found', statusCode: 404, requestId: (request as any).requestId });
        }
        const statusCode = error.statusCode || 500;
        const isClientError = statusCode >= 400 && statusCode < 500;
        if (isClientError) {
            Logger.warn('Client Error', { error: error.message, path: request.url, method: request.method, statusCode });
        } else {
            Logger.error('Server Error', { error: error.message, stack: error.stack, path: request.url, method: request.method, requestId: (request as any).requestId });
        }
        reply.status(statusCode).send({ error: isClientError ? error.message : 'Internal Server Error', statusCode, requestId: (request as any).requestId });
    });

    // Graceful shutdown
    fastify.addHook('onClose', async () => {
        Logger.info('Graceful shutdown initiated...');
        const { WooService } = await import('./services/woo');
        WooService.destroyAgents();
        Logger.info('HTTP agent pools destroyed.');
        await prisma.$disconnect();
        Logger.info('Prisma disconnected.');
    });

    return fastify;
}

let server: http.Server;
let io: import('socket.io').Server | undefined;

async function initializeApp() {
    const app = await build();
    server = app.server;
    const { io: socketIo, chatService } = await initializeSocketIO(server, app);
    io = socketIo;
    subscribeEventBus(chatService, automationEngine);
    setupSocketHandlers(io);
    return app;
}

const appPromise = initializeApp();

export { fastify, server, io, automationEngine, appPromise };

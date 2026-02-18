require('dotenv').config();

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import { prisma } from './utils/prisma';
import { esClient } from './utils/elastic';

import http from 'http';
import { Server } from 'socket.io';
import { ChatService } from './services/ChatService';
import { QueueFactory } from './services/queue/QueueFactory';
import { EventBus, EVENTS } from './services/events';
import { AutomationEngine } from './services/AutomationEngine';
import { setIO } from './socket';
import { RATE_LIMITS, UPLOAD_LIMITS, SCHEDULER_LIMITS } from './config/limits';
import { verifyToken } from './utils/auth';
import { registerRoutes } from './config/routes';
import { setupSocketHandlers } from './config/socketHandlers';
import { Logger, fastifyLoggerConfig } from './utils/logger';

// Init Queues for Bull Board
QueueFactory.init();

const automationEngine = new AutomationEngine();
import { NotificationEngine } from './services/NotificationEngine';

// Create Fastify instance
const fastify = Fastify({
    logger: fastifyLoggerConfig,
    disableRequestLogging: true,
    trustProxy: true,
});

// Build function to initialize all plugins and routes
async function build() {
    // Register CORS
    await fastify.register(cors, {
        origin: (origin, cb) => {
            const envOrigins = process.env.CORS_ORIGINS
                ? process.env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
                : [];
            const allowedOrigins = envOrigins.length > 0
                ? envOrigins
                : (process.env.CLIENT_URL
                    ? [process.env.CLIENT_URL, 'http://localhost:5173']
                    : ['http://localhost:5173']);
            const enforceAllowlist = envOrigins.length > 0;

            if (!origin || allowedOrigins.includes(origin) || origin === '*') {
                cb(null, true);
            } else {
                cb(null, !enforceAllowlist);
            }
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-account-id', 'x-wc-webhook-signature', 'x-wc-webhook-topic'],
    });

    // Rate Limiting
    await fastify.register(rateLimit, {
        max: RATE_LIMITS.MAX_REQUESTS,
        timeWindow: RATE_LIMITS.WINDOW,
        allowList: (req) => {
            const url = req.url || '';
            if (url.startsWith('/api/sync')) return true;
            if (url.startsWith('/api/webhooks')) return true;
            if (url.startsWith('/api/webhook/')) return true;
            if (url.startsWith('/health')) return true;
            if (url.startsWith('/api/t/')) return true;
            if (url.startsWith('/api/tracking')) return true;
            return false;
        },
        errorResponseBuilder: () => ({
            error: 'Too many requests, please try again later.'
        })
    });

    // Helmet security headers
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

    // Static file serving for uploads
    const uploadDir = path.join(__dirname, '../uploads');
    if (!require('fs').existsSync(uploadDir)) {
        require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    await fastify.register(fastifyStatic, {
        root: path.join(__dirname, '../uploads'),
        prefix: '/uploads/',
        maxAge: '1h',
    });

    // Response compression
    await fastify.register(fastifyCompress, {
        encodings: ['br', 'gzip', 'deflate'],
        threshold: 1024,
    });

    // Multipart file uploads
    await fastify.register(fastifyMultipart, {
        limits: { fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE },
    });

    // Request ID hook
    fastify.addHook('onRequest', async (request, reply) => {
        const existingId = request.headers['x-request-id'] as string;
        const requestId = existingId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        (request as any).requestId = requestId;
        reply.header('x-request-id', requestId);
    });

    // Request logging hooks
    fastify.addHook('onRequest', async (request, _reply) => {
        (request as any).startTime = Date.now();
    });

    fastify.addHook('onResponse', async (request, reply) => {
        const duration = Date.now() - ((request as any).startTime || Date.now());
        if (!request.url.includes('/health')) {
            Logger.http(`${request.method} ${request.url}`, {
                status: reply.statusCode,
                duration: `${duration}ms`,
                requestId: (request as any).requestId,
            });
        }
    });

    // Disable caching for API responses
    fastify.addHook('onSend', async (request, reply, payload) => {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return payload;
    });

    // Register all routes (extracted to config/routes.ts)
    await registerRoutes(fastify);

    // Mount Bull Board
    const bullBoardAdapter = QueueFactory.createBoard();
    await fastify.register(bullBoardAdapter.registerPlugin(), {
        prefix: '/admin/queues',
    });

    // Native Fastify health check
    fastify.get('/health-fastify', async (_request, _reply) => {
        let esStatus = 'disconnected';
        try {
            const health = await esClient.cluster.health();
            esStatus = health.status;
            if (esStatus !== 'red') {
                const { IndexingService } = await import('./services/search/IndexingService');
                await IndexingService.initializeIndices();
            }
        } catch (error) {
            esStatus = 'unreachable';
        }

        return {
            status: 'ok',
            framework: 'fastify',
            timestamp: new Date().toISOString(),
            services: { elasticsearch: esStatus, socket: 'active' }
        };
    });

    // Global Error Handler
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
        const statusCode = error.statusCode || 500;
        const isClientError = statusCode >= 400 && statusCode < 500;

        if (isClientError) {
            Logger.warn('Client Error', {
                error: error.message, path: request.url, method: request.method, statusCode,
            });
        } else {
            Logger.error('Server Error', {
                error: error.message, stack: error.stack, path: request.url,
                method: request.method, requestId: (request as any).requestId,
            });
        }

        reply.status(statusCode).send({
            error: isClientError ? error.message : 'Internal Server Error',
            statusCode, requestId: (request as any).requestId,
        });
    });

    // Graceful Shutdown Hook
    fastify.addHook('onClose', async (_instance) => {
        Logger.info('Graceful shutdown initiated...');
        await prisma.$disconnect();
        Logger.info('Prisma disconnected.');
    });

    return fastify;
}

// Create HTTP server from Fastify for Socket.IO compatibility
let server: http.Server;
let io: Server;
let chatService: ChatService;

// Async initialization
async function initializeApp() {
    await build();

    server = fastify.server;

    // Setup Socket.IO
    const socketOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
        : (process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []);
    const socketOriginSetting = socketOrigins.length > 0 ? socketOrigins : "*";

    io = new Server(server, {
        cors: { origin: socketOriginSetting, methods: ["GET", "POST"] }
    });

    // Socket.IO auth middleware
    io.use(async (socket, next) => {
        try {
            const authHeader = socket.handshake.headers?.authorization as string | undefined;
            const token =
                socket.handshake.auth?.token ||
                (authHeader ? authHeader.split(' ')[1] : undefined) ||
                (socket.handshake.query?.token as string | undefined);

            if (!token) return next(new Error('Unauthorized'));

            const decoded = verifyToken(token) as { userId: string };
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
                select: { isSuperAdmin: true }
            });
            const memberships = await prisma.accountUser.findMany({
                where: { userId: decoded.userId },
                select: { accountId: true }
            });

            socket.data.userId = decoded.userId;
            socket.data.isSuperAdmin = user?.isSuperAdmin === true;
            socket.data.accountIds = memberships.map(m => m.accountId);

            return next();
        } catch (error) {
            // Expired tokens are routine on WebSocket reconnects — no action needed
            const isExpired = error instanceof Error && error.name === 'TokenExpiredError';
            if (isExpired) {
                Logger.debug('[Socket.IO] Token expired on socket auth', { socketId: socket.id });
            } else {
                Logger.warn('[Socket.IO] Auth failed', { error });
            }
            return next(new Error('Unauthorized'));
        }
    });

    // Apply Redis adapter for horizontal scaling
    try {
        const { createSocketAdapter } = await import('./utils/socketAdapter');
        io.adapter(createSocketAdapter());
        Logger.info('[Socket.IO] Redis adapter enabled for horizontal scaling');
    } catch (error) {
        Logger.warn('[Socket.IO] Redis adapter not available, running in single-instance mode', { error });
    }

    // Register Socket.IO globally
    setIO(io);

    // Initialize Chat Service
    chatService = new ChatService(io);

    // Mount Chat Routes (require ChatService)
    const { createChatRoutes } = await import('./routes/chat');
    const { createPublicChatRoutes } = await import('./routes/chat-public');
    const { createSmsRoutes } = await import('./routes/sms');
    await fastify.register(createChatRoutes(chatService), { prefix: '/api/chat' });
    await fastify.register(createPublicChatRoutes(chatService), { prefix: '/api/chat/public' });
    await fastify.register(createSmsRoutes(chatService), { prefix: '/api/sms' });

    // Listen for Automation Events
    EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'ORDER_CREATED', data.order);
    });

    EventBus.on(EVENTS.REVIEW.LEFT, async (data) => {
        await automationEngine.processTrigger(data.accountId, 'REVIEW_LEFT', data.review);
    });

    // Handle incoming emails from IMAP polling
    // EmailService.checkEmails() emits EMAIL.RECEIVED with raw email data
    // We route it to EmailIngestion to create/update conversations and add messages
    EventBus.on(EVENTS.EMAIL.RECEIVED, async (data: any) => {
        // Only process if this came from EmailService.checkEmails (has emailAccountId but no conversationId)
        // EmailIngestion also emits this event AFTER processing (has conversationId) for push notifications
        if (data.emailAccountId && !data.conversationId) {
            // Validate required fields before processing
            if (!data.fromEmail || !data.messageId) {
                Logger.warn('[App] Skipping malformed email event - missing required fields', {
                    hasFromEmail: !!data.fromEmail,
                    hasMessageId: !!data.messageId,
                    emailAccountId: data.emailAccountId
                });
                return;
            }
            try {
                Logger.info('[App] Processing incoming email', {
                    fromEmail: data.fromEmail,
                    subject: data.subject,
                    emailAccountId: data.emailAccountId
                });
                await chatService.handleIncomingEmail({
                    emailAccountId: data.emailAccountId,
                    fromEmail: data.fromEmail,
                    fromName: data.fromName,
                    subject: data.subject,
                    body: data.body,
                    html: data.html,
                    messageId: data.messageId,
                    inReplyTo: data.inReplyTo,
                    references: data.references,
                    attachments: data.attachments
                });
                Logger.info('[App] Successfully ingested email', {
                    fromEmail: data.fromEmail,
                    subject: data.subject
                });
            } catch (error) {
                Logger.error('[App] Failed to handle incoming email', { error, fromEmail: data.fromEmail });
            }
        }
        // NotificationEngine also listens to this event for push notifications (see NotificationEngine.ts)
    });

    // Initialize Notification Engine
    NotificationEngine.init();

    // Setup Socket.IO handlers (extracted to config/socketHandlers.ts)
    setupSocketHandlers(io);

    // CRON / SCHEDULERS
    setInterval(async () => {
        try {
            await automationEngine.runTicker();
        } catch (e) {
            Logger.error('Ticker Error', { error: e as Error });
        }
    }, SCHEDULER_LIMITS.TICKER_INTERVAL_MS);
}

// Initialize on import
const appPromise = initializeApp();

export { fastify as app, server, io, automationEngine, appPromise };
